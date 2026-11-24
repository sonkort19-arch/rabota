/* CRM «Работа»: booking availability in the order editor.
   Suggestions use the current order cache. The database remains authoritative. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const grid=$("oaMonthGrid"), dayInput=$("orderDate"), timeInput=$("orderTime");
  const masterInput=$("master"), message=$("oaAvailabilityMessage");
  const toggle=$("oaToggle"), calendarBody=$("oaCalendarBody"), dayLoad=$("oaDayLoad");
  const weekStrip=$("oaWeekStrip");
  if(!grid||!dayInput||!timeInput||!masterInput||!message||!toggle||!calendarBody||!dayLoad)return;

  const ESTIMATED_GAP_MINUTES=200; // 3 hours of work + 20 minutes for travel.
  const suggestedTimes=["10:00","15:00","18:00"];
  let orders=[],editingId=null,visible=false,viewYear=null,viewMonth=null;
  let bookingsByDate=new Map(),renderedDate=null;

  const masterKey=value=>String(value||"").trim().toLocaleLowerCase("ru");
  const moscowDateFormatter=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"
  });
  const iso=(year,month,day)=>[String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
  function parseDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return null;
    const [year,month,day]=value.split("-").map(Number);
    const date=new Date(year,month-1,day,12);
    return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
  }
  function moscowToday(){
    const fields=Object.fromEntries(moscowDateFormatter.formatToParts(new Date()).map(part=>[part.type,part.value]));
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
  function setOrders(rows){
    if(rows===orders)return;
    orders=rows;
    bookingsByDate=new Map();
    for(const order of rows){
      if(order.status==="Отменён"||!order.date)continue;
      const key=masterKey(order.master);
      if(!key)continue;
      if(!bookingsByDate.has(order.date))bookingsByDate.set(order.date,new Map());
      const bookings=bookingsByDate.get(order.date);
      if(!bookings.has(key))bookings.set(key,[]);
      bookings.get(key).push(order);
    }
    for(const bookings of bookingsByDate.values()){
      for(const group of bookings.values())
        group.sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
    }
  }
  function bookingsFor(date,master){
    const key=masterKey(master);
    if(!key)return null;
    return bookingsByDate.get(date)?.get(key)??[];
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
    const bookings=bookingsFor(date,master),start=mins(time);
    if(!bookings||start===null)return "unknown";
    // Check ALL existing starts before warning about near-time bookings:
    // otherwise the earlier 10:00 booking can hide an exact 13:00 collision.
    let unknown=false,tight=false;
    for(const order of bookings){
      if(isOwn(order))continue;
      const booked=mins(order.time);
      if(booked===start)return "busy";
      if(booked===null)unknown=true;
      else if(Math.abs(start-booked)<ESTIMATED_GAP_MINUTES)tight=true;
    }
    return unknown?"unknown":tight?"tight":"available";
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
    renderMonth();
  }
  function selectDate(date){
    if(dayInput.value!==date){
      dayInput.value=date;
      timeInput.value=""; // A time from a different date must never carry over.
      setMonthFromDate(date); // Week selection can cross into another month.
    }
    render();
    setExpanded(false);
    if(document.activeElement && calendarBody.contains(document.activeElement))
      toggle.focus({preventScroll:true});
  }
  // Mirror the master's existing week colours instead of inventing a second workload model.
  // The date picker stays collapsible; this compact seven-day row is always visible.
  function renderWeek(){
    if(!weekStrip)return;
    const selected=parseDay(dayInput.value);
    if(!selected){weekStrip.replaceChildren();return;}
    const monday=new Date(selected.getFullYear(),selected.getMonth(),
      selected.getDate()-((selected.getDay()+6)%7),12);
    const names=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
    const fragment=document.createDocumentFragment();
    for(let i=0;i<7;i++){
      const day=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i,12);
      const date=iso(day.getFullYear(),day.getMonth()+1,day.getDate());
      const stats=availability(date,masterInput.value);
      const load=stats&&window.__rdCalendarLoad?.estimateDay(stats.all,date);
      const level=load?.level||"unknown";
      const button=el("button","oa-week-day oa-week-"+level+
        (date===dayInput.value?" is-selected":""));
      button.type="button";
      button.dataset.date=date;
      button.setAttribute("aria-pressed",String(date===dayInput.value));
      button.setAttribute("aria-label",dateText(date)+": "+
        (load?.label||"Выберите мастера для оценки загруженности"));
      button.append(el("span","oa-week-name",names[i]),
        el("strong","oa-week-number",day.getDate()));
      button.addEventListener("click",()=>selectDate(date));
      fragment.append(button);
    }
    weekStrip.replaceChildren(fragment);
  }
  function renderMonth(){
    const first=new Date(viewYear,viewMonth,1,12);
    const monthName=first.toLocaleDateString("ru-RU",{month:"long",year:"numeric"});
    $("oaMonthTitle").textContent=monthName.charAt(0).toUpperCase()+monthName.slice(1);
    $("oaSelectedDate").textContent=dateText(dayInput.value);
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
  // Compact occupancy note inside the *single* time-selection group.
  // Finish times remain estimated from scope and travel; do not imply certainty.
  function renderBusySummary(stats,master){
    const helper=window.__rdBookingTimeline;
    if(!helper||!stats||!stats.others.length)return null;
    const blocks=helper.forDay(stats.others,dayInput.value,master,null,
      window.__rdCalendarLoad?.travelMinutes);
    if(!blocks.length)return null;
    const summary=el("div","oa-busy-summary");
    summary.setAttribute("aria-label","Занятость мастера. Время окончания примерное.");
    summary.append(el("strong","oa-busy-prefix","Занято:"));
    for(const block of blocks){
      const entry=el("span","oa-busy-entry");
      const time=block.end===null?
        "с "+helper.format(block.start)+" · конец уточняется":
        "≈ "+helper.format(block.start)+"–"+helper.format(block.end);
      entry.append(el("span","oa-busy-person",block.name+" ·"),
        el("span","oa-busy-time",time));
      summary.append(entry);
    }
    return summary;
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
    const raulQuick=document.getElementById("orderOverlay")?.classList.contains("master-quick");
    if(stats.all.length&&!raulQuick){
      existing.append(el("div","oa-subtitle","Занято:"));
      for(const order of stats.all){
        const row=el("div","oa-booking-row");
        row.append(el("strong","",order.time||"Время не указано"));
        row.append(el("span","",order.name||"Клиент"));
        if(isOwn(order))row.append(el("small","","Этот заказ"));
        existing.append(row);
      }
    }
    slots.append(el("div","oa-subtitle",raulQuick?"Время":"Выберите время"));
    if(raulQuick){
      const summary=renderBusySummary(stats,master);
      if(summary)slots.append(summary);
    }
    let available=0;
    // The four compact suggestions are exclusive to Raul's quick form.
    // Each time still goes through the same busy/tight/available checks.
    const times=raulQuick?["10:00","12:30","15:00","18:00"]:suggestedTimes;
    for(const time of times){
      const state=timeState(time,date,master);
      const estimatedBusy=raulQuick?window.__rdBookingTimeline?.findAt(
        stats.others,time,date,master,null,window.__rdCalendarLoad?.travelMinutes):null;
      const displayState=estimatedBusy?"busy":state;
      const label=estimatedBusy?(raulQuick?"Занято":"≈ Занят"):
        displayState==="busy"?"Занято":displayState==="tight"?(raulQuick?"Рядом":"Рядом с заказом"):
        displayState==="unknown"?"Уточнить":"Свободно";
      const selectable=!estimatedBusy&&(state==="available"||state==="tight");
      const button=el("button","oa-slot oa-slot-"+displayState+(selectable&&timeInput.value===time?" is-selected":""));
      button.type="button";
      button.disabled=!selectable;
      button.setAttribute("aria-label",time+": "+(raulQuick&&displayState==="tight"?
        "Рядом с заказом, уточните время перед записью":
        raulQuick&&estimatedBusy?"Занято по расчёту, окончание примерное":label));
      button.setAttribute("aria-pressed",String(timeInput.value===time));
      button.dataset.baseLabel=label;
      button.append(el("strong","",time),el("small","",timeInput.value===time&&selectable?(state==="tight"?(raulQuick?"Выбрано":"Выбрано · плотно"):"Выбрано"):label));
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
    slots.append(el("p","oa-slot-note",raulQuick?
      "Окончание примерное (работа + дорога). Жёлтый — запись рядом, проверьте время.":
      "Точное совпадение времени запрещено. Плотная запись допускается после подтверждения; проверка повторится при сохранении."));
  }
  function renderSlots(){
    for(const button of $("oaSlotSuggestions").querySelectorAll(".oa-slot")){
      const selected=button.querySelector("strong")?.textContent===timeInput.value&&!button.disabled;
      button.classList.toggle("is-selected",selected);
      button.setAttribute("aria-pressed",String(selected));
      const caption=button.querySelector("small");
      if(caption)caption.textContent=selected?(button.classList.contains("oa-slot-tight")&&
        !document.getElementById("orderOverlay")?.classList.contains("master-quick")?
        "Выбрано · плотно":"Выбрано"):button.dataset.baseLabel||"";
    }
  }
  function render(){
    if(!visible)return;
    if(viewYear===null)setMonthFromDate(dayInput.value);
    renderedDate=dayInput.value;
    updateHeader();
    if(!calendarBody.hidden)renderMonth();
    renderWeek();
    renderDay();
  }
  toggle.addEventListener("click",()=>{
    if(calendarBody.hidden){
      setMonthFromDate(dayInput.value);
      setExpanded(true);
      renderMonth();
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
      setOrders(Array.isArray(rows)?rows:[]);
      editingId=id==null?null:String(id);
      visible=true;
      setMonthFromDate(dayInput.value);
      setExpanded(false);
      render();
    },
    refresh(rows){
      if(Array.isArray(rows))setOrders(rows);
      if(!visible)return;
      if(renderedDate!==dayInput.value)setMonthFromDate(dayInput.value);
      render();
    },
    close(){
      visible=false;
      editingId=null;
      setExpanded(false);
    },
    inspect(date,master){
      const stats=availability(date,master);
      return stats?{...stats,all:stats.all.slice()}:null;
    },
    checkTime(time,date,master){return timeState(time,date,master)}
  };
})();
