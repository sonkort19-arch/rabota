/* CRM «Работа»: read-only owner report, based on the orders already authorized by RLS.
 * "Доля компании" is before materials, fuel, tax and other expenses.
 */
"use strict";
(function(root){
  const TIME_ZONE="Europe/Moscow";
  const RAUL_PERCENT=0.5;
  const TIMUR_PER_ORDER=1500;
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
  function reportRow(order){
    const price=order.price==null||order.price===""?null:Number(order.price);
    const validPrice=price!=null&&Number.isFinite(price)&&price>=0;
    const amount=order.paymentAmount==null?price:Number(order.paymentAmount);
    const paid=Boolean(order.paid);
    const received=paid&&validPrice&&Number.isFinite(amount)&&amount>=0?round(amount):0;
    const completed=order.status==="Выполнен";
    const earned=completed&&paid;
    const raul=txt(order.master).trim().toLocaleLowerCase("ru-RU")==="рауль";
    const isFullPayment=validPrice&&Math.abs(received-price)<.01;
    const calculated=earned&&raul&&validPrice&&isFullPayment;
    const salary=calculated?round(price*RAUL_PERCENT+TIMUR_PER_ORDER):null;
    const profit=calculated?round(price-salary):null;
    return Object.assign({},order,{reportPrice:validPrice?price:null,
      reportReceived:received,reportEarned:earned,reportCalculated:calculated,
      reportSalary:salary,reportProfit:profit,
      reportReason:!earned?"":"\u041d\u0435\u0442 \u0440\u0430\u0441\u0447\u0451\u0442\u0430: "+
        (!validPrice?"\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u0430 \u0446\u0435\u043d\u0430":!raul?"\u043d\u0435\u0442 \u043f\u0440\u0430\u0432\u0438\u043b \u0432\u044b\u043f\u043b\u0430\u0442 \u0434\u043b\u044f \u043c\u0430\u0441\u0442\u0435\u0440\u0430":"\u0441\u0443\u043c\u043c\u0430 \u043e\u043f\u043b\u0430\u0442\u044b \u043e\u0442\u043b\u0438\u0447\u0430\u0435\u0442\u0441\u044f \u043e\u0442 \u0446\u0435\u043d\u044b")
    });
  }
  function summary(rows){
    const total={count:rows.length,price:0,received:0,salary:0,profit:0,uncalculated:0};
    rows.forEach(row=>{
      total.price=round(total.price+(row.reportPrice??0));
      total.received=round(total.received+row.reportReceived);
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
    return orders.map(reportRow).filter(row=>{
      const day=getDate(row,options.basis||"created");
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
    const cols=["Заказ","Дата создания","Дата записи","Дата закрытия","Клиент","Мастер","Статус","Цена","Оплачено","Зарплата","Доля компании"];
    const data=rows.map(r=>[r.referenceCode||r.orderNumber||"",getDate(r,"created"),r.date||"",
      getDate(r,"closed"),r.name,r.master,r.status,r.reportPrice==null?"":r.reportPrice,
      r.reportReceived,r.reportSalary==null?"":r.reportSalary,r.reportProfit==null?"":r.reportProfit]);
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
  function mount(rootEl,{getOrders,startOpen=false,onBack=null}){
    if(!rootEl||typeof getOrders!=="function")throw Error("Отчёт не может загрузиться");
    rootEl.classList.add("pr-report-scope");
    const state={open:false,period:"month",basis:"created",status:"",search:"",from:"",to:"",visible:PAGE_SIZE};
    const menu=node("div","pr-menu");
    const card=button("Прибыль по заказам","pr-report-link",()=>{state.open=true;menu.hidden=true;detail.hidden=false;render()});
    card.append(node("span","pr-report-arrow","›"));
    const desc=node("p","pr-description","Список заказов, оплата, зарплата мастерам и доля компании.");
    menu.append(card,desc);
    const detail=node("section","pr-detail");detail.hidden=true;
    const heading=node("div","pr-heading");
    heading.append(button("‹ Отчёты","pr-back",()=>{
      if(typeof onBack==="function"){onBack();return;}
      state.open=false;detail.hidden=true;menu.hidden=false;
    }),
      node("h2","","Прибыль по заказам"));
    const controls=node("div","pr-controls");
    const period=makeSelect([["month","Текущий месяц"],["previous","Прошлый месяц"],["week","Эта неделя"],["all","За всё время"],["custom","Свой период"]],
      "Период отчёта",state.period,value=>{state.period=value;custom.hidden=value!=="custom";redraw()});
    const basis=makeSelect([["created","По дате создания"],["closed","По дате закрытия"],["appointment","По дате записи"]],
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
      const csv=csvFor(filterRows(getOrders(),state));
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
    info.append(node("summary","","Как считается прибыль?"));
    info.append(node("p","pr-explain","Прибыль = стоимость выполненного и оплаченного заказа − 50% Раулю − 1 500 ₽ Тимуру. Это доля компании до затрат на материалы, дорогу, налоги и другие расходы. Для остальных мастеров прибыль не рассчитывается без правил выплат."));
    const scroll=node("div","pr-scroll");
    const table=node("table","pr-table");
    // Stable per-column widths prevent jumps when filters change or rows are expanded.
    const columns=node("colgroup");
    for(const width of [100,118,164,124,130,140,155,155]){
      const col=node("col");col.style.width=width+"px";columns.append(col);
    }
    table.append(columns);
    const thead=node("thead");
    const tr=node("tr");
    for(const label of ["Заказ","Дата","Клиент","Статус","Цена","Платежи","Зарплата","Прибыль"]){
      const th=node("th","",label);th.scope="col";tr.append(th);
    }
    thead.append(tr);table.append(thead);
    const tbody=node("tbody");table.append(tbody);scroll.append(table);
    const more=node("div","pr-more");
    detail.append(heading,controls,custom,caption,scroll,more,info);
    rootEl.append(menu,detail);
    function redraw(){state.visible=PAGE_SIZE;render()}
    function render(){
      if(!state.open)return;
      const rows=filterRows(getOrders(),state);
      const totals=summary(rows);
      caption.textContent="Показаны "+Math.min(state.visible,rows.length)+" из "+rows.length+
        (totals.uncalculated?" · Без расчёта прибыли: "+totals.uncalculated:"");
      tbody.replaceChildren();
      // Like HelloClient: period totals go above individual orders, after the header.
      // Totals include every matching order, not just the visible page of 100.
      const totalRow=node("tr","pr-total-row");
      const totalCells=["Итого","","","",money(totals.price),
        money(totals.received),money(totals.salary),money(totals.profit)];
      totalCells.forEach((value,index)=>{
        const cell=node(index===0?"th":"td",index>=4?"pr-number":"",value);
        if(index===0)cell.scope="row";
        if(index>=6&&totals.uncalculated){
          cell.title="Доля рассчитана не по всем выполненным заказам: "+totals.uncalculated+" без расчёта";
        }
        totalRow.append(cell);
      });
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
          money(row.reportReceived),row.reportSalary==null?"—":money(row.reportSalary),
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
    if(startOpen){state.open=true;menu.hidden=true;detail.hidden=false;render();}
    return {render,isOpen:()=>state.open};
  }
  if(root)root.__rdCreateProfitReport=mount;
  if(typeof module!=="undefined"&&module.exports)module.exports={
    reportRow,summary,filterRows,bounds,moscowDay,csvFor,RAUL_PERCENT,TIMUR_PER_ORDER
  };
})(typeof window!=="undefined"?window:null);
