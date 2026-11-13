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
      }).formatToParts(new Date());
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
    function masterScheduleSort(a,b,today) {
      // Сегодня и будущие заказы первыми; старые записи на проверку — внизу.
      const orderRank=o=>!o.date?3:o.date<today?2:0;
      return orderRank(a)-orderRank(b)||
        String(a.date||"").localeCompare(String(b.date||""))||
        String(a.time||"").localeCompare(String(b.time||""));
    }
    function masterOrderCount(n) {
      const ending=n%10,group=n%100;
      return n+" "+(group>=11&&group<=14?"заказов":ending===1?"заказ":ending>=2&&ending<=4?"заказа":"заказов");
    }
    let masterOverviewSignature="";
    let masterReviewOpen=false;
    function renderMasterOverview(rows) {
      const root=doc.getElementById("masterTodaySummary");
      if(getCurrentRole()!=="master"||getCurrentTab()!=="calendar"){
        root.hidden=true;masterOverviewSignature="";return;
      }
      const now=masterClock(),today=rows.filter(o=>o.date===now.date);
      const schedule=rows.filter(o=>(o.status==="Записан"||o.status==="Новый")&&
        (o.date>now.date||(o.date===now.date&&masterTimeMinutes(o.time)>=now.minutes)))
        .sort((a,b)=>masterScheduleSort(a,b,now.date));
      const next=schedule[0];
      const toReview=rows.filter(o=>(o.status==="Записан"||o.status==="Новый")&&
        (o.date<now.date||(o.date===now.date&&masterTimeMinutes(o.time)>=0&&
          masterTimeMinutes(o.time)<now.minutes)));
      const signature=JSON.stringify([now.date,today.map(o=>[o.id,o.status]),
        next?[next.id,next.date,next.time,next.name]:null,
        toReview.map(o=>[o.id,o.status]),masterReviewOpen]);
      // Опрос финансов не должен сбрасывать фокус кнопки «Ближайший выезд».
      if(!root.hidden&&signature===masterOverviewSignature)return;
      masterOverviewSignature=signature;
      root.hidden=false;root.replaceChildren();
      const top=make("div","master-today-top");
      top.append(make("strong","master-today-title","Сегодня · "+formatDate(now.date)));
      top.append(make("span","master-today-count",masterOrderCount(today.length)));
      root.append(top);
      if(next){
        const jump=make("button","master-next-jump");
        jump.type="button";
        jump.append(make("span","master-next-caption","Ближайший выезд"),
          make("strong","master-next-value",(next.date===now.date?"Сегодня":formatDate(next.date))+
            " · "+(next.time||"Без времени")+" · "+(next.name||"Клиент")));
        jump.addEventListener("click",()=>{
          const row=[...doc.querySelectorAll("#orders .master-schedule-card")]
            .find(element=>element.dataset.orderId===String(next.id));
          if(!row)return;
          const toggle=row.querySelector(".master-schedule-toggle");
          if(toggle)toggle.click();
          row.scrollIntoView({behavior:"smooth",block:"center"});
        });
        root.append(jump);
      }else{
        root.append(make("p","master-no-next","Ближайших новых выездов пока нет."));
      }
      if(toReview.length){
        const note=make("button","master-review-note master-review-jump","Проверить статус · "+masterOrderCount(toReview.length));
        note.type="button";
        note.setAttribute("aria-label","Проверить незавершённые заказы, время записи которых прошло");
        note.setAttribute("aria-controls","masterReviewList");
        note.setAttribute("aria-expanded",String(masterReviewOpen));
        note.addEventListener("click",()=>{masterReviewOpen=!masterReviewOpen;renderMasterOverview(rows);});
        root.append(note);
        if(masterReviewOpen){
          const list=make("div","master-review-list");
          list.id="masterReviewList";
          [...toReview].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||
            String(b.time||"").localeCompare(String(a.time||""))).forEach(order=>{
            const item=make("button","master-review-item",
              (order.date?formatDate(order.date):"Без даты")+" · "+
              (order.time||"Без времени")+" · "+(order.name||"Без имени"));
            item.type="button";
            item.addEventListener("click",()=>{
              const row=[...doc.querySelectorAll("#orders .master-schedule-card")]
                .find(element=>element.dataset.orderId===String(order.id));
              if(!row)return;
              const toggle=row.querySelector(".master-schedule-toggle");
              if(toggle)toggle.click();
              row.scrollIntoView({behavior:"smooth",block:"center"});
            });
            list.append(item);
          });
          root.append(list);
        }
      }
    }

function makeMasterScheduleRow(order,isNext=false) {
      const id=String(order.id);
      const article=make("article","master-schedule-card"+(isNext?" is-next":""));
      article.dataset.orderId=id;
      article.dataset.status=order.status||"Новый";
      article.dataset.search=[order.name,order.phone,order.address,order.date,
        order.time,order.status,order.radiatorType].join(" ").toLocaleLowerCase("ru");
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
      const state=STATUSES.includes(order.status)?order.status:"Новый";
      const classes={"Новый":"s-new","Записан":"s-booked","В работе":"s-progress","Выполнен":"s-done","Отменён":"s-cancelled"};
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
    function renderMasterSchedule(rows) {
      const grouped=new Map(),today=masterClock().date;
      rows.forEach(order=>{
        const date=order.date||"";
        if(!grouped.has(date)) grouped.set(date,[]);
        grouped.get(date).push(order);
      });
      const next=rows.filter(o=>(o.status==="Записан"||o.status==="Новый")&&
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
      if(!rows.length)ordersNode.append(make("div","empty",getCurrentTab()==="history"?"Выполненных заказов нет":"Рабочих заказов нет"));
    }

    function resetReviewOpen(){masterReviewOpen=false;}
    return {masterDayLabel,masterClock,masterTimeMinutes,masterWorkingOrders,
      masterSettlementOrders,masterScheduleSort,masterOrderCount,
      renderMasterOverview,makeMasterScheduleRow,renderMasterSchedule,resetReviewOpen};
  }
  if(root)root.__rdCreateMasterUI=createMasterUI;
  if(typeof module!=="undefined"&&module.exports)module.exports={createMasterUI};
})(typeof window!=="undefined"?window:null);
