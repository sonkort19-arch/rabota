/* Fast phone-booking assistant. Reads current CRM orders, never writes business data. */
(function () {
  "use strict";
  const TIMES=["10:00","15:00","18:00"];
  const MOSCOW="Europe/Moscow";

  function moscowClock(now) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
      timeZone:MOSCOW,year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",hourCycle:"h23"
    }).formatToParts(now).map(part=>[part.type,part.value]));
    return {
      today:parts.year+"-"+parts.month+"-"+parts.day,
      minutes:(Number(parts.hour)%24)*60+Number(parts.minute)
    };
  }
  function addDay(iso,days) {
    const [year,month,day]=iso.split("-").map(Number);
    return new Date(Date.UTC(year,month-1,day+days,12)).toISOString().slice(0,10);
  }
  function timeMinutes(value) {
    const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    return match?Number(match[1])*60+Number(match[2]):NaN;
  }
  // A suggested slot is an estimate, never a confirmed reservation.
  // Keep the real chronology within each class, but show non-tight slots first.
  function candidateSlots({masters,now=new Date(),checkTime,horizon=14,limit=14,sort="free-first"}) {
    if(typeof checkTime!=="function")return [];
    const clock=moscowClock(now),free=[],tight=[];
    const names=[...new Map((masters||[]).map(name=>String(name||"").trim()).filter(Boolean)
      .map(name=>[name.toLocaleLowerCase("ru"),name])).values()];
    for(let day=0;day<horizon;day++){
      const date=addDay(clock.today,day);
      for(const time of TIMES){
        if(day===0&&timeMinutes(time)<=clock.minutes+20)continue;
        for(const master of names){
          const state=checkTime(time,date,master);
          if(state!=="available"&&state!=="tight")continue;
          (state==="available"?free:tight).push({date,time,master,tight:state==="tight"});
        }
      }
    }
    const chronological=(a,b)=>a.date.localeCompare(b.date)||
      timeMinutes(a.time)-timeMinutes(b.time)||a.master.localeCompare(b.master,"ru");
    return (sort==="earliest"?free.concat(tight).sort(chronological):free.concat(tight))
      .slice(0,Math.max(0,limit));
  }
  // An explicitly selected day also displays blocked and uncertain hours.
  function inspectDay({date,masters,now=new Date(),checkTime}){
    if(typeof checkTime!=="function"||!/^\d{4}-\d{2}-\d{2}$/.test(date||""))return [];
    const clock=moscowClock(now);
    return TIMES.flatMap(time=>(masters||[]).map(master=>{
      const state=date<clock.today||(date===clock.today&&timeMinutes(time)<=clock.minutes+20)
        ?"past":checkTime(time,date,master);
      return {date,time,master,state,
        tight:state==="tight",selectable:state==="available"||state==="tight"};
    }));
  }
  const core={candidateSlots,inspectDay,moscowClock,addDay,TIMES};
  if(typeof module!=="undefined"&&module.exports)module.exports=core;
  if(typeof document==="undefined")return;

  const make=(tag,cls,text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=text;
    return el;
  };
  const host=make("div","qs-backdrop");
  host.id="rdQuickSlots";
  host.hidden=true;
  const dialog=make("section","qs-dialog");
  dialog.setAttribute("role","dialog");
  dialog.setAttribute("aria-modal","true");
  dialog.setAttribute("aria-labelledby","qsTitle");
  dialog.tabIndex=-1;
  const heading=make("div","qs-heading");
  const label=make("div","qs-heading-copy");
  const title=make("h2","","Подбор времени");
  title.id="qsTitle";
  label.append(title,make("p","","Подберите время клиенту прямо во время звонка"));
  const closeButton=make("button","qs-close","×");
  closeButton.type="button";
  closeButton.setAttribute("aria-label","Закрыть подбор времени");
  heading.append(label,closeButton);
  const actions=make("div","qs-actions");
  const selectLabel=make("label","qs-filter-label","Мастер");
  const select=make("select","qs-select");
  select.id="qsMaster";
  select.setAttribute("aria-label","Выбрать мастера для поиска свободных окон");
  selectLabel.append(select);
  const refresh=make("button","qs-refresh","Обновить");
  refresh.type="button";
  actions.append(selectLabel,refresh);
  const dates=make("div","qs-date-controls");
  const modeControls=make("div","qs-mode-controls");
  const nearest=make("button","qs-date-chip is-active","Ближайшие свободные");
  const earliest=make("button","qs-date-chip","Самое раннее");
  for(const button of [nearest,earliest])button.type="button";
  modeControls.append(nearest,earliest);
  const dayControls=make("div","qs-day-controls");
  const today=make("button","qs-date-chip","Сегодня");
  const tomorrow=make("button","qs-date-chip","Завтра");
  const custom=make("button","qs-date-chip qs-custom-day","Выбрать дату");
  for(const button of [today,tomorrow,custom])button.type="button";
  dayControls.append(today,tomorrow,custom);
  const dateLabel=make("label","qs-date-label","Дата");
  const dateInput=make("input","qs-date-input");
  dateInput.type="date";dateInput.id="qsDate";dateLabel.hidden=true;
  dateInput.setAttribute("aria-label","Выбрать конкретную дату");
  dateLabel.append(dateInput);
  dates.append(modeControls,dayControls,dateLabel);
  const status=make("p","qs-status");
  status.setAttribute("role","status");
  status.setAttribute("aria-live","polite");
  const list=make("div","qs-list");
  const foot=make("p","qs-footnote",
    "Оценка: 3 часа работы + 20 минут дороги. Реальная длительность и маршрут не известны. Перед записью перепроверяйте.");
  dialog.append(heading,actions,dates,status,list,foot);
  host.append(dialog);
  document.body.append(host);

  let visible=false,busy=false,previousFocus=null,previousOverflow="",latest=null,choice="",runId=0;
  let mode="free",selectedDay="",customDateOpen=false;
  function updateDateControls(){
    const clock=moscowClock(new Date());
    dateInput.min=clock.today;
    dateLabel.hidden=!customDateOpen;
    nearest.classList.toggle("is-active",mode==="free");
    earliest.classList.toggle("is-active",mode==="earliest");
    today.classList.toggle("is-active",mode==="day"&&selectedDay===clock.today);
    tomorrow.classList.toggle("is-active",mode==="day"&&selectedDay===addDay(clock.today,1));
    custom.classList.toggle("is-active",customDateOpen||
      mode==="day"&&selectedDay!==clock.today&&selectedDay!==addDay(clock.today,1));
  }
  function selectMode(next){
    mode=next;selectedDay="";customDateOpen=false;updateDateControls();paint();
  }
  function selectDay(date){
    mode="day";selectedDay=date;customDateOpen=false;updateDateControls();paint();
  }
  nearest.addEventListener("click",()=>selectMode("free"));
  earliest.addEventListener("click",()=>selectMode("earliest"));
  today.addEventListener("click",()=>selectDay(moscowClock(new Date()).today));
  tomorrow.addEventListener("click",()=>selectDay(addDay(moscowClock(new Date()).today,1)));
  custom.addEventListener("click",()=>{
    customDateOpen=!customDateOpen;
    if(customDateOpen){
      dateInput.value=selectedDay||moscowClock(new Date()).today;
      dateLabel.hidden=false;dateInput.focus();
    }
    updateDateControls();
  });
  dateInput.addEventListener("change",()=>{
    if(!dateInput.value)return;
    mode="day";selectedDay=dateInput.value;customDateOpen=true;updateDateControls();paint();
  });
  const formatDay=date=>{
    const d=new Date(date+"T12:00:00Z");
    return new Intl.DateTimeFormat("ru-RU",{
      timeZone:"UTC",weekday:"short",day:"numeric",month:"long"
    }).format(d);
  };
  function namesFrom(data) {
    const values=Array.isArray(data?.masters)?data.masters:[];
    return [...new Map(values.map(s=>String(s||"").trim()).filter(Boolean)
      .map(s=>[s.toLocaleLowerCase("ru"),s])).values()];
  }
  function showMasters(data) {
    const names=namesFrom(data);
    const previous=choice;
    select.replaceChildren();
    const all=make("option","","Все мастера");all.value="*";select.append(all);
    names.forEach(name=>{
      const option=make("option","",name);
      option.value=name;
      select.append(option);
    });
    if(previous==="*"||names.some(n=>n===previous))choice=previous;
    else choice=names.find(n=>n.toLocaleLowerCase("ru")==="рауль")||names[0]||"*";
    select.value=choice;
  }
  function slotRow(slot){
    const state=slot.state||(slot.tight?"tight":"available");
    const text={
      available:"Свободно · записать",
      tight:"Плотно · проверить",
      busy:"Занято",
      unknown:"Уточнить",
      past:"Время прошло"
    };
    const row=make("button","qs-slot qs-slot-"+state);
    row.type="button";
    row.disabled=!["available","tight"].includes(state);
    row.setAttribute("aria-label",formatDay(slot.date)+" "+slot.time+", "+slot.master+
      ". "+text[state]);
    row.append(make("strong","",slot.time),
      make("span","qs-slot-meta",slot.master+" · "+formatDay(slot.date)),
      make("span","qs-action",text[state]));
    if(!row.disabled)row.addEventListener("click",()=>chooseSlot(slot));
    return row;
  }
  function paint(message=""){
    if(!visible||!latest)return;
    const all=namesFrom(latest);
    const names=choice==="*"?all:all.filter(name=>name===choice);
    const api=window.__rdOrderAvailability;
    list.replaceChildren();
    list.scrollTop=0;
    updateDateControls();
    if(!names.length){
      status.textContent="Нет доступных мастеров. Проверьте сотрудников и заказы.";
      return;
    }
    if(mode==="day"&&selectedDay){
      const slots=inspectDay({
        date:selectedDay,masters:names,now:new Date(),
        checkTime:(time,date,master)=>api?.checkTime(time,date,master)
      });
      status.textContent=message||"Доступность на "+formatDay(selectedDay)+" · предварительно";
      if(!slots.length){
        list.append(make("p","qs-empty","Для выбранной даты вариантов нет."));
        return;
      }
      for(const slot of slots)list.append(slotRow(slot));
      return;
    }
    const slots=candidateSlots({
      masters:names,now:new Date(),limit:1000,
      sort:mode==="earliest"?"earliest":"free-first",
      checkTime:(time,date,master)=>api?.checkTime(time,date,master)
    });
    if(mode==="earliest"){
      status.textContent=message||"Самое раннее время, включая плотные записи · 14 дней";
      if(!slots.length){
        list.append(make("p","qs-empty","Типовых вариантов в ближайшие 14 дней не найдено."));
        return;
      }
      list.append(make("p","qs-early-note",
        "Оранжевое время требует проверки дороги и длительности заказа."));
      for(const slot of slots.slice(0,7))list.append(slotRow(slot));
      if(slots.length>7)list.append(make("p","qs-more-note","Первые 7 вариантов по времени."));
      return;
    }
    const free=slots.filter(slot=>!slot.tight);
    const tight=slots.filter(slot=>slot.tight);
    status.textContent=message||"Сначала варианты без близких записей · ближайшие 14 дней";
    if(!slots.length){
      list.append(make("p","qs-empty","В ближайшие 14 дней нет стандартных вариантов. Выберите дату или уточните другое время в календаре."));
      return;
    }
    if(free.length){
      list.append(make("h3","qs-group-title","Свободно по типовой оценке · "+free.length));
      for(const slot of free.slice(0,7))list.append(slotRow(slot));
      if(free.length>7)
        list.append(make("p","qs-more-note","Показаны первые 7 вариантов. Для другого дня выберите дату выше."));
    }else{
      list.append(make("p","qs-empty","Без плотных соседних записей вариантов нет. Ниже можно проверить плотные окна."));
    }
    if(tight.length){
      const details=make("details","qs-tight-group");
      const summary=make("summary","","Плотные записи · "+tight.length+" (требуют проверки)");
      details.append(summary);
      const contents=make("div","qs-tight-rows");
      for(const slot of tight.slice(0,6))contents.append(slotRow(slot));
      if(tight.length>6)contents.append(make("p","qs-more-note","Другие варианты доступны через выбор даты."));
      details.append(contents);
      list.append(details);
    }
  }
  function setBusy(value) {
    busy=value;
    refresh.disabled=value;
    select.disabled=value;
    dateInput.disabled=value;
    for(const button of [nearest,earliest,today,tomorrow,custom])button.disabled=value;
    for(const btn of list.querySelectorAll("button"))btn.disabled=value;
  }
  async function readFresh(overrideChoice=false) {
    const token=++runId;
    setBusy(true);
    status.textContent="Обновляем заказы из CRM…";
    list.replaceChildren();
    latest=null;
    try {
      const data=await window.__rdQuickSlotsRead?.();
      if(!visible||token!==runId)return null;
      if(!data||!Array.isArray(data.masters))throw new Error("Не удалось получить доступные мастера.");
      latest=data;
      if(overrideChoice)choice="";
      showMasters(data);
      paint();
      return data;
    }catch(err){
      if(visible&&token===runId)status.textContent="Не удалось проверить актуальное расписание: "+(err?.message||"ошибка сети")+". Попробуйте обновить.";
      return null;
    }finally {
      if(visible&&token===runId)setBusy(false);
    }
  }
  async function chooseSlot(slot) {
    if(busy||!visible)return;
    const expected=slot.tight?"tight":"available";
    const data=await readFresh();
    if(!data||!visible)return;
    if(!namesFrom(data).includes(slot.master)){
      paint("Мастер больше недоступен. Выберите другой вариант.");
      return;
    }
    const state=window.__rdOrderAvailability?.checkTime(slot.time,slot.date,slot.master);
    const clock=moscowClock(new Date());
    if(slot.date<clock.today||(slot.date===clock.today&&timeMinutes(slot.time)<=clock.minutes+20)
      ||state!==expected){
      paint("Расписание изменилось. Время перепроверено — выберите актуальный вариант.");
      return;
    }
    close();
    const success=window.__rdQuickSlotFill?.(slot);
    if(!success)window.alert("Не удалось открыть запись. Обновите страницу CRM.");
  }
  // The dashboard is a read-only suggestion, never a reservation.
  // Re-fetch before pre-filling the existing unsaved order form.
  async function book(slot){
    if(!slot||visible||busy||!window.__rdQuickSlotsRead)return false;
    const data=await window.__rdQuickSlotsRead();
    const members=namesFrom(data);
    if(!members.includes(slot.master)||
      window.__rdOrderAvailability?.checkTime(slot.time,slot.date,slot.master)!==(slot.tight?"tight":"available")){
      open();
      return false;
    }
    const selected=candidateSlots({
      masters:[slot.master],now:new Date(),limit:1000,
      checkTime:(time,date,master)=>window.__rdOrderAvailability?.checkTime(time,date,master)
    });
    if(!selected.some(x=>x.date===slot.date&&x.time===slot.time&&x.master===slot.master)){
      open();
      return false;
    }
    return Boolean(window.__rdQuickSlotFill?.(slot));
  }
  function open() {
    if(visible||!window.__rdQuickSlotsRead||!window.__rdQuickSlotFill)return;
    if(!document.getElementById("appScreen")||document.getElementById("appScreen").hidden)return;
    visible=true;
    mode="free";selectedDay="";customDateOpen=false;dateInput.value="";
    updateDateControls();
    previousFocus=document.activeElement;
    previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    host.hidden=false;
    dialog.focus({preventScroll:true});
    readFresh(true);
  }
  function close() {
    if(!visible)return;
    visible=false;runId++;busy=false;
    host.hidden=true;list.replaceChildren();latest=null;
    document.body.style.overflow=previousOverflow;
    if(previousFocus?.isConnected)previousFocus.focus?.({preventScroll:true});
  }
  closeButton.addEventListener("click",close);
  host.addEventListener("click",event=>{if(event.target===host)close()});
  document.addEventListener("keydown",event=>{
    if(!visible)return;
    if(event.key==="Escape"){event.preventDefault();close()}
    if(event.key==="Tab") {
      const focusables=[closeButton,select,refresh,nearest,earliest,today,tomorrow,custom,
        ...(!dateLabel.hidden?[dateInput]:[]),...list.querySelectorAll("button")]
        .filter(node=>!node.disabled);
      if(!focusables.length)return;
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  });
  select.addEventListener("change",()=>{choice=select.value;paint()});
  refresh.addEventListener("click",()=>readFresh());
  window.__rdQuickSlots={open,close,book,core};
})();
