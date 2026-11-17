/* CRM «Работа», stage 6: master (Raul) schedule UI.
 * Extracted with the same rendering, order filtering and event semantics.
 * Modal, payment actions, Supabase RPC and master CSS remain in index.html.
 */
"use strict";
(function(root){
  function createMasterUI(deps){
    if(!deps||typeof deps.make!=="function"||
      typeof deps.getOrders!=="function"||
      typeof deps.getCurrentRole!=="function"||
      typeof deps.getCurrentTab!=="function"||
      typeof deps.openMasterOrderDialog!=="function"||
      !deps.doc||!deps.ordersNode)throw new TypeError("Нет зависимостей интерфейса мастера");
    const DateImpl=deps.DateImpl||Date; // deterministic tests; production uses native Date
    const {make,parseDate,formatDate,getOrders,collectionForOrder,
      getCurrentRole,getCurrentTab,doc,ordersNode,
      openMasterOrderDialog,STATUSES}=deps;

function masterDayLabel(day) {
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Без даты";
      const label=parseDate(day).toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"});
      return label.charAt(0).toUpperCase()+label.slice(1);
    }

    // Сравниваем даты и время записей по часовому поясу Владикавказа (Москва).
    function masterClock() {
      const parts=new Intl.DateTimeFormat("en-GB",{
        timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",hourCycle:"h23"
      }).formatToParts(new DateImpl());
      const part=type=>parts.find(item=>item.type===type)?.value||"00";
      return {date:part("year")+"-"+part("month")+"-"+part("day"),
        minutes:Number(part("hour"))*60+Number(part("minute"))};
    }
    function masterTimeMinutes(value) {
      const match=/^([01]\d|2[0-3]):([0-5]\d)/.exec(String(value||""));
      return match?Number(match[1])*60+Number(match[2]):-1;
    }
    function masterWorkingOrders() {
      return getOrders().filter(o=>o.status!=="Выполнен"&&o.status!=="Отменён");
    }
    function masterSettlementOrders() {
      return getOrders().filter(o=>{
        if(o.status!=="Выполнен")return false;
        const collection=collectionForOrder(o.id);
        return !o.paid||Boolean(collection&&!collection.confirmed_at);
      }).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||
        String(b.time||"").localeCompare(String(a.time||"")));
    }
    function masterScheduleSort(a,b,today,minutes=-1) {
      // Ближайшие предстоящие выезды первыми; прошедшие и закрытые — ниже.
      const orderRank=o=>{
        if(!o.date)return 4;
        if(o.status==="Выполнен"||o.status==="Отменён")return 3;
        if(o.date<today)return 2;
        const start=masterTimeMinutes(o.time);
        if(o.date===today&&minutes>=0&&start>=0&&start<minutes)return 1;
        return 0;
      };
      const rankA=orderRank(a),rankB=orderRank(b);
      const dateDiff=String(a.date||"").localeCompare(String(b.date||""));
      const timeValue=o=>{
        const time=masterTimeMinutes(o.time);
        return time<0?1440:time;
      };
      const direction=rankA===0?1:-1;
      return rankA-rankB||direction*dateDiff||
        direction*(timeValue(a)-timeValue(b));
    }
    function masterOrderCount(n) {
      const ending=n%10,group=n%100;
      return n+" "+(group>=11&&group<=14?"заказов":ending===1?"заказ":ending>=2&&ending<=4?"заказа":"заказов");
    }
    // Completed orders are visible by default on each selected day.
    // A manual collapse survives refreshes, but changing the day opens its history.
    let completedDayDate=null,completedOpenDate=null;
    let masterOverviewSignature="";
    function masterOrdersToReview(rows=masterWorkingOrders()){
      const now=masterClock();
      return rows.filter(o=>o.status==="Записан"&&
        (o.date<now.date||(o.date===now.date&&masterTimeMinutes(o.time)>=0&&
          masterTimeMinutes(o.time)<now.minutes)));
    }
    function renderMasterOverview(rows) {
      const root=doc.getElementById("masterTodaySummary");
      if(getCurrentRole()!=="master"||getCurrentTab()!=="calendar"){
        root.hidden=true;masterOverviewSignature="";return;
      }
      const now=masterClock();
      const schedule=rows.filter(o=>o.status==="Записан"&&
        (o.date>now.date||(o.date===now.date&&masterTimeMinutes(o.time)>=now.minutes)))
        .sort((a,b)=>masterScheduleSort(a,b,now.date));
      const next=schedule[0];
      if(!next){
        root.hidden=true;root.replaceChildren();masterOverviewSignature="";
        return;
      }
      const signature=JSON.stringify([next.id,next.date,next.time,next.name]);
      if(!root.hidden&&signature===masterOverviewSignature)return;
      masterOverviewSignature=signature;
      root.hidden=false;root.replaceChildren();
      const when=(next.date===now.date?"Сегодня":formatDate(next.date))+
        " · "+(next.time||"Без времени")+" · "+(next.name||"Клиент");
      const jump=make("button","master-next-jump master-next-compact");
      jump.type="button";
      jump.setAttribute("aria-label","Ближайший выезд: "+when+". Открыть заказ");
      jump.append(make("span","master-next-caption","Ближайший"),
        make("strong","master-next-value",when));
      jump.addEventListener("click",()=>openMasterOrderDialog(next));
      root.append(jump);
    }

function makeMasterScheduleRow(order,isNext=false) {
      const id=String(order.id);
      const article=make("article","master-schedule-card"+(isNext?" is-next":""));
      article.dataset.orderId=id;
      article.dataset.status=order.status||"Записан";
      article.dataset.search=[order.name,order.phone,order.address,order.date,
        order.time,order.status,order.radiatorType,order.referenceCode,order.id].join(" ").toLocaleLowerCase("ru");
      const toggle=make("button","master-schedule-toggle");
      toggle.type="button";

      toggle.setAttribute("aria-label","Открыть заказ "+(order.name||"Без имени")+", "+(order.time||"время не указано"));



      // Use the owner's compact card geometry, while retaining master's own action handlers.
      const name=String(order.name||"Без имени");
      const main=make("span","master-schedule-main");
      const avatar=make("span","master-schedule-avatar",Array.from(name)[0]?.toLocaleUpperCase("ru-RU")||"К");
      avatar.setAttribute("aria-hidden","true");
      const identity=make("span","master-schedule-identity");
      identity.append(make("span","master-schedule-name",name),
        make("span","master-schedule-address",order.address||"Адрес не указан"));
      main.append(avatar,identity);
      const time=make("span","master-schedule-time",order.time||"—:—");
      const chevron=make("span","master-schedule-chevron","›");
      chevron.setAttribute("aria-hidden","true");

      const work=[];
      if(order.radiators!==""&&order.radiators!=null)work.push("Радиаторы: "+order.radiators);
      if(order.floorLoops!==""&&order.floorLoops!=null&&Number(order.floorLoops)>0)
        work.push("Тёплый пол: "+order.floorLoops+" конт.");
      const workNode=make("span","master-schedule-work",work.join(" · "));
      const state=STATUSES.includes(order.status)?order.status:"Записан";
      const classes={"Записан":"s-booked","В работе":"s-progress","Выполнен":"s-done","Отменён":"s-cancelled"};
      const meta=make("span","master-schedule-meta");
      meta.append(make("span","status-badge "+classes[state],state));
      const priceText=order.price==null||order.price===""?
        "Стоимость не указана":Number(order.price).toLocaleString("ru-RU")+" ₽";
      const price=make("span","master-schedule-price",priceText);
      toggle.append(main,time,chevron,workNode,meta,price);
      if(state==="Выполнен"){
        const collection=collectionForOrder(order.id);
        const note=!order.paid?"Оплата ещё не отмечена":
          collection&&!collection.confirmed_at?
            (collection.submitted_at?"Передача ожидает подтверждения":"Нужно завершить расчёт"):"";
        if(note)toggle.append(make("span","master-money-note",note));
      }
      toggle.addEventListener("click",()=>openMasterOrderDialog(order));
      article.append(toggle);
      return article;
    }
    function renderMasterSchedule(rows,{compactEmpty=false}={}) {
      const grouped=new Map(),today=masterClock().date;
      rows.forEach(order=>{
        const date=order.date||"";
        if(!grouped.has(date)) grouped.set(date,[]);
        grouped.get(date).push(order);
      });
      const next=rows.filter(o=>o.status==="Записан"&&
        (o.date>today||(o.date===today&&masterTimeMinutes(o.time)>=masterClock().minutes)))
        .sort((a,b)=>masterScheduleSort(a,b,today))[0];
      grouped.forEach((items,date)=>{
        if(getCurrentTab()!=="calendar"){
          const heading=make("div","master-day-heading");
          const label=getCurrentTab()==="history"?masterDayLabel(date):
            date===today?"Сегодня · "+formatDate(date):masterDayLabel(date);
          heading.append(make("h3","",label));
          heading.append(make("span","muted",masterOrderCount(items.length)));
          ordersNode.append(heading);
        }
        items.forEach(order=>ordersNode.append(makeMasterScheduleRow(order,String(order.id)===String(next?.id))));
      });
      if(!rows.length&&!compactEmpty)ordersNode.append(make("div","empty",
        getCurrentTab()==="history"?"Выполненных заказов нет":"Рабочих заказов нет"));
    }

    function renderMasterCompletedDay(rows,date){
      if(getCurrentRole()!=="master"||getCurrentTab()!=="calendar")return;
      if(completedDayDate!==date){
        completedDayDate=date;completedOpenDate=date;
      }
      const items=(Array.isArray(rows)?rows:[]).filter(order=>
        order?.date===date&&order.status==="Выполнен")
        .sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
      if(!items.length)return;
      const section=make("section","master-completed-day");
      section.setAttribute("aria-label","Выполненные заказы за "+formatDate(date));
      const button=make("button","master-completed-toggle");
      button.type="button";
      button.setAttribute("aria-expanded",String(completedOpenDate===date));
      button.setAttribute("aria-controls","masterCompletedOrders");
      const title=make("span","master-completed-caption","Выполненные");
      const count=make("span","master-completed-count",String(items.length));
      const arrow=make("span","master-completed-chevron","⌄");
      arrow.setAttribute("aria-hidden","true");
      button.append(title,count,arrow);
      const list=make("div","master-completed-list");
      list.id="masterCompletedOrders";
      list.hidden=completedOpenDate!==date;
      const fill=()=>{
        if(!list.children.length)
          items.forEach(order=>list.append(makeMasterScheduleRow(order)));
      };
      if(!list.hidden)fill();
      button.addEventListener("click",()=>{
        const expand=list.hidden;
        if(expand)fill();
        list.hidden=!expand;
        completedOpenDate=expand?date:null;
        button.setAttribute("aria-expanded",String(expand));
        section.classList.toggle("is-open",expand);
      });
      if(!list.hidden)section.classList.add("is-open");
      section.append(button,list);
      ordersNode.append(section);
    }

    function resetReviewOpen(){completedOpenDate=null;completedDayDate=null;}
    return {masterDayLabel,masterClock,masterTimeMinutes,masterWorkingOrders,
      masterSettlementOrders,masterScheduleSort,masterOrderCount,
      renderMasterOverview,masterOrdersToReview,makeMasterScheduleRow,renderMasterSchedule,renderMasterCompletedDay,resetReviewOpen};
  }
  if(root)root.__rdCreateMasterUI=createMasterUI;
  if(typeof module!=="undefined"&&module.exports)module.exports={createMasterUI};
})(typeof window!=="undefined"?window:null);
