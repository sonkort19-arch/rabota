/* CRM «Работа»: read-only owner report, based on the orders already authorized by RLS.
 * "Доля компании" is before materials, fuel, tax and other expenses.
 */
"use strict";
(function(root){
  const TIME_ZONE="Europe/Moscow";
  const orderReference=root?.__rdOrderReference ||
    (typeof require==="function"?require("./order-model.js").orderReference:null);
  const PAGE_SIZE=100;
  const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
  const cents=n=>Math.round((Number(n)||0)*100);
  const money=n=>Number(n||0).toLocaleString("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2})+" ₽";
  const txt=v=>String(v==null?"":v);
  const moscowDateFormat=new Intl.DateTimeFormat("sv-SE",{
    timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"
  });
  function moscowDay(date){
    if(!date)return "";
    const parsed=new Date(date);
    return Number.isNaN(parsed.getTime())?"":moscowDateFormat.format(parsed);
  }
  function getDate(order,basis){
    if(basis==="closed")return order.completedAt?moscowDay(order.completedAt):"";
    if(basis==="appointment")return txt(order.date).slice(0,10);
    return order.createdAt?moscowDay(order.createdAt):"";
  }
  function reportRefunds(payroll){
    return payroll?.accounting?.refunds??(payroll?.state==="active"?payroll.refunds:undefined)??[];
  }
  function linkedExpenseTotals(orders,operations){
    const totals=new Map();
    if(!operations?.length)return totals;
    const ids=new Set(),byNumber=new Map();
    for(const order of orders){
      if(order.id==null)continue;
      const id=String(order.id),number=Number(order.orderNumber);
      ids.add(id);
      if(Number.isSafeInteger(number)&&number>0)
        byNumber.set(number,byNumber.has(number)?null:id);
    }
    // /Расходы stores a selected order number in this exact suffix of its note.
    // An explicit order_id takes precedence, including links outside this report.
    const expenses=new Map(operations.filter(row=>row?.id!=null).map(row=>[row.id,row]));
    for(const operation of expenses.values()){
      const amount=Number(operation.amount);
      if(operation.kind!=="expense"||operation.voided_at||!Number.isFinite(amount)||amount<=0)continue;
      let orderId=operation.order_id;
      if(orderId==null){
        const note=txt(operation.note);
        const suffix=/^\[[^\]\r\n]{1,25}\][^\r\n]* · Заказ №(\d{1,8})$/u.exec(note);
        orderId=suffix&&byNumber.get(Number(suffix[1]));
      }else orderId=String(orderId);
      if(ids.has(orderId))totals.set(orderId,(totals.get(orderId)??0)+cents(amount));
    }
    return totals;
  }
  function reportRow(order,options={}){
    const price=order.price==null||order.price===""?null:Number(order.price);
    const validPrice=price!=null&&Number.isFinite(price)&&price>=0;
    const paid=Boolean(order.paid);
    const versioned=options.payroll?.state==="active";
    const orderId=String(order.id);
    const refund=options.refundsByOrder
      ?options.refundsByOrder.get(orderId)
      :reportRefunds(options.payroll).find(item=>item.orderId===orderId);
    const hold=versioned?(options.holdsByOrder?
      options.holdsByOrder.get(orderId):options.payroll.holds?.find(item=>item.orderId===orderId)):null;
    const projection=versioned?(options.payrollByOrder?
      options.payrollByOrder.get(orderId):options.payroll.orders.find(item=>item.orderId===orderId)):null;
    const receipt=options.receiptsByOrder
      ?options.receiptsByOrder.get(orderId)
      :options.payroll?.accounting?.receipts?.find(item=>item.orderId===orderId);
    const travel=receipt?.travelAmount??Math.max(0,Number(order.travelAmount)||0);
    const receiptTravel=receipt?.travelAmount??0;
    const refundedTravel=refund?(refund.travelAmount??receiptTravel):0;
    const travelEarned=options.travelByOrder?options.travelByOrder.get(orderId)??0:
      round((options.payroll?.travelHistory??[]).reduce((total,event)=>
        event.orderId===orderId?total+event.delta:total,0));
    const totalPrice=validPrice?round(price+travel):null;
    const receiptWash=receipt?round(receipt.amount-receiptTravel):null;
    const paymentIsMissing=paid&&(order.paymentAmount==null||order.paymentAmount==="");
    const received=!refund&&receipt?receipt.amount:0;
    const paymentVerified=Boolean(paymentIsMissing&&receipt);
    const paymentAmountMissing=paymentIsMissing&&!receipt;
    const paymentMismatch=paid&&validPrice&&!paymentIsMissing&&Number.isFinite(Number(order.paymentAmount))&&
      round(Number(order.paymentAmount))!==totalPrice;
    const earned=order.status==="Выполнен"&&paid&&!refund;
    const masterId=options.payroll?.masterId||options.masterId;
    const raul=Boolean(masterId)&&(receipt?receipt.masterId:order.assignedUserId)===masterId;
    const calculated=!refund&&!hold?.payrollOnHold&&Boolean(receipt&&(projection||!raul));
    const salary=calculated?(projection?round(projection.actualPaid-projection.companyShare):0):null;
    const profit=calculated?projection?.companyShare??receiptWash:null;
    const expenses=(options.expensesByOrder?.get(orderId)??0)/100;
    const uncoveredTravel=Math.max(0,round(travelEarned-receiptTravel+refundedTravel));
    const holdReference=!order.referenceCode?orderReference?.code(hold?.orderNumber):null;
    return Object.assign({},order,holdReference?{orderNumber:hold.orderNumber,referenceCode:holdReference}:null,{
      status:refund?"Отменён":order.status,
      reportPrice:validPrice?price:null,
      reportTravel:travel,reportTotalPrice:totalPrice,reportTravelReceived:receiptTravel,
      reportTravelRefunded:refundedTravel,reportTravelEarned:travelEarned,
      reportTravelUncovered:uncoveredTravel,
      reportReceived:received,reportEarned:!refund&&(earned||Boolean(projection)),reportCalculated:calculated,
      reportSalary:salary,reportProfit:profit,
      reportAccruedSalary:(cents(salary)+cents(travelEarned))/100,
      reportExpenses:expenses,reportNetProfit:(cents(profit)-cents(uncoveredTravel)-cents(expenses))/100,
      reportCalculationAmount:projection?.actualPaid??receiptWash,
      reportRuleVersion:projection?.ruleVersion??null,
      reportRefundedAmount:refund?.amount??null,
      reportPaymentMissing:!refund&&paymentAmountMissing,reportPaymentMismatch:!refund&&paymentMismatch,
      reportPaymentVerified:!refund&&paymentVerified,reportPaymentUnverified:!refund&&paid&&!receipt,
      reportPayrollOnHold:Boolean(hold?.payrollOnHold),reportCashOnHold:Boolean(hold?.cashOnHold),
      reportHoldReason:hold?.reason??"",
      reportReason:earned&&!calculated&&!hold?.payrollOnHold?
        "Нет подтверждённого финансового расчёта по заказу":""
    });
  }
  function summary(rows){
    const total={count:rows.length,price:0,received:0,salary:0,profit:0,uncalculated:0,missingPayments:0,mismatchedPayments:0};
    const road={travel:0,travelReceived:0,travelRefunded:0,travelEarned:0};
    rows.forEach(row=>{
      total.price=round(total.price+(row.reportPrice??0));
      total.received=round(total.received+row.reportReceived);
      road.travel=round(road.travel+(row.reportTravel??0));
      road.travelReceived=round(road.travelReceived+(row.reportTravelReceived??0));
      road.travelRefunded=round(road.travelRefunded+(row.reportTravelRefunded??0));
      road.travelEarned=round(road.travelEarned+(row.reportTravelEarned??0));
      if(row.reportPaymentMissing)total.missingPayments++;
      if(row.reportPaymentMismatch)total.mismatchedPayments++;
      if(row.reportCalculated){
        total.salary=round(total.salary+row.reportSalary);
        total.profit=round(total.profit+row.reportProfit);
      }else if(row.reportEarned)total.uncalculated++;
    });
    if(Object.values(road).some(value=>value>0))Object.assign(total,road,{
      travelUncovered:Math.max(0,round(road.travelEarned-road.travelReceived+road.travelRefunded))
    });
    return total;
  }
  function financialSummary(rows){
    let revenue=0,salary=0,expenses=0,profit=0,paid=0,unverified=0;
    for(const row of rows){
      revenue+=cents(row.reportReceived);
      salary+=cents(row.reportAccruedSalary);
      expenses+=cents(row.reportExpenses);
      profit+=cents(row.reportNetProfit);
      if(row.reportReceived>0)paid++;
      if(row.reportPayrollOnHold||row.reportPaymentUnverified||(row.reportEarned&&!row.reportCalculated))unverified++;
    }
    return {count:rows.length,revenue:revenue/100,salary:salary/100,expenses:expenses/100,
      profit:profit/100,average:paid?Math.round(revenue/paid)/100:0,paid,unverified};
  }
  function bounds(period,today,customFrom,customTo){
    if(period==="all")return ["",""];
    if(period==="custom")return [customFrom||"",customTo||""];
    if(period==="today")return [today,today];
    if(period==="yesterday"){
      const day=new Date(today+"T12:00:00Z");
      day.setUTCDate(day.getUTCDate()-1);
      const yesterday=day.toISOString().slice(0,10);
      return [yesterday,yesterday];
    }
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
    const payrollByOrder=options.payroll?.state==="active"?
      new Map(options.payroll.orders.map(item=>[item.orderId,item])):null;
    const travelByOrder=new Map();
    for(const event of options.payroll?.travelHistory??[])
      travelByOrder.set(event.orderId,round((travelByOrder.get(event.orderId)??0)+event.delta));
    const expensesByOrder=linkedExpenseTotals(orders,options.operations);
    const rowOptions=options.payroll?{...options,payrollByOrder,travelByOrder,expensesByOrder,
      receiptsByOrder:new Map((options.payroll.accounting?.receipts??[]).map(item=>[item.orderId,item])),
      refundsByOrder:new Map(reportRefunds(options.payroll).map(item=>[item.orderId,item])),
      holdsByOrder:new Map((options.payroll.holds??[]).map(item=>[item.orderId,item]))}:{...options,expensesByOrder};
    const dateRows=from||to?orders.filter(order=>{
      const day=getDate(order,options.basis||"closed");
      return day&&(!from||day>=from)&&(!to||day<=to);
    }):orders;
    return dateRows.map(order=>reportRow(order,rowOptions)).filter(row=>{
      if(options.status==="paid"&&(!row.paid||row.reportRefundedAmount))return false;
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
    if(Number.isFinite(value))return String(value);
    let s=txt(value);
    if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  function holdDetails(row){
    return [
      row.reportPayrollOnHold?"Начисление на сверке":"",
      row.reportCashOnHold?"Архив сверки":"",
      row.reportHoldReason
    ].filter(Boolean);
  }
  function csvFor(rows){
    const cols=["Заказ","Дата создания","Дата записи","Дата закрытия","Клиент","Мастер","Статус","Цена промывки","Учтённая оплата","Зарплата за промывку","Доля компании","Сведения о сумме оплаты",
      "Дорога","Итого по заказу","Поступило за дорогу","Возвращено за дорогу","Начислено за дорогу","Дорога за счёт компании"];
    const data=rows.map(r=>[r.referenceCode||r.orderNumber||"",getDate(r,"created"),r.date||"",
      getDate(r,"closed"),r.name,r.master,r.status,r.reportPrice==null?"":r.reportPrice,
      r.reportPaymentUnverified?"":r.reportReceived,r.reportPayrollOnHold?"На сверке":r.reportSalary??"",r.reportProfit??"",
      [
        r.reportRefundedAmount?"Подтверждён возврат "+money(r.reportRefundedAmount):
        !r.paid?"Не оплачено":r.reportPaymentMissing?"Сумма платежа не указана":
        r.reportPaymentMismatch?"Оплата отличается от цены":
        r.reportPaymentVerified?"Сумма подтверждена сверкой":"Сумма указана",
        ...holdDetails(r)
      ].join(" · "),r.reportTravel??0,r.reportTotalPrice??"",r.reportTravelReceived??0,r.reportTravelRefunded??0,
      r.reportTravelEarned??0,r.reportTravelUncovered??0]);
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
  function mount(rootEl,{getOrders,getRaulMasterId=null,getFinanceStatus=null,getPayroll=null,getOperations=null,
    startOpen=false,embedded=false,onBack=null,onOpenChange=null,onRetry=null}){
    if(!rootEl||typeof getOrders!=="function")throw Error("Отчёт не может загрузиться");
    rootEl.classList.add("pr-report-scope");
    const state={open:false,period:"month",basis:"closed",status:"",search:"",from:"",to:"",visible:PAGE_SIZE};
    const expanded=new Set();
    let renderKey=null,renderedOrders=null,renderedOperations=null;
    const menu=node("div","pr-menu");
    const detail=node("section","pr-detail");detail.hidden=true;
    let back=null;
    if(!embedded){
      const heading=node("header","pr-heading");
      back=button("Назад","pr-back",()=>onBack?onBack():setOpen(false));
      back.setAttribute("aria-label","Назад к отчётам");
      heading.append(back,node("h2","","Прибыль по заказам"));
      detail.append(heading);
    }
    const card=button("Прибыль по заказам","pr-report-link",()=>{
      setOpen(true);
      back?.focus({preventScroll:true});
    });
    card.append(node("span","pr-report-arrow","›"));
    const desc=node("p","pr-description","Список заказов, оплата, зарплата мастерам и доля компании.");
    menu.append(card,desc);
    function setOpen(open){
      if(state.open===open)return;
      state.open=open;menu.hidden=open;detail.hidden=!open;
      onOpenChange?.(open);
      if(open)render();
      else card.focus({preventScroll:true});
    }
    const controls=node("div","pr-controls");
    const period=makeSelect([["month","Текущий месяц"],["previous","Прошлый месяц"],["week","Эта неделя"],
      ["today","Сегодня"],["yesterday","Вчера"],["all","За всё время"],["custom","Свой период"]],
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
      if(download.disabled)return;
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
    const message=node("span");
    const retry=button("Повторить","secondary pr-retry",()=>{
      if(typeof onRetry==="function")void onRetry();
      else void root?.__rdMoneyUi?.refreshFinance?.();
    });
    const financeStatus=node("div","pr-finance-status");financeStatus.hidden=true;
    financeStatus.append(message,retry);
    const info=node("details","pr-info");
    info.append(node("summary","","Как считается доля компании?"));
    const explanation=node("p","pr-explain");
    info.append(explanation);
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
    for(const label of ["Заказ","Дата","Клиент","Статус","Промывка","Платежи","Зарплата","Доля компании"]){
      const th=node("th","",label);th.scope="col";tr.append(th);
    }
    thead.append(tr);table.append(thead);
    const tbody=node("tbody");table.append(tbody);scroll.append(table);
    const more=node("div","pr-more");
    detail.append(controls,custom,financeStatus,caption,scroll,more,info);
    rootEl.append(menu,detail);
    function queryRows(orders=getOrders(),masterId=getRaulMasterId?.(),today=moscowDay(new Date()),
      payroll=getPayroll?.(),operations=getOperations?.()){
      const options={...state,today,payroll,operations};
      if(typeof getRaulMasterId==="function")options.masterId=masterId;
      return filterRows(orders,options);
    }
    function redraw(){state.visible=PAGE_SIZE;render()}
    function render(){
      if(!state.open)return;
      const finance=getFinanceStatus?.();
      const unavailable=finance?!(finance.ready??!(finance.loading||finance.error)):false;
      const stale=Boolean(finance?.stale||finance?.refreshError);
      scroll.hidden=unavailable;download.disabled=unavailable||stale;
      caption.hidden=unavailable;
      const statusText=finance?.error?"Не удалось загрузить расчёты. "+finance.error:
        unavailable?"Загружаем данные отчёта…":
        stale?"Показан последний рассчитанный отчёт. Перед выгрузкой обновите данные."+
          (finance.refreshError?" "+finance.refreshError:""):"";
      financeStatus.hidden=!statusText;
      retry.hidden=!(finance?.error||stale);
      if(message.textContent!==statusText)message.textContent=statusText;
      message.setAttribute("role",finance?.error||finance?.refreshError?"alert":"status");
      if(unavailable){
        if(tbody.firstChild)tbody.replaceChildren();
        if(more.firstChild)more.replaceChildren();
        renderKey=null;renderedOrders=null;renderedOperations=null;expanded.clear();
        return;
      }
      const orders=getOrders(),masterId=getRaulMasterId?.(),today=moscowDay(new Date()),payroll=getPayroll?.();
      const operations=getOperations?.();
      const versioned=payroll?.state==="active";
      const explanationText=
        "После полной оплаты зарплата Рауля за промывку составляет 50% её стоимости плюс 1 500 ₽. Доплата за дорогу начисляется отдельно при сохранении заказа. Доля компании равна стоимости промывки за вычетом зарплаты за промывку. Дорога за счёт компании показана отдельно. Исторические расчёты сохранены.";
      if(explanation.textContent!==explanationText)explanation.textContent=explanationText;
      const key=JSON.stringify([state,finance?.revision,masterId,today,versioned]);
      if(renderKey===key&&(finance?.revision!=null||renderedOrders===orders&&renderedOperations===operations))return;
      renderKey=key;renderedOrders=orders;renderedOperations=operations;
      const rows=queryRows(orders,masterId,today,payroll,operations);
      const totals=summary(rows);
      const heldCount=rows.filter(row=>row.reportPayrollOnHold||row.reportCashOnHold).length;
      const hasOnlyUnverifiedMargin=rows.some(row=>row.reportPayrollOnHold)&&!rows.some(row=>row.reportCalculated);
      caption.textContent="Показаны "+Math.min(state.visible,rows.length)+" из "+rows.length+
        (heldCount?" · На сверке: "+heldCount:"")+
        (totals.uncalculated?" · Без расчёта доли: "+totals.uncalculated:"")+
         (totals.missingPayments?" · Нет суммы платежа: "+totals.missingPayments:"")+
         (totals.mismatchedPayments?" · Оплата отличается от цены: "+totals.mismatchedPayments:"")+
         (totals.travel!==undefined?" · Дорога: получено "+money(totals.travelReceived)+
           (totals.travelRefunded?", возвращено "+money(totals.travelRefunded):"")+
           ", начислено "+money(totals.travelEarned)+
           (totals.travelUncovered?", за счёт компании "+money(totals.travelUncovered):""):"");
      if(getOperations){
        const values=financialSummary(rows);
        const reconciliation=node("span","pr-net-summary");
        for(const [key,label] of [["salary","Начисленная зарплата"],["expenses","Доп. расходы"],
          ["profit","Прибыль по заказам"],["average","Средний чек"]]){
          reconciliation.append(document.createTextNode(" · "+label+" "));
          const value=node("strong","",money(values[key]));
          value.dataset.reportMetric=key;
          reconciliation.append(value);
        }
        if(values.unverified)reconciliation.append(document.createTextNode(" · На сверке: "+values.unverified));
        caption.append(reconciliation);
      }
      tbody.replaceChildren();
      // Like HelloClient: period totals go above individual orders, after the header.
      // Totals include every matching order, not just the visible page of 100.
      const totalRow=node("tr","pr-total-row");
      const totalCells=["Итого","","","",money(totals.price),
        money(totals.received)+(totals.missingPayments?"*":""),hasOnlyUnverifiedMargin?"—":money(totals.salary),
        hasOnlyUnverifiedMargin?"—":money(totals.profit)];
      totalCells.forEach((value,index)=>{
        const cell=node(index===0?"th":"td",index>=4?"pr-number":"",value);
        if(index===0)cell.scope="row";
        if(index>=6&&totals.uncalculated){
          cell.title="Доля рассчитана не по всем выполненным заказам: "+totals.uncalculated+" без расчёта";
        }
        totalRow.append(cell);
      });
      if(totals.missingPayments)totalRow.children[5].title=
        "В части заказов нет подтверждённой суммы платежа. Уточнения указаны в строках отчёта.";
      tbody.append(totalRow);
      if(!rows.length){
        const empty=node("tr");const cell=node("td","pr-empty","Заказов по выбранным фильтрам нет.");
        cell.colSpan=8;empty.append(cell);tbody.append(empty);
      }
      for(const row of rows.slice(0,state.visible)){
        const tr=node("tr"),id=row.referenceCode||row.orderNumber||"—";
        const expandedKey=String(row.id??id);
        const open=button(id,"pr-row-open",()=>{
          extra.hidden=!extra.hidden;
          if(extra.hidden)expanded.delete(expandedKey);
          else expanded.add(expandedKey);
          open.setAttribute("aria-expanded",String(!extra.hidden));
        });
        open.setAttribute("aria-expanded",String(expanded.has(expandedKey)));
        const first=node("td");first.append(open);tr.append(first);
        const values=[getDate(row,state.basis)||"—",row.name||"Без имени",
          row.status||"—",row.reportPrice==null?"—":money(row.reportPrice),
          row.reportRefundedAmount?"Возврат":row.reportPaymentUnverified?"—":
            money(row.reportReceived)+(row.reportPaymentMissing?"*":""),
          row.reportPayrollOnHold?"На сверке":row.reportSalary==null?"—":money(row.reportSalary),
          row.reportProfit==null?"—":money(row.reportProfit)];
        values.forEach((value,i)=>tr.append(node("td",i>=3?"pr-number":"",value)));
        tbody.append(tr);
        const extra=node("tr","pr-expanded");extra.hidden=!expanded.has(expandedKey);
        const td=node("td");td.colSpan=8;
        const parts=[
          "Мастер: "+(row.master||"не назначен"),
          "Адрес: "+(row.address||"не указан"),
          "Дата записи: "+(row.date||"не указана")+(row.time?" в "+row.time:""),
          "Дата закрытия: "+(getDate(row,"closed")||"нет"),
          row.reportRefundedAmount?"Возврат: "+money(row.reportRefundedAmount):
            "Оплата: "+(row.paid?"да":"нет")+(row.paymentMethod?" · "+row.paymentMethod:""),
          "Источник: "+(row.clientSource||"не указан")
        ];
        if(row.reportCalculated)parts.push("Расчёт: "+money(row.reportCalculationAmount)+" − "+money(row.reportSalary)+" = "+money(row.reportProfit));
        if(row.reportTravel||row.reportTravelEarned||row.reportTravelReceived||row.reportTravelRefunded){
          parts.push("Дорога "+money(row.reportTravel),"Итого по заказу "+(row.reportTotalPrice==null?"—":money(row.reportTotalPrice)),
            "Получено за дорогу "+money(row.reportTravelReceived),"Начислено за дорогу "+money(row.reportTravelEarned));
          if(row.reportTravelRefunded)parts.push("Возвращено за дорогу "+money(row.reportTravelRefunded));
          if(row.reportTravelUncovered)parts.push("Дорога за счёт компании "+money(row.reportTravelUncovered));
        }
        if(row.reportPaymentVerified)parts.push("Сумма оплаты подтверждена сверкой");
        if(row.reportPaymentMissing)parts.push(row.reportPaymentUnverified?
          "Сумма оплаты пока не подтверждена":
          "Сумма оплаты ещё не подтверждена");
        if(row.reportPaymentMismatch)parts.push("Внимание: сумма оплаты отличается от стоимости заказа");
        if(row.reportReason)parts.push(row.reportReason);
        parts.push(...holdDetails(row));
        td.append(node("div","pr-expanded-content",parts.join(" · ")));
        extra.append(td);tbody.append(extra);
      }
      more.replaceChildren();
      if(state.visible<rows.length){
        more.append(button("Показать ещё "+Math.min(PAGE_SIZE,rows.length-state.visible),
          "pr-more-btn",()=>{state.visible+=PAGE_SIZE;render()}));
      }
    }
    if(startOpen)setOpen(true);
    return {render,isOpen:()=>state.open,close:()=>setOpen(false)};
  }
  const model={reportRow,summary,financialSummary,filterRows,bounds,moscowDay,quoteCsv,csvFor};
  if(root){
    root.__rdCreateProfitReport=mount;
    root.__rdProfitReportModel=model;
  }
  if(typeof module!=="undefined"&&module.exports)module.exports=model;
})(typeof window!=="undefined"?window:null);
