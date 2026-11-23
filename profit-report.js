/* CRM «Работа»: read-only owner report, based on the orders already authorized by RLS.
 * "Доля компании" is before materials, fuel, tax and other expenses.
 */
"use strict";
(function(root){
  const TIME_ZONE="Europe/Moscow";
  const RAUL_PERCENT=0.5;
  const TIMUR_PER_ORDER=1500;
  // Identical salary and company-share split to Finance. Never keep another
  // independently implemented calculation in a report.
  const sharedSplit=root?.__rdFinanceSplit ||
    (typeof require==="function"?require("./finance-model.js").financeSplit:null);
  const PAGE_SIZE=100;
  const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
  const money=n=>Number(n||0).toLocaleString("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2})+" ₽";
  const txt=v=>String(v==null?"":v);
  function moscowDay(date){
    if(!date)return "";
    const parsed=new Date(date);
    return Number.isNaN(parsed.getTime())?"":new Intl.DateTimeFormat("sv-SE",{
      timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"
    }).format(parsed);
  }
  function getDate(order,basis){
    if(basis==="closed")return order.completedAt?moscowDay(order.completedAt):"";
    if(basis==="appointment")return txt(order.date).slice(0,10);
    return order.createdAt?moscowDay(order.createdAt):"";
  }
  function reportRow(order,options={}){
    const price=order.price==null||order.price===""?null:Number(order.price);
    const validPrice=price!=null&&Number.isFinite(price)&&price>=0;
    const paid=Boolean(order.paid);
    const paymentAmountMissing=paid&&(order.paymentAmount==null||order.paymentAmount==="");
    const amount=paymentAmountMissing?price:Number(order.paymentAmount);
    const received=paid&&validPrice&&Number.isFinite(amount)&&amount>=0?round(amount):0;
    const paymentMismatch=paid&&validPrice&&!paymentAmountMissing&&
      Number.isFinite(amount)&&Math.abs(amount-price)>=.01;
    const completed=order.status==="Выполнен";
    const earned=completed&&paid;
    // In the CRM, always supply Raul's authenticated master user_id.
    // Legacy unit-test callers without masterId may still use display names.
    const scoped=Object.prototype.hasOwnProperty.call(options,"masterId");
    const raul=scoped
      ?Boolean(options.masterId)&&order.assignedUserId===options.masterId
      :txt(order.master).trim().toLocaleLowerCase("ru-RU")==="рауль";
    const calculated=earned&&raul&&validPrice&&typeof sharedSplit==="function";
    const split=calculated?sharedSplit(price):null;
    const salary=split?round(split.raul+split.timur):null;
    const profit=split?split.company:null;
    return Object.assign({},order,{
      reportPrice:validPrice?price:null,
      reportReceived:received,reportEarned:earned,reportCalculated:calculated,
      reportSalary:salary,reportProfit:profit,
      reportPaymentMissing:paymentAmountMissing,reportPaymentMismatch:paymentMismatch,
      reportReason:!earned?"":calculated?"":!validPrice?"Не указана цена":!raul?
        "Нет расчёта: заказ назначен другому мастеру или мастер не найден":
        "Не загружены правила финансовых начислений"
    });
  }
  function summary(rows){
    const total={count:rows.length,price:0,received:0,salary:0,profit:0,uncalculated:0,missingPayments:0,mismatchedPayments:0};
    rows.forEach(row=>{
      total.price=round(total.price+(row.reportPrice??0));
      total.received=round(total.received+row.reportReceived);
      if(row.reportPaymentMissing)total.missingPayments++;
      if(row.reportPaymentMismatch)total.mismatchedPayments++;
      if(row.reportCalculated){
        total.salary=round(total.salary+row.reportSalary);
        total.profit=round(total.profit+row.reportProfit);
      }else if(row.reportEarned)total.uncalculated++;
    });
    return total;
  }
  function bounds(period,today,customFrom,customTo){
    if(period==="all")return ["",""];
    if(period==="custom")return [customFrom||"",customTo||""];
    const year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
    if(period==="month")return [today.slice(0,7)+"-01",today];
    if(period==="previous"){
      const prev=new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
      const last=new Date(Date.UTC(year,month-1,0)).toISOString().slice(0,10);
      return [prev+"-01",last];
    }
    if(period==="week"){
      const day=new Date(today+"T12:00:00Z");
      const offset=(day.getUTCDay()+6)%7;
      day.setUTCDate(day.getUTCDate()-offset);
      return [day.toISOString().slice(0,10),today];
    }
    return ["",""];
  }
  function filterRows(orders,options={}){
    const search=txt(options.search).trim().toLocaleLowerCase("ru-RU").replace(/^[№#]\s*/,"");
    const today=options.today||moscowDay(new Date());
    const [from,to]=bounds(options.period||"all",today,options.from,options.to);
    return orders.map(order=>reportRow(order,options)).filter(row=>{
      const day=getDate(row,options.basis||"closed");
      if(from&&(!day||day<from))return false;
      if(to&&(!day||day>to))return false;
      if(options.status==="paid"&&!row.paid)return false;
      if(options.status==="unpaid"&&row.paid)return false;
      if(options.status&&options.status!=="paid"&&options.status!=="unpaid"&&row.status!==options.status)return false;
      if(search){
        const hay=[row.orderNumber,row.referenceCode,row.name,row.phone,row.address,row.master,row.clientSource].
          map(txt).join(" ").toLocaleLowerCase("ru-RU");
        if(!hay.includes(search))return false;
      }
      return true;
    }).sort((a,b)=>txt(b.createdAt||b.date).localeCompare(txt(a.createdAt||a.date)));
  }
  function quoteCsv(value){
    let s=txt(value);
    if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  function csvFor(rows){
    const cols=["Заказ","Дата создания","Дата записи","Дата закрытия","Клиент","Мастер","Статус","Цена","Оплачено (по отметке)","Зарплата","Доля компании","Сведения о сумме оплаты"];
    const data=rows.map(r=>[r.referenceCode||r.orderNumber||"",getDate(r,"created"),r.date||"",
      getDate(r,"closed"),r.name,r.master,r.status,r.reportPrice==null?"":r.reportPrice,
      r.reportReceived,r.reportSalary==null?"":r.reportSalary,r.reportProfit==null?"":r.reportProfit,
       !r.paid?"Не оплачено":r.reportPaymentMissing?"Сумма платежа не указана":r.reportPaymentMismatch?"Оплата отличается от цены":"Сумма указана"]);
    return "\uFEFF"+[cols,...data].map(row=>row.map(quoteCsv).join(";")).join("\r\n");
  }
  function node(tag,cls,value){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(value!=null)n.textContent=txt(value);
    return n;
  }
  function button(label,cls,fn){
    const b=node("button",cls,label);b.type="button";b.addEventListener("click",fn);return b;
  }
  function makeSelect(items,aria,initial,changed){
    const el=node("select");
    el.setAttribute("aria-label",aria);
    for(const [value,label] of items){const o=node("option","",label);o.value=value;el.append(o)}
    el.value=initial;el.addEventListener("change",()=>changed(el.value));
    return el;
  }
  function mount(rootEl,{getOrders,getRaulMasterId=null,getFinanceStatus=null,startOpen=false,onBack=null}){
    if(!rootEl||typeof getOrders!=="function")throw Error("Отчёт не может загрузиться");
    rootEl.classList.add("pr-report-scope");
    const state={open:false,period:"month",basis:"closed",status:"",search:"",from:"",to:"",visible:PAGE_SIZE};
    const menu=node("div","pr-menu");
    const card=button("Прибыль по заказам","pr-report-link",()=>{
      state.open=true;menu.hidden=true;detail.hidden=false;
      rootEl.closest("#rdReports")?.classList.add("rd-reports-detail-open");
      render();
    });
    card.append(node("span","pr-report-arrow","›"));
    const desc=node("p","pr-description","Список заказов, оплата, зарплата мастерам и доля компании.");
    menu.append(card,desc);
    const detail=node("section","pr-detail");detail.hidden=true;
    const heading=node("div","pr-heading");
    const back=button("Отчёты","pr-back",()=>{
      if(typeof onBack==="function"){onBack();return;}
      state.open=false;detail.hidden=true;menu.hidden=false;
      rootEl.closest("#rdReports")?.classList.remove("rd-reports-detail-open");
    });
    back.setAttribute("aria-label","Вернуться ко всем отчётам");
    heading.setAttribute("aria-label","Отчёты / Прибыль по заказам");
    heading.append(back,node("span","pr-crumb-sep","/"),
      node("h2","","Прибыль по заказам"));
    const controls=node("div","pr-controls");
    const period=makeSelect([["month","Текущий месяц"],["previous","Прошлый месяц"],["week","Эта неделя"],["all","За всё время"],["custom","Свой период"]],
      "Период отчёта",state.period,value=>{state.period=value;custom.hidden=value!=="custom";redraw()});
    const basis=makeSelect([["closed","По дате закрытия"],["created","По дате создания"],["appointment","По дате записи"]],
      "Тип даты отчёта",state.basis,value=>{state.basis=value;redraw()});
    const status=makeSelect([["","Все статусы"],["Записан","Записан"],["В работе","В работе"],
      ["Выполнен","Выполнен"],["Отменён","Отменён"],["paid","Оплачены"],["unpaid","Не оплачены"]],
      "Статус заказов",state.status,value=>{state.status=value;redraw()});
    const search=node("input");search.type="search";search.placeholder="№ заказа, клиент, телефон…";
    search.setAttribute("aria-label","Поиск по заказам");
    search.addEventListener("input",()=>{state.search=search.value;redraw()});
    const custom=node("div","pr-custom");custom.hidden=true;
    const from=node("input");from.type="date";from.setAttribute("aria-label","Начало периода");
    const to=node("input");to.type="date";to.setAttribute("aria-label","Конец периода");
    from.addEventListener("change",()=>{state.from=from.value;redraw()});
    to.addEventListener("change",()=>{state.to=to.value;redraw()});
    custom.append(from,to);
    const download=button("Скачать CSV","pr-export",()=>{
      const csv=csvFor(queryRows());
      const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
      const anchor=document.createElement("a");anchor.href=url;
      anchor.download="rabota-profit-orders-"+moscowDay(new Date())+".csv";
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    const quickActions=node("div","pr-quick-actions");
    download.textContent="CSV ↓";
    download.setAttribute("aria-label","Скачать CSV");
    download.title="Скачать CSV";
    quickActions.append(search,download);
    controls.append(period,basis,status,quickActions);
    const caption=node("p","pr-note");
    const info=node("details","pr-info");
    info.append(node("summary","","Как считается доля компании?"));
    info.append(node("p","pr-explain","Доля компании = стоимость выполненного и оплаченного заказа − 50% Раулю − 1 500 ₽ Тимуру, до затрат на материалы, дорогу и налоги. Если в старом заказе нет суммы оплаты, расчёт поступлений основан только на отметке «Оплачено», а не на подтверждённом платеже."));
    const scroll=node("div","pr-scroll");
    const table=node("table","pr-table");
    // Stable per-column widths prevent jumps when filters change or rows are expanded.
    const columns=node("colgroup");
    for(const width of [78,92,116,100,104,108,110,110]){
      const col=node("col");col.style.width=width+"px";columns.append(col);
    }
    table.append(columns);
    const thead=node("thead");
    const tr=node("tr");
    for(const label of ["Заказ","Дата","Клиент","Статус","Цена","Платежи","Зарплата","Доля компании"]){
      const th=node("th","",label);th.scope="col";tr.append(th);
    }
    thead.append(tr);table.append(thead);
    const tbody=node("tbody");table.append(tbody);scroll.append(table);
    const more=node("div","pr-more");
    detail.append(heading,controls,custom,caption,scroll,more,info);
    rootEl.append(menu,detail);
    function queryRows(){
      const options={...state};
      if(typeof getRaulMasterId==="function")options.masterId=getRaulMasterId();
      return filterRows(getOrders(),options);
    }
    function redraw(){state.visible=PAGE_SIZE;render()}
    function render(){
      if(!state.open)return;
      const finance=getFinanceStatus?.();
      const unavailable=Boolean(finance?.loading||finance?.error);
      scroll.hidden=unavailable;download.disabled=unavailable;
      if(unavailable){
        tbody.replaceChildren();more.replaceChildren();
        caption.textContent=finance.error?"Не удалось загрузить расчёты. "+finance.error:"Загружаем данные отчёта…";
        caption.setAttribute("role",finance.error?"alert":"status");return;
      }
      caption.removeAttribute("role");
      const rows=queryRows();
      const totals=summary(rows);
      caption.textContent="Показаны "+Math.min(state.visible,rows.length)+" из "+rows.length+
        (totals.uncalculated?" · Без расчёта доли: "+totals.uncalculated:"")+
         (totals.missingPayments?" · Нет суммы платежа: "+totals.missingPayments:"")+
         (totals.mismatchedPayments?" · Оплата отличается от цены: "+totals.mismatchedPayments:"");
      tbody.replaceChildren();
      // Like HelloClient: period totals go above individual orders, after the header.
      // Totals include every matching order, not just the visible page of 100.
      const totalRow=node("tr","pr-total-row");
      const totalCells=["Итого","","","",money(totals.price),
        money(totals.received)+(totals.missingPayments?"*":""),money(totals.salary),money(totals.profit)];
      totalCells.forEach((value,index)=>{
        const cell=node(index===0?"th":"td",index>=4?"pr-number":"",value);
        if(index===0)cell.scope="row";
        if(index>=6&&totals.uncalculated){
          cell.title="Доля рассчитана не по всем выполненным заказам: "+totals.uncalculated+" без расчёта";
        }
        totalRow.append(cell);
      });
      if(totals.missingPayments)totalRow.children[5].title=
        "В части оплаченных заказов сумма платежа отсутствует. Общая сумма включает стоимость этих заказов по отметке «Оплачено».";
      tbody.append(totalRow);
      if(!rows.length){
        const empty=node("tr");const cell=node("td","pr-empty","Заказов по выбранным фильтрам нет.");
        cell.colSpan=8;empty.append(cell);tbody.append(empty);
      }
      for(const row of rows.slice(0,state.visible)){
        const tr=node("tr"),id=row.referenceCode||row.orderNumber||"—";
        const open=button(id,"pr-row-open",()=>{extra.hidden=!extra.hidden;open.setAttribute("aria-expanded",String(!extra.hidden))});
        open.setAttribute("aria-expanded","false");
        const first=node("td");first.append(open);tr.append(first);
        const values=[getDate(row,state.basis)||"—",row.name||"Без имени",
          row.status||"—",row.reportPrice==null?"—":money(row.reportPrice),
          money(row.reportReceived)+(row.reportPaymentMissing?"*":""),row.reportSalary==null?"—":money(row.reportSalary),
          row.reportProfit==null?"—":money(row.reportProfit)];
        values.forEach((value,i)=>tr.append(node("td",i>=3?"pr-number":"",value)));
        tbody.append(tr);
        const extra=node("tr","pr-expanded");extra.hidden=true;
        const td=node("td");td.colSpan=8;
        const parts=[
          "Мастер: "+(row.master||"не назначен"),
          "Адрес: "+(row.address||"не указан"),
          "Дата записи: "+(row.date||"не указана")+(row.time?" в "+row.time:""),
          "Дата закрытия: "+(getDate(row,"closed")||"нет"),
          "Оплата: "+(row.paid?"да":"нет")+(row.paymentMethod?" · "+row.paymentMethod:""),
          "Источник: "+(row.clientSource||"не указан")
        ];
        if(row.reportCalculated)parts.push("Расчёт: "+money(row.reportPrice)+" − "+money(row.reportSalary)+" = "+money(row.reportProfit));
        if(row.reportPaymentMissing)parts.push("Сумма фактической оплаты не записана; показана стоимость заказа по отметке «Оплачено»");
        if(row.reportPaymentMismatch)parts.push("Внимание: сумма оплаты отличается от стоимости заказа");
        if(row.reportReason)parts.push(row.reportReason);
        td.append(node("div","pr-expanded-content",parts.join(" · ")));
        extra.append(td);tbody.append(extra);
      }
      more.replaceChildren();
      if(state.visible<rows.length){
        more.append(button("Показать ещё "+Math.min(PAGE_SIZE,rows.length-state.visible),
          "pr-more-btn",()=>{state.visible+=PAGE_SIZE;render()}));
      }
    }
    if(startOpen){
      state.open=true;menu.hidden=true;detail.hidden=false;
      rootEl.closest("#rdReports")?.classList.add("rd-reports-detail-open");
      render();
    }
    return {render,isOpen:()=>state.open};
  }
  if(root)root.__rdCreateProfitReport=mount;
  if(typeof module!=="undefined"&&module.exports)module.exports={
    reportRow,summary,filterRows,bounds,moscowDay,csvFor,RAUL_PERCENT,TIMUR_PER_ORDER
  };
})(typeof window!=="undefined"?window:null);
