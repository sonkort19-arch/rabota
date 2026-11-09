/* CRM «Работа»: booking availability in the order editor.
   Suggestions use the current order cache. The database remains authoritative. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const grid=$("oaMonthGrid"), dayInput=$("orderDate"), timeInput=$("orderTime");
  const masterInput=$("master"), message=$("oaAvailabilityMessage");
  const toggle=$("oaToggle"), calendarBody=$("oaCalendarBody"), dayLoad=$("oaDayLoad");
  if(!grid||!dayInput||!timeInput||!masterInput||!message||!toggle||!calendarBody||!dayLoad)return;

  const ESTIMATED_GAP_MINUTES=200; // 3 hours of work + 20 minutes for travel.
  const suggestedTimes=["10:00","15:00","18:00"];
  let orders=[],editingId=null,visible=false,viewYear=null,viewMonth=null;

  const masterKey=value=>String(value||"").trim().toLocaleLowerCase("ru");
  const iso=(year,month,day)=>[String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
  function parseDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return null;
    const [year,month,day]=value.split("-").map(Number);
    const date=new Date(year,month-1,day,12);
    return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
  }
  function moscowToday(){
    const formatter=new Intl.DateTimeFormat("en-GB",{
      timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"
    });
    const fields=Object.fromEntries(formatter.formatToParts(new Date()).map(part=>[part.type,part.value]));
    return iso(fields.year,fields.month,fields.day);
  }
  const dateText=value=>{
    const date=parseDay(value);
    return date?date.toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"}):"Выберите дату";
  };
  const mins=value=>{
    const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value||""));
    return match?Number(match[1])*60+Number(match[2]):null;
  };
  const isOwn=order=>editingId!==null&&String(order.id)===String(editingId);
  function bookingsFor(date,master){
    const key=masterKey(master);
    if(!key)return null;
    return orders.filter(order=>
      order.date===date&&order.status!=="Отменён"&&masterKey(order.master)===key
    ).sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
  }
  function availability(date,master){
    const all=bookingsFor(date,master);
    if(!all)return null;
    const others=all.filter(order=>!isOwn(order));
    return {all,others,count:all.length,canBook:true};
  }
  function setExpanded(expanded){
    calendarBody.hidden=!expanded;
    toggle.setAttribute("aria-expanded",String(expanded));
    $("oaCalendar").classList.toggle("is-expanded",expanded);
    updateHeader();
  }
  function updateHeader(){
    const stats=availability(dayInput.value,masterInput.value);
    const count=stats?stats.count:null;
    const state=count===null?"unknown":count>0?"partial":"free";
    dayLoad.className="oa-load oa-load-"+state;
    dayLoad.textContent=count===null?"Выберите мастера":count+" "+(count===1?"заказ":count>=2&&count<=4?"заказа":"заказов");
    toggle.setAttribute("aria-label","Дата: "+dateText(dayInput.value)+". "+
      (stats?stats.count+" записей":"Мастер не выбран")+
      (calendarBody.hidden?". Открыть календарь":". Свернуть календарь"));
  }
  function timeState(time,date,master){
    const stats=availability(date,master);
    if(!stats)return "unknown";
    if(!stats.canBook)return "full";
    const start=mins(time);
    if(start===null)return "unknown";
    for(const order of stats.others){
      const booked=mins(order.time);
      if(booked===null)return "unknown";
      if(start===booked)return "busy";
      if(Math.abs(start-booked)<ESTIMATED_GAP_MINUTES)return "tight";
    }
    return "available";
  }
  function el(tag,cls,value){
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(value!==undefined)node.textContent=String(value);
    return node;
  }
  function setMonthFromDate(date){
    const actual=parseDay(date)||parseDay(moscowToday());
    viewYear=actual.getFullYear();viewMonth=actual.getMonth();
  }
  function changeMonth(delta){
    const d=new Date(viewYear,viewMonth+delta,1,12);
    viewYear=d.getFullYear();viewMonth=d.getMonth();
    render();
  }
  function selectDate(date){
    const stats=availability(date,masterInput.value);
    if(dayInput.value!==date){
      dayInput.value=date;
      timeInput.value=""; // A time from a different date must never carry over.
    }
    render();
    setExpanded(false);
    if(document.activeElement && calendarBody.contains(document.activeElement))
      toggle.focus({preventScroll:true});
  }
  function renderMonth(){
    const first=new Date(viewYear,viewMonth,1,12);
    const monthName=first.toLocaleDateString("ru-RU",{month:"long",year:"numeric"});
    $("oaMonthTitle").textContent=monthName.charAt(0).toUpperCase()+monthName.slice(1);
    $("oaSelectedDate").textContent=dateText(dayInput.value);
    updateHeader();
    const firstColumn=(first.getDay()+6)%7;
    const days=new Date(viewYear,viewMonth+1,0).getDate();
    const frag=document.createDocumentFragment();
    for(let i=0;i<firstColumn;i++)frag.append(el("span","oa-empty-day"));
    const chosen=dayInput.value;
    const today=moscowToday();
    for(let day=1;day<=days;day++){
      const date=iso(viewYear,viewMonth+1,day);
      const stats=availability(date,masterInput.value);
      const severity=stats?(stats.count>0?"partial":"free"):"unknown";
      const button=el("button","oa-day oa-"+severity+(date===chosen?" is-selected":"")+(date===today?" is-today":""));
      button.type="button";
      button.dataset.date=date;
      button.setAttribute("aria-pressed",String(date===chosen));
      button.setAttribute("aria-label",dateText(date)+(stats?": "+stats.count+" записей":" — выберите мастера"));
      button.append(el("span","oa-day-number",day));
      button.append(el("span","oa-day-count",stats?String(stats.count):"—"));
      button.addEventListener("click",()=>selectDate(date));
      frag.append(button);
    }
    grid.replaceChildren(frag);
  }
  function renderDay(){
    const date=dayInput.value;
    const master=masterInput.value;
    const stats=availability(date,master);
    const existing=$("oaExistingBookings"),slots=$("oaSlotSuggestions");
    existing.replaceChildren();slots.replaceChildren();
    message.className="oa-message";
    if(!parseDay(date)){
      message.textContent="Выберите день в календаре.";
      return;
    }
    if(!masterKey(master)){
      message.textContent="Укажите мастера, чтобы увидеть его занятость.";
      return;
    }
    if(!stats)return;
    if(stats.count>0){
      message.classList.add("oa-message-partial");
      message.textContent="На день уже назначено "+stats.count+" заказ(ов). Дополнительная запись допускается, но проверьте время работы и дорогу.";
    }else{
      message.classList.add("oa-message-free");
      message.textContent="Записей пока нет. Выберите удобное время.";
    }
    if(stats.all.length){
      existing.append(el("div","oa-subtitle","Занято:"));
      for(const order of stats.all){
        const row=el("div","oa-booking-row");
        row.append(el("strong","",order.time||"Время не указано"));
        row.append(el("span","",order.name||"Клиент"));
        if(isOwn(order))row.append(el("small","","Этот заказ"));
        existing.append(row);
      }
    }
    slots.append(el("div","oa-subtitle","Выберите время"));
    let available=0;
    for(const time of suggestedTimes){
      const state=timeState(time,date,master);
      const label=state==="busy"?"Занято":state==="tight"?"Плотная запись":
        state==="unknown"?"Уточнить":"Свободно";
      const selectable=state==="available"||state==="tight";
      const button=el("button","oa-slot oa-slot-"+state+(selectable&&timeInput.value===time?" is-selected":""));
      button.type="button";
      button.disabled=!selectable;
      button.setAttribute("aria-label",time+": "+label);
      button.setAttribute("aria-pressed",String(timeInput.value===time));
      button.dataset.baseLabel=label;
      button.append(el("strong","",time),el("small","",timeInput.value===time&&selectable?"Выбрано":label));
      if(!button.disabled){
        available++;
        button.addEventListener("click",()=>{
          timeInput.value=time;
          timeInput.dispatchEvent(new Event("change",{bubbles:true}));
          renderSlots();
        });
      }
      slots.append(button);
    }
    if(!available)
      slots.append(el("p","oa-no-slots","На стандартных часах есть совпадения или неизвестная занятость. Уточните время вручную."));
    slots.append(el("p","oa-slot-note",
      "Точное совпадение времени запрещено. Плотная запись допускается после подтверждения; проверка повторится при сохранении."));
  }
  function renderSlots(){
    for(const button of $("oaSlotSuggestions").querySelectorAll(".oa-slot")){
      const selected=button.querySelector("strong")?.textContent===timeInput.value&&!button.disabled;
      button.classList.toggle("is-selected",selected);
      button.setAttribute("aria-pressed",String(selected));
      const caption=button.querySelector("small");
      if(caption)caption.textContent=selected?"Выбрано":button.dataset.baseLabel||"";
    }
  }
  function render(){
    if(!visible)return;
    if(viewYear===null)setMonthFromDate(dayInput.value);
    renderMonth();
    renderDay();
  }
  toggle.addEventListener("click",()=>{
    if(calendarBody.hidden){
      setMonthFromDate(dayInput.value);
      render();
      setExpanded(true);
    }else setExpanded(false);
  });
  $("oaPrevMonth").addEventListener("click",()=>changeMonth(-1));
  $("oaNextMonth").addEventListener("click",()=>changeMonth(1));
  $("oaToday").addEventListener("click",()=>{
    const today=moscowToday();
    setMonthFromDate(today);
    selectDate(today);
  });
  masterInput.addEventListener("input",render);
  masterInput.addEventListener("change",render);
  timeInput.addEventListener("input",renderSlots);
  timeInput.addEventListener("change",renderSlots);
  window.__rdOrderAvailability={
    open(rows,id){
      orders=Array.isArray(rows)?rows:[];
      editingId=id==null?null:String(id);
      visible=true;
      setMonthFromDate(dayInput.value);
      setExpanded(false);
      render();
    },
    refresh(rows){
      if(Array.isArray(rows))orders=rows;
      if(!visible)return;
      setMonthFromDate(dayInput.value);
      render();
    },
    close(){
      visible=false;
      editingId=null;
      setExpanded(false);
    },
    inspect(date,master){return availability(date,master)},
    checkTime(time,date,master){return timeState(time,date,master)}
  };
})();
