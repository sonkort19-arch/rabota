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
  function candidateSlots({masters,now=new Date(),checkTime,horizon=14,limit=14}) {
    if(typeof checkTime!=="function")return [];
    const clock=moscowClock(now),result=[];
    const names=[...new Map((masters||[]).map(name=>String(name||"").trim()).filter(Boolean)
      .map(name=>[name.toLocaleLowerCase("ru"),name])).values()];
    for(let day=0;day<horizon;day++) {
      const date=addDay(clock.today,day);
      for(const time of TIMES) {
        // A caller needs time to finish the phone conversation and arrange travel.
        if(day===0&&timeMinutes(time)<=clock.minutes+20)continue;
        for(const master of names) {
          if(checkTime(time,date,master)!=="available")continue;
          result.push({date,time,master});
          if(result.length>=limit)return result;
        }
      }
    }
    return result;
  }
  const core={candidateSlots,moscowClock,addDay,TIMES};
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
  const title=make("h2","","Свободные окна");
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
  const status=make("p","qs-status");
  status.setAttribute("role","status");
  status.setAttribute("aria-live","polite");
  const list=make("div","qs-list");
  const foot=make("p","qs-footnote",
    "Типовые начала: 10:00, 15:00, 18:00. Работа около 3 часов + 20 минут дорога. Максимум 2 заказа на мастера в день. Время предварительное, повторно проверяется перед записью.");
  dialog.append(heading,actions,status,list,foot);
  host.append(dialog);
  document.body.append(host);

  let visible=false,busy=false,previousFocus=null,previousOverflow="",latest=null,choice="",runId=0;
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
  function paint(message="") {
    if(!visible||!latest)return;
    const all=namesFrom(latest);
    const names=choice==="*"?all:all.filter(name=>name===choice);
    const api=window.__rdOrderAvailability;
    const slots=candidateSlots({
      masters:names,now:new Date(),
      checkTime:(time,date,master)=>api?.checkTime(time,date,master)
    });
    list.replaceChildren();
    if(!names.length) {
      status.textContent="Нет известных мастеров. Проверьте сотрудников и заказы.";
      return;
    }
    status.textContent=message||"Ближайшие доступные варианты по обновлённому расписанию";
    if(!slots.length) {
      list.append(make("p","qs-empty","Свободных типовых окон в ближайшие 14 дней не найдено. Выберите другого мастера или уточните нестандартное время в календаре."));
      return;
    }
    let current="";
    for(const slot of slots) {
      if(current!==slot.date) {
        current=slot.date;
        list.append(make("h3","qs-day",formatDay(current)));
      }
      const row=make("button","qs-slot");
      row.type="button";
      row.setAttribute("aria-label","Записать: "+formatDay(slot.date)+" в "+slot.time+", мастер "+slot.master);
      const time=make("strong","",slot.time);
      const details=make("span","",slot.master);
      const action=make("span","qs-action","Записать");
      row.append(time,details,action);
      row.addEventListener("click",()=>chooseSlot(slot));
      list.append(row);
    }
  }
  function setBusy(value) {
    busy=value;
    refresh.disabled=value;
    select.disabled=value;
    for(const btn of list.querySelectorAll("button"))btn.disabled=value;
  }
  async function readFresh(overrideChoice=false) {
    const token=++runId;
    setBusy(true);
    status.textContent="Обновляем заказы из CRM…";
    list.replaceChildren();
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
    const data=await readFresh();
    if(!data||!visible)return;
    const candidates=candidateSlots({
      masters:namesFrom(data),now:new Date(),limit:1000,
      checkTime:(time,date,master)=>window.__rdOrderAvailability?.checkTime(time,date,master)
    });
    if(!candidates.some(s=>s.date===slot.date&&s.time===slot.time&&s.master===slot.master)){
      paint("Это время уже занято или стало недоступно. Выберите другой вариант.");
      return;
    }
    close();
    const success=window.__rdQuickSlotFill?.(slot);
    if(!success)window.alert("Не удалось открыть запись. Обновите страницу CRM.");
  }
  function open() {
    if(visible||!window.__rdQuickSlotsRead||!window.__rdQuickSlotFill)return;
    if(!document.getElementById("appScreen")||document.getElementById("appScreen").hidden)return;
    visible=true;
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
      const focusables=[closeButton,select,refresh,...list.querySelectorAll("button")]
        .filter(node=>!node.disabled);
      if(!focusables.length)return;
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  });
  select.addEventListener("change",()=>{choice=select.value;paint()});
  refresh.addEventListener("click",()=>readFresh());
  window.__rdQuickSlots={open,close,core};
})();
