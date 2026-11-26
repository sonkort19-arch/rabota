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
  function activeExpenses(operations){
    const byId=new Map((operations??[]).filter(row=>row?.id!=null).map(row=>[row.id,row]));
    return [...byId.values()].filter(row=>{
      const amount=Number(row.amount);
      return row.kind==="expense"&&!row.voided_at&&!row.voidedAt&&Number.isFinite(amount)&&amount>0;
    });
  }
  function expenseOrderNumber(operation){
    // /Расходы stores a selected order number in this exact suffix of its note.
    const match=linkedExpenseNote(operation.note);
    return match?Number(match[3]):null;
  }
  function linkedExpenseNote(note){
    return /^\[([^\]\r\n]{1,25})\]([^\r\n]*) · Заказ №(\d{1,8})$/u.exec(txt(note));
  }
  function expenseLabel(note){
    const parsed=linkedExpenseNote(note)??/^\[([^\]\r\n]{1,25})\]\s*([\s\S]*)$/u.exec(txt(note));
    const description=parsed?parsed[2].trim()||parsed[1]:txt(note);
    return description.replace(/\s+/gu," ").trim()||"Расход по заказу";
  }
  function expenseOrderId(operation){return operation.order_id??operation.orderId;}
  function linkedExpensesByOrder(orders,operations){
    const linked=new Map();
    if(!operations?.length)return linked;
    const ids=new Set(),byNumber=new Map();
    for(const order of orders){
      if(order.id==null)continue;
      const id=String(order.id),number=Number(order.orderNumber);
      ids.add(id);
      if(Number.isSafeInteger(number)&&number>0)
        byNumber.set(number,byNumber.has(number)?null:id);
    }
    // An explicit order_id takes precedence, including links outside this report.
    for(const operation of activeExpenses(operations)){
      const explicitId=expenseOrderId(operation);
      const orderId=explicitId==null?byNumber.get(expenseOrderNumber(operation)):String(explicitId);
      if(!ids.has(orderId))continue;
      const expense=linked.get(orderId)??{cents:0,items:[]};
      const amount=cents(operation.amount);
      expense.cents+=amount;
      expense.items.push({label:expenseLabel(operation.note),amount:amount/100});
      linked.set(orderId,expense);
    }
    return linked;
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
    const expenses=options.expensesByOrder?.get(orderId);
    const expensesTotal=(expenses?.cents??0)/100;
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
      reportExpenses:expensesTotal,reportExpenseItems:expenses?.items??[],
      reportNetProfit:(cents(profit)-cents(uncoveredTravel)-(expenses?.cents??0))/100,
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
      if(awaitsCalculation(row))unverified++;
    }
    return {count:rows.length,revenue:revenue/100,salary:salary/100,expenses:expenses/100,
      profit:profit/100,average:paid?Math.round(revenue/paid)/100:0,paid,unverified};
  }
  function awaitsCalculation(row){
    return Boolean(row.reportPayrollOnHold||row.reportPaymentUnverified||(row.reportEarned&&!row.reportCalculated));
  }
  function orderProfit(row){return awaitsCalculation(row)?null:row.reportNetProfit;}
  function reconciliationReasons(row){
    return [...new Set([
      row.reportPaymentUnverified ? "Оплата отсутствует в учёте" :
        row.reportPaymentMismatch ? "Оплата отличается от стоимости заказа" : "",
      row.reportPayrollOnHold ? "Начисление зарплаты на сверке" : row.reportReason,
      row.reportCashOnHold ? "Архивная операция на сверке" : "",
      row.reportHoldReason
    ].filter(Boolean))];
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
  function companySummary(rows,{operations,cashbookEntries,period="all",today=moscowDay(new Date()),from,to}={}){
    if(!Array.isArray(operations)||!Array.isArray(cashbookEntries))return null;
    const [start,end]=bounds(period,today,from,to);
    if(start&&end&&start>end)return null;
    function expenseCents(ledger){
      return ledger.reduce((total,row)=>{
        const day=moscowDay(row.created_at??row.occurredAt);
        const inPeriod=(!start&&!end)||(day&&(!start||day>=start)&&(!end||day<=end));
        return total+(inPeriod?cents(row.amount):0);
      },0);
    }
    const commonCrm=activeExpenses(operations).filter(row=>expenseOrderId(row)==null&&expenseOrderNumber(row)==null);
    const crm=expenseCents(commonCrm),cashbook=expenseCents(activeExpenses(cashbookEntries));
    const orderProfit=financialSummary(rows).profit;
    return {orderProfit,crmExpenses:crm/100,cashbookExpenses:cashbook/100,
      commonExpenses:(crm+cashbook)/100,netProfit:(cents(orderProfit)-crm-cashbook)/100};
  }
  const DAY_MS=86400000;
  const utcDay=calendarDay=>Date.parse(calendarDay+"T00:00:00Z");
  const isoDay=milliseconds=>new Date(milliseconds).toISOString().slice(0,10);
  function profitTrend(rows,{period="all",basis="closed",today=moscowDay(new Date()),from,to}={}){
    const [start,end]=bounds(period,today,from,to);
    let first=Infinity,last=-Infinity,undated=0;
    const dated=[];
    for(const row of rows){
      const day=utcDay(getDate(row,basis));
      if(!Number.isFinite(day)){undated++;continue;}
      first=Math.min(first,day);
      last=Math.max(last,day);
      dated.push({day,row});
    }
    const min=start?utcDay(start):first,max=end?utcDay(end):last;
    if(!dated.length||!Number.isFinite(min)||!Number.isFinite(max)||min>max)
      return {points:[],undated,granularity:"day"};
    const days=(max-min)/DAY_MS+1;
    const granularity=days<=7?"day":days<=63?"week":days<=370?"month":"year";
    const firstYear=new Date(min).getUTCFullYear(),lastYear=new Date(max).getUTCFullYear();
    const yearsPerPoint=Math.ceil((lastYear-firstYear+1)/12);
    function bucketStart(day){
      const date=new Date(day),year=date.getUTCFullYear();
      if(granularity==="week")return day-((date.getUTCDay()+6)%7)*DAY_MS;
      if(granularity==="month")return date.setUTCDate(1);
      if(granularity==="year")return date.setUTCFullYear(firstYear+Math.floor((year-firstYear)/yearsPerPoint)*yearsPerPoint,0,1);
      return day;
    }
    function bucketEnd(day){
      const date=new Date(day),year=date.getUTCFullYear();
      if(granularity==="month")return date.setUTCMonth(date.getUTCMonth()+1,1)-DAY_MS;
      if(granularity==="year")return date.setUTCFullYear(year+yearsPerPoint,0,1)-DAY_MS;
      return day+(granularity==="week"?6:0)*DAY_MS;
    }
    const buckets=new Map();
    for(let start=bucketStart(min);start<=max;){
      const end=bucketEnd(start);
      buckets.set(start,{from:isoDay(Math.max(min,start)),to:isoDay(Math.min(max,end)),
        sum:0,orders:0,unverified:0,known:false});
      start=end+DAY_MS;
    }
    for(const {day,row} of dated){
      if(day<min||day>max)continue;
      const bucket=buckets.get(bucketStart(day)),unverified=awaitsCalculation(row);
      bucket.orders++;
      if(unverified)bucket.unverified++;
      bucket.sum+=cents(row.reportNetProfit);
      bucket.known||=Boolean(row.reportCalculated||row.reportExpenses||row.reportTravelUncovered);
    }
    const points=[...buckets.values()].map(({sum,known,orders,unverified,...point})=>({
      ...point,orders,unverified,profit:!known&&unverified>0?null:sum/100
    }));
    return {points,undated,granularity};
  }
  function sortReportRows(rows,key="date",direction="desc",basis="closed"){
    const sign=direction==="asc"?1:-1;
    const byNewest=(a,b)=>b.day.localeCompare(a.day)||b.created.localeCompare(a.created);
    const orders=rows.map(row=>({row,day:getDate(row,basis),created:txt(row.createdAt||row.date)}));
    orders.sort((a,b)=>{
      if(key==="date")return Number(!a.day)-Number(!b.day)||-sign*byNewest(a,b);
      if(key==="client")return sign*txt(a.row.name).localeCompare(txt(b.row.name),"ru")||byNewest(a,b);
      const profit=key==="profit";
      const missing=row=>profit?awaitsCalculation(row):row.reportPaymentUnverified;
      const value=row=>profit?row.reportNetProfit:row.reportReceived;
      return Number(Boolean(missing(a.row)))-Number(Boolean(missing(b.row)))||
        sign*(value(a.row)-value(b.row))||byNewest(a,b);
    });
    return orders.map(order=>order.row);
  }
  function filterRows(orders,options={}){
    const today=options.today||moscowDay(new Date());
    const [from,to]=bounds(options.period||"all",today,options.from,options.to);
    const payrollByOrder=options.payroll?.state==="active"?
      new Map(options.payroll.orders.map(item=>[item.orderId,item])):null;
    const travelByOrder=new Map();
    for(const event of options.payroll?.travelHistory??[])
      travelByOrder.set(event.orderId,round((travelByOrder.get(event.orderId)??0)+event.delta));
    const expensesByOrder=linkedExpensesByOrder(orders,options.operations);
    const rowOptions=options.payroll?{...options,payrollByOrder,travelByOrder,expensesByOrder,
      receiptsByOrder:new Map((options.payroll.accounting?.receipts??[]).map(item=>[item.orderId,item])),
      refundsByOrder:new Map(reportRefunds(options.payroll).map(item=>[item.orderId,item])),
      holdsByOrder:new Map((options.payroll.holds??[]).map(item=>[item.orderId,item]))}:{...options,expensesByOrder};
    const dateRows=from||to?orders.filter(order=>{
      const day=getDate(order,options.basis||"closed");
      return day&&(!from||day>=from)&&(!to||day<=to);
    }):orders;
    return selectReportRows(dateRows.map(order=>reportRow(order,rowOptions)),options)
      .sort((a,b)=>txt(b.createdAt||b.date).localeCompare(txt(a.createdAt||a.date)));
  }
  function selectReportRows(rows,{status="",search=""}={}){
    const query=txt(search).trim().toLocaleLowerCase("ru-RU").replace(/^[№#]\s*/,"");
    return rows.filter(row=>{
      if(status==="paid"&&!(row.reportReceived>0))return false;
      if(status==="unpaid"&&(row.paid||row.reportReceived>0||row.reportRefundedAmount))return false;
      if(status&&status!=="paid"&&status!=="unpaid"&&row.status!==status)return false;
      if(query){
        const hay=[row.orderNumber,row.referenceCode,row.name,row.phone,row.address,row.master,row.clientSource].
          map(txt).join(" ").toLocaleLowerCase("ru-RU");
        if(!hay.includes(query))return false;
      }
      return true;
    });
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
      "Дорога","Итого по заказу","Поступило за дорогу","Возвращено за дорогу","Начислено за дорогу","Дорога за счёт компании",
      "Начислено всего","Расходы по заказу","Прибыль по заказу"];
    const data=rows.map(r=>[r.referenceCode||r.orderNumber||"",getDate(r,"created"),r.date||"",
      getDate(r,"closed"),r.name,r.master,r.status,r.reportPrice==null?"":r.reportPrice,
      r.reportPaymentUnverified?"":r.reportReceived,r.reportPayrollOnHold?"На сверке":r.reportSalary??"",r.reportProfit??"",
      [
        r.reportRefundedAmount?"Подтверждён возврат "+money(r.reportRefundedAmount):
        !r.paid&&!(r.reportReceived>0)?"Не оплачено":r.reportPaymentMissing?"Сумма платежа не указана":
        r.reportPaymentMismatch?"Оплата отличается от цены":
        r.reportPaymentVerified?"Сумма подтверждена сверкой":"Сумма указана",
        ...holdDetails(r)
      ].join(" · "),r.reportTravel??0,r.reportTotalPrice??"",r.reportTravelReceived??0,r.reportTravelRefunded??0,
      r.reportTravelEarned??0,r.reportTravelUncovered??0,
      awaitsCalculation(r)?"":r.reportAccruedSalary,r.reportExpenses,orderProfit(r)??""]);
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
  const reportTitle="Прибыль по заказам";
  const periods=[["month","Текущий месяц"],["today","Сегодня"],["yesterday","Вчера"],["week","Эта неделя"],
    ["previous","Прошлый месяц"],["all","За всё время"],["custom","Свой период"]];
  const dateBases=[["closed","По дате закрытия"],["created","По дате создания"],["appointment","По дате записи"]];
  const statuses=[["","Все статусы"],["Записан","Записан"],["В работе","В работе"],["Выполнен","Выполнен"],
    ["Отменён","Отменён"],["paid","Оплачены"],["unpaid","Не оплачены"]];
  const sorts=[["date-desc","Сначала новые"],["date-asc","Сначала старые"],["profit-desc","Прибыль ↓"],
    ["profit-asc","Прибыль ↑"],["revenue-desc","Выручка ↓"],["client-asc","По имени клиента"]];
  const monthFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",month:"long",year:"numeric"});
  const dateFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",day:"numeric",month:"short"});
  const intervalFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"});
  const numberFormat=new Intl.NumberFormat("ru-RU");
  const compactFormat=new Intl.NumberFormat("ru-RU",{notation:"compact",maximumFractionDigits:1});
  const plural=new Intl.PluralRules("ru-RU");
  const defaultFilters={period:"month",basis:"closed",status:"",from:"",to:""};
  const empty=[];
  const titleByView={overview:reportTitle,orders:reportTitle,review:"Финансовая сверка",net:"Чистая прибыль",filters:"Период и фильтры"};
  const icons={
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    filter:'<path d="M3 6h18M6 12h12m-9 6h6"/><circle cx="7" cy="6" r="2" fill="white"/><circle cx="15" cy="12" r="2" fill="white"/>',
    down:'<path d="m6 9 6 6 6-6"/>',next:'<path d="m9 6 6 6-6 6"/>',
    search:'<circle cx="10.7" cy="10.7" r="6"/><path d="m15.1 15.1 4.3 4.3"/>',
    download:'<path d="M12 3v11m-4-4 4 4 4-4M4 16v4h16v-4"/>',
    review:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5m0 4h.01"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'
  };
  let nextReportId=0;
  function svgElement(tag,attributes={}){
    const entry=document.createElementNS("http://www.w3.org/2000/svg",tag);
    for(const [key,value] of Object.entries(attributes))entry.setAttribute(key,value);
    return entry;
  }
  function icon(name){
    const entry=svgElement("svg",{class:"pr-icon",viewBox:"0 0 24 24",width:24,height:24,fill:"none",
      stroke:"currentColor","stroke-width":1.8,"stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"});
    entry.innerHTML=icons[name];
    return entry;
  }
  function append(parent,...children){parent.append(...children);return parent;}
  function select(items,aria){
    const control=node("select");
    control.setAttribute("aria-label",aria);
    for(const [value,label] of items){
      const option=node("option","",label);option.value=value;control.append(option);
    }
    return control;
  }
  function formatDay(day,format=dateFormat){
    const date=new Date(day+"T12:00:00Z");
    return Number.isFinite(date.getTime())?format.format(date):"";
  }
  function formatInterval(from,to,format=intervalFormat){
    if(!from||!to)return "";
    if(from===to)return formatDay(from,format);
    if(typeof format.formatRange==="function")return format.formatRange(new Date(from+"T12:00:00Z"),new Date(to+"T12:00:00Z"));
    return formatDay(from,format)+" – "+formatDay(to,format);
  }
  function orderCount(value){
    const endings={one:"заказ",few:"заказа",many:"заказов",other:"заказа"};
    return numberFormat.format(value)+" "+endings[plural.select(value)];
  }
  function formatAmount(value){return value==null?"—":money(value);}
  function paintAmount(element,value){
    element.textContent=formatAmount(value);
    element.classList.toggle("pr-negative",value<0);
  }
  function reference(row){return row.referenceCode||(row.orderNumber?"№"+row.orderNumber:"");}
  function reportMoneyRow(label,value){
    const valueNode=node("dd");paintAmount(valueNode,value);
    return append(node("div","pr-detail-line"),node("dt","",label),valueNode);
  }
  function moneyCard(title,value,lines,accent=false){
    const total=node("strong");paintAmount(total,value);
    const card=append(node("section","pr-detail-card"+(accent?" pr-detail-total":"")),
      append(node("div","pr-detail-head"),node("h3","",title),total));
    if(lines.length)card.append(append(node("dl"),...lines.map(([label,amount])=>reportMoneyRow(label,amount))));
    return card;
  }
  function mount(rootEl,{getOrders,getRaulMasterId,getFinanceStatus,getPayroll,getOperations,
    getCompanyStatus,onLoadCompany,startOpen=false,embedded=false,onBack,onOpenChange,onViewChange,onRetry}){
    if(!rootEl||typeof getOrders!=="function")throw Error("Отчёт не может загрузиться");
    rootEl.classList.add("pr-report-scope");
    const id=++nextReportId;
    let active=false,view="overview",filters={...defaultFilters},draft=null,searchTerm="",sortKey=sorts[0][0],
      visible=PAGE_SIZE,orderId=null,chartKey=null;
    let cached=null,cachedCompany=null,overviewData,chartData,listData=null,orderData=null,
      reviewData=null,netData=null;
    const trail=[];
    const tabScroll={overview:0,orders:0};
    const scrollTo=(value)=>root?.__rdViewportScroll?.restore(value);
    const scrollPosition=()=>root?.__rdViewportScroll?.position()??0;
    const doc=rootEl.ownerDocument;
    const menu=node("div","pr-menu");
    const detail=node("section","pr-detail");detail.hidden=true;
    const entry=button(reportTitle,"pr-report-link",open);
    entry.append(node("span","pr-report-arrow","›"));
    menu.append(entry);
    const localBack=embedded?null:button("Назад","pr-back",back);
    const localTitle=embedded?null:node("h2","",reportTitle);
    if(localBack)detail.append(append(node("header","pr-heading"),localBack,localTitle));
    const headerBack=()=>embedded?doc.getElementById("rdScreenBack"):localBack;
    const periodName=node("span");
    const periodButton=button("","pr-period-control",event=>enter("filters",event.currentTarget));
    periodButton.append(icon("calendar"),periodName,icon("down"));
    const filterButton=button("","pr-filter-button",event=>enter("filters",event.currentTarget));
    filterButton.setAttribute("aria-label","Фильтры отчёта");
    filterButton.append(icon("filter"));
    const periodCaption=node("p","pr-period-caption");
    const toolbar=append(node("div","pr-toolbar"),periodButton,filterButton,periodCaption);
    const tabs=node("div","pr-tabs");
    tabs.setAttribute("aria-label","Экраны отчёта");
    const tabButtons={};
    for(const [name,label] of [["overview","Обзор"],["orders","Заказы"]]){
      const tab=button(label,"",()=>switchTab(name));
      tab.setAttribute("aria-controls","pr-"+name+"-"+id);
      tabs.append(tab);tabButtons[name]=tab;
    }

    const warningText=node("span");
    const warningRetry=button("Повторить","secondary pr-retry",()=>void retryFinance());
    const warning=append(node("div","pr-finance-status pr-data-error"),warningText,warningRetry);
    const overview=node("section","pr-overview");overview.id="pr-overview-"+id;
    const metrics=node("div","pr-metrics");
    metrics.setAttribute("aria-label","Итоги за период");
    const metricsValues={};
    for(const [key,label] of [["count","Всего заказов"],["revenue","Выручка"],["salary","Начислено зарплаты"],["profit","Прибыль по заказам"]]){
      const value=node("strong");
      metricsValues[key]=value;
      const metric=append(node("div","pr-metric"),node("span","",label),value);
      metric.dataset.metric=key;
      metrics.append(metric);
    }
    const paidCount=node("small","pr-paid-count");
    metrics.firstElementChild.append(paidCount);
    const avg=node("strong");
    const avgNote=node("small","","По оплаченным заказам");
    const average=append(node("div","pr-average"),node("span","","Средний чек"),avg,avgNote);
    const secondary=append(node("div","pr-secondary"),average);
    const netValue=node("strong");
    const netNote=node("small","","После общих расходов");
    const netButton=onLoadCompany?button("","pr-net-card",event=>enter("net",event.currentTarget)):null;
    if(netButton){
      netButton.dataset.metric="net";
      netButton.append(append(node("span","pr-net-copy"),node("span","","Чистая прибыль"),netValue,netNote),icon("info"));
      secondary.append(netButton);
    }
    const chart=node("section","pr-chart");
    const chartSelected=node("output","pr-chart-selected");
    chartSelected.setAttribute("aria-live","polite");
    const chartScale=node("div","pr-chart-scale"),plot=node("div","pr-plot");
    const chartFrame=append(node("div","pr-chart-frame"),chartScale,plot);
    const ticks=node("div","pr-chart-ticks");
    const chartFoot=node("p","pr-chart-foot");
    const chartEmpty=node("p","pr-chart-empty");
    chart.append(append(node("div","pr-chart-head"),node("h3","","Динамика прибыли"),chartSelected),
      chartFrame,ticks,chartEmpty,chartFoot);
    const reviewLabel=node("strong");
    const reviewLink=button("","pr-review-link",event=>enter("review",event.currentTarget));
    reviewLink.append(icon("review"),append(node("span","pr-review-copy"),reviewLabel,
      node("small","","В итогах показаны подтверждённые суммы.")),icon("next"));
    const revenueHelp=node("p","pr-footnote","Выручка — подтверждённые оплаты с учётом возвратов.");
    overview.append(metrics,secondary,chart,reviewLink,revenueHelp);

    const list=node("section","pr-list");list.id="pr-orders-"+id;
    const search=node("input");search.type="search";search.placeholder="Номер заказа, клиент или телефон";
    search.setAttribute("aria-label","Поиск по заказам");
    search.addEventListener("input",()=>{
      searchTerm=search.value;visible=PAGE_SIZE;render();
    });
    const sorter=select(sorts,"Сортировка заказов");
    sorter.addEventListener("change",()=>{sortKey=sorter.value;visible=PAGE_SIZE;render();});
    const csv=button("","pr-export",exportCsv);csv.setAttribute("aria-label","Скачать CSV");
    csv.append(icon("download"),node("span","","CSV"));
    const resultCount=node("p","pr-result-count");
    const resultHeading=append(node("div","pr-list-heading"),resultCount,node("span","","Прибыль по заказу"));
    const listRows=node("ul","pr-order-list");listRows.setAttribute("aria-label","Заказы отчёта");
    const listEmpty=node("p","pr-empty");
    const more=button("Показать ещё","pr-more-btn",()=>{visible+=PAGE_SIZE;render();});
    list.append(append(node("div","pr-list-tools"),
      append(node("label","pr-search"),icon("search"),search),
      append(node("div","pr-list-actions"),sorter,csv)),resultHeading,listRows,listEmpty,more);
    const orderView=node("section","pr-order-detail");
    const reconcileView=node("section","pr-reconcile");
    const netView=node("section","pr-company-detail");
    const filterView=node("form","pr-filter-view");
    const customDates=node("div","pr-custom");
    const dateInputs={};
    for(const [key,label] of [["from","Начало периода"],["to","Конец периода"]]){
      const input=node("input");input.type="date";
      input.setAttribute("aria-label",label);
      input.addEventListener("change",()=>{draft[key]=input.value;filterError.hidden=true;});
      customDates.append(append(node("label"),node("span","",label),input));
      dateInputs[key]=input;
    }
    function choices(items,title,key){
      const group=node("fieldset","pr-filter-group");group.setAttribute("aria-label",title);
      group.append(node("legend","",title));
      const rows=node("div","pr-filter-options");
      for(const [value,label] of items){
        const option=node("input");option.type="radio";option.name="pr-"+key+"-"+id;option.value=value;
        option.addEventListener("change",()=>{
          if(!option.checked)return;
          draft[key]=value;
          customDates.hidden=draft.period!=="custom";
          filterError.hidden=true;
        });
        rows.append(append(node("label","pr-radio"),node("span","",label),option));
      }
      group.append(rows);return group;
    }
    const periodOptions=choices(periods,"Период отчёта","period");
    const basisOptions=choices(dateBases,"Тип даты отчёта","basis");
    const status=select(statuses,"Статус заказов");
    status.addEventListener("change",()=>{draft.status=status.value;});
    const filterError=node("p","pr-filter-error");filterError.hidden=true;filterError.setAttribute("role","alert");
    const apply=node("button","pr-apply","Применить");apply.type="submit";
    filterView.append(periodOptions,customDates,basisOptions,
      append(node("label","pr-filter-status"),node("span","","Статус"),status),filterError,apply);
    filterView.addEventListener("submit",event=>{
      event.preventDefault();
      if(draft.period==="custom"&&(!draft.from||!draft.to||draft.from>draft.to)){
        filterError.textContent=!draft.from||!draft.to?"Укажите начало и конец периода.":"Дата начала позже даты окончания.";
        filterError.hidden=false;
        (!draft.from?dateInputs.from:dateInputs.to).focus();return;
      }
      filters=draft;visible=PAGE_SIZE;chartKey=null;
      tabScroll.overview=tabScroll.orders=0;
      if(trail.length)trail.at(-1).scroll=0;
      back();
    });
    const views={overview,orders:list,order:orderView,review:reconcileView,net:netView,filters:filterView};
    detail.append(toolbar,tabs,warning,...Object.values(views));
    rootEl.append(menu,detail);

    function retryFinance(){return (onRetry??root?.__rdMoneyUi?.refreshFinance)?.();}
    function refreshCompany(force=false){
      if(active&&onLoadCompany)void Promise.resolve(onLoadCompany(force)).catch(()=>{});
    }
    function setStatus(text,retry=false,error=false){
      warning.hidden=!text;warningRetry.hidden=!retry;
      warningText.setAttribute("role",error?"alert":"status");
      if(warningText.textContent!==text)warningText.textContent=text;
    }
    function periodContext(today){
      const [first,last]=bounds(filters.period,today,filters.from,filters.to);
      const basisName=dateBases.find(([value])=>value===filters.basis)?.[1].toLowerCase();
      const caption=[filters.period==="all"?"Все даты":formatInterval(first,last),basisName];
      if(filters.status)caption.push(statuses.find(([key])=>key===filters.status)?.[1]);
      return caption.filter(Boolean).join(" · ");
    }
    function readReport(finance,today){
      const version=finance?.revision;
      const orders=version==null||!cached||cached.version!==version?getOrders():cached.orders;
      const payroll=getPayroll?.(),operations=getOperations?.()??empty,masterId=getRaulMasterId?.();
      const deps=[version,orders,payroll,operations,masterId,today,filters];
      if(cached&&deps.every((value,index)=>value===cached.deps[index]))return cached;
      const settings={...filters,today,payroll,operations,masterId};
      const cohort=filterRows(orders,{...settings,status:""});
      const rows=selectReportRows(cohort,{status:filters.status,search:""});
      const reviewed=rows.map(row=>({row,reasons:reconciliationReasons(row)})).filter(item=>item.reasons.length);
      cached={deps,version,orders,operations,settings,cohort,rows,reviewed,today,totals:financialSummary(rows)};
      return cached;
    }
    function companyFor(data){
      if(!getCompanyStatus||!data)return null;
      const status=getCompanyStatus();
      const ready=status?.ready;
      const deps=[data,status?.rows,status?.revision,ready,status?.stale,status?.error,status?.refreshError];
      if(cachedCompany&&deps.every((value,index)=>value===cachedCompany.deps[index]))return cachedCompany;
      const summary=ready?companySummary(data.cohort,{...data.settings,cashbookEntries:status.rows}):null;
      cachedCompany={deps,status,summary};
      return cachedCompany;
    }
    function updateHeader(){
      if(localBack){
        localBack.setAttribute("aria-label",backLabel());localTitle.textContent=title();
      }
      onViewChange?.();
    }
    function title(){
      if(view!=="order")return titleByView[view];
      const row=cached?.rows.find(item=>String(item.id)===orderId);
      return row&&reference(row)?"Заказ "+reference(row):"Заказ";
    }
    function backLabel(){
      const destination=trail.at(-1)?.view;
      return destination==="orders"?"Назад к заказам":destination==="review"?"Назад к сверке":
        destination==="overview"?"Назад к обзору":"Назад к отчётам";
    }
    function open(){
      if(active)return;
      active=true;view="overview";menu.hidden=true;detail.hidden=false;
      onOpenChange?.(true);
      render();updateHeader();scrollTo(0);
      headerBack()?.focus({preventScroll:true});
      refreshCompany();
    }
    function close(){
      if(!active)return;
      active=false;menu.hidden=false;detail.hidden=true;trail.length=0;view="overview";orderId=null;draft=null;
      onOpenChange?.(false);
      scrollTo(0);
      entry.focus({preventScroll:true});
    }
    function back(){
      const previous=trail.pop();
      if(!previous){if(onBack)onBack();else close();return;}
      view=previous.view;
      if(view!=="order")orderId=null;
      draft=null;
      render();updateHeader();scrollTo(previous.scroll);
      const focus=previous.trigger?.isConnected?previous.trigger:
        previous.id?findRow(previous.id,view):null;
      (focus??headerBack())?.focus({preventScroll:true});
    }
    function findRow(rowId,name){
      return [...views[name].querySelectorAll("[data-order-id]")].find(row=>row.dataset.orderId===rowId);
    }
    function enter(next,trigger,row=null){
      trail.push({view,scroll:scrollPosition(),trigger,id:trigger?.dataset.orderId});
      orderId=row?String(row.id):null;view=next;
      if(next==="filters"){
        draft={...filters};
        for(const counter of [periodOptions,basisOptions]){
          const key=counter===periodOptions?"period":"basis";
          for(const option of counter.querySelectorAll("input"))option.checked=option.value===draft[key];
        }
        status.value=draft.status;
        dateInputs.from.value=draft.from;dateInputs.to.value=draft.to;
        customDates.hidden=draft.period!=="custom";
        filterError.hidden=true;
      }
      render();updateHeader();scrollTo(0);
      headerBack()?.focus({preventScroll:true});
    }
    function switchTab(next){
      if(next===view)return;
      tabScroll[view]=scrollPosition();view=next;
      render();updateHeader();scrollTo(tabScroll[next]);
      tabButtons[next].focus({preventScroll:true});
    }
    function chartLabel(value){
      return value===0?"0 ₽":compactFormat.format(value);
    }
    function updateChart(data){
      if(chartData===data)return;
      chartData=data;
      plot.replaceChildren();chartScale.replaceChildren();ticks.replaceChildren();
      const trend=data?profitTrend(data.rows,data.settings):null;
      const points=trend?.points??[];
      const hasPoints=points.length>0;
      chartFrame.hidden=ticks.hidden=chartSelected.hidden=!hasPoints;
      chartEmpty.hidden=hasPoints;
      chartEmpty.textContent=data?"За выбранный период нет заказов с датой для графика.":"График появится после загрузки отчёта.";
      chartFoot.hidden=!trend?.undated;
      if(trend?.undated)chartFoot.textContent="Без даты для графика — "+orderCount(trend.undated)+". Суммы учтены в итогах.";
      if(!hasPoints)return;
      let high=0,low=0;
      for(const point of points){
        if(point.profit==null)continue;
        high=Math.max(high,point.profit);low=Math.min(low,point.profit);
      }
      const stepScale=Math.pow(10,Math.floor(Math.log10(Math.max(1,(high-low)/2))));
      const rawStep=(high-low)/2/stepScale;
      const step=(rawStep<=1?1:rawStep<=2?2:rawStep<=5?5:10)*stepScale;
      const min=Math.floor(low/step)*step,max=Math.max(min+step,Math.ceil(high/step)*step);
      const x=i=>points.length===1?50:5+90*i/(points.length-1);
      const y=value=>7+86*(max-value)/(max-min);
      const zero=y(0),shape=svgElement("svg",{class:"pr-axes",viewBox:"0 0 1000 100",preserveAspectRatio:"none","aria-hidden":"true"});
      const levels=[max,...(min<0&&max>0?[0]:[round((min+max)/2)]),min];
      for(const value of levels){
        shape.append(svgElement("line",{class:value===0?"pr-chart-zero":"pr-chart-grid",
          x1:0,x2:1000,y1:y(value),y2:y(value)}));
        const label=node("span","",chartLabel(value));label.style.top=y(value)+"%";chartScale.append(label);
      }
      const segments=[];
      let part=[];
      points.forEach((point,i)=>{
        if(point.profit==null){if(part.length)segments.push(part);part=[];return;}
        part.push([x(i)*10,y(point.profit)]);
      });
      if(part.length)segments.push(part);
      for(const portion of segments){
        if(portion.length<2)continue;
        const path=portion.map(([a,b],i)=>(i?"L":"M")+a+" "+b).join("");
        shape.append(svgElement("path",{class:"pr-chart-area",d:path+"L"+portion.at(-1)[0]+" "+zero+"H"+portion[0][0]+"Z"}),
          svgElement("path",{class:"pr-chart-line",fill:"none",d:path}));
      }
      const guide=svgElement("line",{class:"pr-chart-guide"});
      shape.append(guide);plot.append(shape);
      const chartButtons=[];
      function selectPoint(index){
        const point=points[index],caption=formatInterval(point.from,point.to,dateFormat);
        chartKey=point.from;
        chartSelected.textContent=caption+" · "+(point.profit==null?"На сверке":money(point.profit));
        for(const [i,btn] of chartButtons.entries()){
          btn.setAttribute("aria-pressed",String(i===index));
          btn.tabIndex=i===index?0:-1;
        }
        for(const child of ticks.children)child.classList.toggle("pr-tick-active",child.dataset.date===chartKey);
        const height=y(point.profit??0);
        for(const [key,value] of Object.entries({x1:x(index)*10,x2:x(index)*10,y1:height,y2:zero}))
          guide.setAttribute(key,value);
      }
      for(const [i,point] of points.entries()){
        const target=button("","pr-chart-point",()=>selectPoint(i));
        target.style.left=x(i)+"%";
        target.style.top=y(point.profit??0)+"%";
        if(points.length>1)target.style.width="min(44px, "+90/(points.length-1)+"%)";
        target.dataset.unknown=String(point.profit==null);
        target.setAttribute("aria-label",formatInterval(point.from,point.to,dateFormat)+", "+
          (point.profit==null?"прибыль на сверке":money(point.profit))+(point.unverified?", есть заказы на сверке":""));
        target.append(node("span"));
        target.addEventListener("keydown",event=>{
          if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
          event.preventDefault();
          const next=Math.max(0,Math.min(points.length-1,i+(event.key==="ArrowLeft"?-1:1)));
          selectPoint(next);chartButtons[next].focus();
        });
        chartButtons.push(target);plot.append(target);
        if(points.length<=4||i===0||i===points.length-1||i===Math.floor(points.length/2)){
          const caption=node("span","",formatDay(point.from));
          caption.style.left=x(i)+"%";caption.dataset.date=point.from;ticks.append(caption);
        }
      }
      const selected=points.findIndex(point=>point.from===chartKey);
      selectPoint(selected>=0?selected:points.length-1);
    }
    function renderOverview(data,company){
      if(overviewData!==data){
        overviewData=data;
        const total=data?.totals;
        const unknown=data?.reviewed.length&&data.rows.every(row=>orderProfit(row)==null);
        const revenueUnknown=total&&!total.paid&&data.rows.some(row=>row.reportPaymentUnverified);
        metricsValues.count.textContent=total?numberFormat.format(total.count):"—";
        paidCount.textContent=total?numberFormat.format(total.paid)+" оплачено":"Оплачено —";
        paintAmount(metricsValues.revenue,revenueUnknown?null:total?.revenue);
        paintAmount(metricsValues.salary,unknown&&!total.salary?null:total?.salary);
        paintAmount(metricsValues.profit,unknown?null:total?.profit);
        paintAmount(avg,total?.paid?total.average:null);
        reviewLink.hidden=!data?.reviewed.length;
        if(data?.reviewed.length)reviewLabel.textContent=orderCount(data.reviewed.length)+" на сверке";
        revenueHelp.hidden=!data;
      }
      if(netButton){
        paintAmount(netValue,company?.summary?.netProfit);
        netNote.textContent=company?.status?.stale?"Последний расчёт":
          company?.status?.error?"Касса недоступна":
          filters.status?"По всем заказам за период":"После общих расходов";
      }
      updateChart(data);
    }
    function sortedRows(data){
      if(!data)return empty;
      const [key,direction]=sortKey.split("-");
      return sortReportRows(selectReportRows(data.rows,{search:searchTerm}),key,direction,filters.basis);
    }
    function orderAction(row,reasons=[]){
      const id=String(row.id),title=row.name||"Без имени";
      const action=button("",reasons.length?"pr-review-row":"pr-order-row",event=>enter("order",event.currentTarget,row));
      action.dataset.orderId=id;
      const meta=[reference(row),formatDay(getDate(row,filters.basis))||"Без даты"].filter(Boolean).join(" · ");
      const value=orderProfit(row);
      const amount=node("strong");paintAmount(amount,value);
      const statusLine=reasons.length?reasons.join(" · "):row.reportRefundedAmount?"Возврат "+money(row.reportRefundedAmount):
        reconciliationReasons(row).length?"На сверке":!row.paid&&row.reportReceived<=0?"Не оплачено":"";
      const info=append(node("span","pr-row-main"),node("strong","",title),node("small","",meta));
      if(reasons.length)info.append(node("span","pr-review-reason",statusLine));
      const finance=append(node("span","pr-row-finance"),amount);
      if(statusLine&&!reasons.length)finance.append(node("small",statusLine==="На сверке"?"pr-row-warning":"",statusLine));
      action.append(info,finance,icon("next"));return append(node("li"),action);
    }
    function renderList(data){
      if(listData?.data===data&&listData.search===searchTerm&&listData.sort===sortKey&&listData.limit===visible)return;
      const rows=sortedRows(data);
      listData={data,search:searchTerm,sort:sortKey,limit:visible,rows};
      resultHeading.hidden=!data;
      resultCount.textContent=orderCount(rows.length);
      const focused=doc.activeElement?.closest?.(".pr-order-row")?.dataset.orderId;
      listRows.replaceChildren(...rows.slice(0,visible).map(row=>orderAction(row)));
      if(focused)findRow(focused,"orders")?.focus({preventScroll:true});
      listEmpty.hidden=Boolean(rows.length);
      listEmpty.textContent=data?"Заказов по выбранным фильтрам нет.":"Список появится после загрузки отчёта.";
      more.hidden=visible>=rows.length;
    }
    function exportCsv(){
      if(csv.disabled||!listData)return;
      const url=URL.createObjectURL(new Blob([csvFor(listData.rows)],{type:"text/csv;charset=utf-8"}));
      const link=node("a");link.href=url;link.download="rabota-profit-orders-"+moscowDay(new Date())+".csv";
      doc.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function renderOrder(data){
      const row=data?.rows.find(item=>String(item.id)===orderId);
      if(orderData?.data===data&&orderData?.row===row)return;
      orderData={data,row};
      if(!row){orderView.replaceChildren(node("p","pr-empty","Данные этого заказа пока недоступны."));return;}
      const stamp=getDate(row,"closed");
      const intro=append(node("section","pr-detail-card pr-order-intro"),node("h3","",row.name||"Без имени"),
        node("p","",[(stamp?"Закрыт "+formatDay(stamp):row.status),row.master].filter(Boolean).join(" · ")));
      const payLines=[];
      if(row.reportReceived>0){
        payLines.push(["Промывка",round(row.reportReceived-row.reportTravelReceived)]);
        if(row.reportTravelReceived)payLines.push(["Дорога",row.reportTravelReceived]);
      }else if(row.reportPrice!=null){
        payLines.push(["Стоимость промывки",row.reportPrice]);
        if(row.reportTravel)payLines.push(["Дорога",row.reportTravel]);
      }
      if(row.reportRefundedAmount){
        payLines.push(["Возврат",row.reportRefundedAmount]);
        if(row.reportTravelRefunded)payLines.push(["Возвращено за дорогу",row.reportTravelRefunded]);
      }
      const payment=moneyCard("Оплата клиента",row.reportPaymentUnverified?null:row.reportReceived,payLines);
      const confirmedAccrual=row.reportSalary!=null||row.reportTravelEarned>0;
      const accrualLines=[];
      if(row.reportSalary!=null)accrualLines.push(["За промывку",row.reportSalary]);
      if(row.reportTravelEarned)accrualLines.push(["Начислено за дорогу",row.reportTravelEarned]);
      const accrual=moneyCard("Начислено зарплаты",confirmedAccrual?row.reportAccruedSalary:null,accrualLines);
      const direct=moneyCard("Расходы по заказу",row.reportExpenses,
        (row.reportExpenseItems??[]).map(({label,amount})=>[label,amount]));
      const profit=orderProfit(row);
      const fullEquation=row.reportCalculated&&profit!=null&&cents(row.reportReceived)-
        cents(row.reportAccruedSalary)-cents(row.reportExpenses)===cents(profit);
      const formula=[];
      if(row.reportProfit!=null)formula.push(["Доля компании",row.reportProfit]);
      if(row.reportTravelUncovered)formula.push(["Дорога за счёт компании",-row.reportTravelUncovered]);
      if(row.reportExpenses)formula.push(["Связанные расходы",-row.reportExpenses]);
      const margin=moneyCard("Прибыль по заказу",profit,fullEquation?[]:formula,true);
      if(fullEquation)margin.append(node("p","pr-profit-formula",[row.reportReceived,row.reportAccruedSalary,
        ...(row.reportExpenses?[row.reportExpenses]:[])].map(money).join(" − ")));
      const reconciliation=reconciliationReasons(row);
      const notes=[];
      if(reconciliation.length)notes.push(append(node("section","pr-review-intro"),node("strong","","На сверке"),
        ...reconciliation.map(reason=>node("p","",reason))));
      const extra=node("details","pr-order-meta");
      extra.append(node("summary","","Сведения о заказе"));
      for(const [label,value] of [["Дата записи",[formatDay(getDate(row,"appointment")),row.time?.slice(0,5)].filter(Boolean).join(" · ")],
        ["Адрес",row.address],["Источник",root?.__rdClientWhatsApp?.sourceLabel?.(row.clientSource)||row.clientSource],
        ["Способ оплаты",{cash:"Наличные",card:"Карта"}[row.paymentMethod]],
        ["Стоимость с дорогой",row.reportTravel&&row.reportTotalPrice!=null?money(row.reportTotalPrice):""]]){
        if(value)extra.append(append(node("p"),node("strong","",label+" "),node("span","",value)));
      }
      orderView.replaceChildren(intro,...notes,payment,accrual,...(getOperations?[direct]:[]),margin,extra);
    }
    function renderReview(data){
      if(reviewData===data)return;
      reviewData=data;
      const reviewed=data?.reviewed??empty;
      const count=reviewed.length?orderCount(reviewed.length)+" на сверке":"Нет заказов на сверке";
      const head=append(node("div","pr-review-intro"),node("strong","",count),
        node("p","",data?periodContext(data.today):"Данные отчёта пока недоступны."),
        node("p","","В итогах показаны подтверждённые суммы."));
      reconcileView.replaceChildren(head,
        append(node("ul","pr-order-list"),...reviewed.slice(0,visible).map(({row,reasons})=>orderAction(row,reasons))));
      if(reviewed.length>visible)reconcileView.append(button("Показать ещё","pr-more-btn",()=>{
        visible+=PAGE_SIZE;reviewData=null;render();
      }));
    }
    function renderNet(data,company){
      if(netData?.data===data&&netData?.company===company)return;
      netData={data,company};
      const summary=company?.summary,status=company?.status;
      const heading=moneyCard("Чистая прибыль за период",summary?.netProfit,[],true);
      heading.append(node("p","",status?.stale?"Показан последний расчёт":data?periodContext(data.today):"Финансовые данные пока недоступны."));
      if(filters.status)heading.append(node("p","","По всем заказам за период, независимо от статуса."));
      if(data?.cohort.some(row=>row.reportPaymentUnverified||row.reportPayrollOnHold||row.reportReason))
        heading.append(node("p","","По подтверждённым данным. Часть заказов на сверке."));
      const parts=summary?[moneyCard("Как рассчитано",summary.netProfit,[
        ["Прибыль по заказам",summary.orderProfit],["Общие расходы",-summary.commonExpenses]
      ])]:[];
      if(status?.error||status?.refreshError){
        parts.push(append(node("div","pr-finance-status"),node("span","","Не удалось обновить данные кассы."),
          button("Повторить","secondary pr-retry",()=>refreshCompany(true))));
      }else if((!summary||status?.stale)&&data){
        parts.push(node("p","pr-empty","Загружаем общие расходы…"));
      }
      netView.replaceChildren(heading,...parts,node("p","pr-footnote",
        "В общих расходах — расходы CRM и кассы за даты периода. Связанные с заказами расходы уже учтены в прибыли по заказам."));
    }
    function render(){
      if(!active)return;
      const top=view==="overview"||view==="orders";
      detail.dataset.view=view;
      toolbar.hidden=tabs.hidden=!top;
      for(const [key,section] of Object.entries(views))section.hidden=key!==view;
      for(const [key,value] of Object.entries(tabButtons))value.setAttribute("aria-pressed",String(view===key));
      const today=moscowDay(new Date());
      if(top){
        periodName.textContent=filters.period==="month"||filters.period==="previous"?
          formatDay(bounds(filters.period,today,filters.from,filters.to)[0],monthFormat).replace(/^./u,letter=>letter.toLocaleUpperCase("ru-RU")):
          periods.find(([key])=>key===filters.period)?.[1];
        periodCaption.textContent=periodContext(today);
      }
      const finance=getFinanceStatus?.();
      const ready=finance?(finance.ready??!(finance.loading||finance.error)):true;
      const stale=Boolean(finance?.stale||finance?.refreshError);
      const unavailable=finance?.error?"Не удалось загрузить расчёты. "+finance.error:"Загружаем данные отчёта…";
      setStatus(view==="filters"?"":!ready?unavailable:stale?"Показан последний рассчитанный отчёт. Перед выгрузкой обновите данные.":"",
        !ready&&Boolean(finance?.error)||stale,Boolean(finance?.error||finance?.refreshError));
      const data=ready?readReport(finance,today):null;
      csv.disabled=!data||stale;
      if(view==="overview")renderOverview(data,companyFor(data));
      else if(view==="orders")renderList(data);
      else if(view==="order")renderOrder(data);
      else if(view==="review")renderReview(data);
      else if(view==="net")renderNet(data,companyFor(data));
    }
    function reset(){
      close();
      cached=cachedCompany=listData=orderData=reviewData=netData=null;
      overviewData=chartData=undefined;
      filters={...defaultFilters};draft=null;searchTerm="";sortKey=sorts[0][0];visible=PAGE_SIZE;chartKey=null;
      tabScroll.overview=tabScroll.orders=0;
      search.value="";sorter.value=sortKey;
      for(const element of [orderView,reconcileView,netView,listRows,plot,chartScale,ticks,chartSelected,
        ...Object.values(metricsValues),paidCount,avg,netValue])element.replaceChildren();
    }
    if(startOpen)open();
    return {render,close,back,backLabel,title,reset,refreshCompany,isOpen:()=>active};
  }
  const model={reportRow,summary,financialSummary,filterRows,selectReportRows,bounds,moscowDay,getDate,quoteCsv,csvFor,
    orderProfit,reconciliationReasons,profitTrend,companySummary,sortReportRows};
  if(root){
    root.__rdCreateProfitReport=mount;
    root.__rdProfitReportModel=model;
  }
  if(typeof module!=="undefined"&&module.exports)module.exports=model;
})(typeof window!=="undefined"?window:null);
