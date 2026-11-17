/* CRM «Работа»: календарь и проверка выбранных свободных окон.
 * Stage 4: isolate week rendering and date navigation without changing booking rules.
 * Database checks / availability remain in the existing modules and Supabase.
 */
"use strict";
(function(root){
  function localDate(date){
    return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
  }
  function parseDate(date){
    const parts=date.split("-").map(Number);
    return new Date(parts[0],parts[1]-1,parts[2],12);
  }
  function addDays(day,offset){
    const date=parseDate(day);date.setDate(date.getDate()+offset);return localDate(date);
  }
  function formatDate(value){
    if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return "Дата не указана";
    return parseDate(value).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
  }
  function weekDates(selectedDate){
    const base=parseDate(selectedDate);
    const monday=addDays(selectedDate,-((base.getDay()+6)%7));
    const sunday=addDays(monday,6);
    return {monday,sunday,days:Array.from({length:7},(_,i)=>addDays(monday,i))};
  }
  function canPrefillSlot({role,date,time,master},checkTime){
    if(!["owner","manager"].includes(role)||
       !/^\d{4}-\d{2}-\d{2}$/.test(date)||
       !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||
       !String(master||"").trim())return false;
    return ["available","tight"].includes(checkTime?.(time,date,master));
  }
  function createCalendarModule(deps){
    if(!deps||typeof deps.make!=="function"||typeof deps.getOrders!=="function"||
       typeof deps.getSelectedDate!=="function"||typeof deps.setSelectedDate!=="function"||
       typeof deps.getCurrentRole!=="function"||typeof deps.setCurrentTab!=="function"||
       typeof deps.getCurrentTab!=="function"||typeof deps.render!=="function"){
      throw new TypeError("Неверные зависимости календаря");
    }
    const {calendarDate,weekDays,ordersWeekDays,ordersDayDateLabel}=deps.elements||{};
    if(!calendarDate||!weekDays||!ordersWeekDays||!ordersDayDateLabel)
      throw new TypeError("Элементы календаря не найдены");
    const {make,getOrders,getSelectedDate,setSelectedDate,getCurrentRole,
      getCurrentTab,setCurrentTab,render}=deps;
    // The highlighted appointment date, today's Moscow date and visible days
    // are independent. Native scrolling must never change the appointment date.
    const EXTEND_DAYS=28,MAX_STRIP_DAYS=140;
    let stripStart=null,stripEnd=null,stripReady=false,stripTarget=null;
    let stripTargetAction=false,stripWidth=0,stripUnit=0;
    let stripViewportDate=null,stripViewportFraction=0,extending=false;
    let stripOrdersRef=null,stripRevision=null,stripOrdersByDate=new Map();
    let stripDayData=new Map(),stripTiles=new Map(),stripRenderedSelection=null;
    const activeMaster=()=>getCurrentRole()==="master"&&getCurrentTab()==="calendar";
    function updateSource(orders){
      const revision=deps.getOrdersRevision?.()??null;
      if(stripOrdersRef===orders&&stripRevision===revision)return false;
      stripOrdersRef=orders;stripRevision=revision;
      stripDayData.clear();stripOrdersByDate=new Map();
      for(const order of orders){
        if(!order?.date)continue;
        if(!stripOrdersByDate.has(order.date))stripOrdersByDate.set(order.date,[]);
        stripOrdersByDate.get(order.date).push(order);
      }
      return true;
    }
    function dayData(date){
      if(stripDayData.has(date))return stripDayData.get(date);
      const orders=stripOrdersByDate.get(date)||[];
      const hasOrders=orders.some(order=>order.status!=="Отменён");
      const load=typeof deps.estimateDayLoad==="function"
        ?deps.estimateDayLoad(orders,date):null;
      const info={hasOrders,load};
      stripDayData.set(date,info);
      return info;
    }
    function paintMasterTile(button,date,selectedDate){
      const {hasOrders,load}=dayData(date);
      const isSelected=date===selectedDate;
      const cls="day"+(isSelected?" active":"")+
        (hasOrders?" has-orders":"")+(load?" workload-"+load.level:"");
      if(button.className!==cls)button.className=cls;
      const label=load?parseDate(date).toLocaleDateString("ru-RU")+". "+load.label:
        parseDate(date).toLocaleDateString("ru-RU");
      if(button.getAttribute?.("aria-label")!==label)button.setAttribute("aria-label",label);
      if(load)button.setAttribute("title",label);
      else button.removeAttribute?.("title");
      button.setAttribute("aria-pressed",String(isSelected));
    }
    function createMasterTile(date,selectedDate){
      const day=parseDate(date),button=make("button","day");
      button.type="button";button.dataset.date=date;
      button.append(make("span","weekday",day.toLocaleDateString("ru-RU",{weekday:"short"})),
        make("strong","",day.getDate()));
      button.addEventListener("click",()=>selectDay(date,true));
      paintMasterTile(button,date,selectedDate);
      stripTiles.set(date,button);
      return button;
    }
    function tileStep(){
      const first=weekDays.firstElementChild,second=weekDays.children?.[1];
      if(!first)return 0;
      const distance=second?.offsetLeft-first.offsetLeft;
      return distance>0?distance:(first.offsetWidth?first.offsetWidth+3:0);
    }
    function pixelForDate(date){
      const first=weekDays.firstElementChild,tile=stripTiles.get(date);
      return first&&tile&&Number.isFinite(first.offsetLeft)&&Number.isFinite(tile.offsetLeft)
        ?tile.offsetLeft-first.offsetLeft:null;
    }
    function rememberViewport(){
      const step=tileStep();
      if(!stripReady||!step||!stripStart)return;
      const dayOffset=Math.max(0,(Number(weekDays.scrollLeft)||0)/step);
      const whole=Math.floor(dayOffset);
      stripViewportDate=addDays(stripStart,whole);
      stripViewportFraction=dayOffset-whole;
      // Size changes are reconciled by ResizeObserver, not by scroll events.
    }
    function requestStripDate(date){
      if(getCurrentRole()!=="master")return;
      stripTarget=date;stripTargetAction=true;
    }
    function alignStrip(){
      if(getCurrentRole()!=="master"||!weekDays.clientWidth||
         (stripReady&&!stripTarget))return;
      const date=stripTarget||weekDates(getSelectedDate()).monday;
      const left=pixelForDate(date);
      if(left===null)return;
      const animate=stripReady&&stripTargetAction&&typeof weekDays.scrollTo==="function"&&
        !root?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if(animate)weekDays.scrollTo({left,behavior:"smooth"});
      else weekDays.scrollLeft=left;
      stripTarget=null;stripTargetAction=false;stripReady=true;
      stripWidth=weekDays.clientWidth;stripUnit=tileStep();
      rememberViewport();
    }
    function observeStripResize(){
      if(getCurrentRole()!=="master"||!weekDays.clientWidth)return;
      if(stripTarget||!stripReady){alignStrip();return;}
      const step=tileStep(),width=weekDays.clientWidth;
      if(stripWidth&&Math.abs(stripWidth-width)>1&&step&&stripUnit){
        // Keep the same leftmost day when rotating the iPhone.
        const anchor=pixelForDate(stripViewportDate);
        if(anchor!==null)weekDays.scrollLeft=anchor+stripViewportFraction*step;
      }
      stripWidth=width;stripUnit=step;
    }
    function resetStrip(date,selectedDate){
      const monday=weekDates(date).monday;
      stripStart=addDays(monday,-EXTEND_DAYS);
      stripEnd=addDays(monday,70);
      stripTiles.clear();weekDays.replaceChildren();
      for(let day=stripStart;day<=stripEnd;day=addDays(day,1))
        weekDays.append(createMasterTile(day,selectedDate));
      stripReady=false;stripWidth=0;stripUnit=0;
      stripTarget=monday;stripTargetAction=false;
      stripRenderedSelection=selectedDate;
    }
    function renderMasterStrip(selectedDate,orders){
      const dataChanged=updateSource(orders);
      if(!stripStart||selectedDate<stripStart||selectedDate>stripEnd)
        resetStrip(selectedDate,selectedDate);
      else if(dataChanged){
        // Repaint only: a background order refresh never destroys the scroll DOM.
        for(const [date,tile] of stripTiles)paintMasterTile(tile,date,selectedDate);
      }else if(selectedDate!==stripRenderedSelection){
        for(const date of [stripRenderedSelection,selectedDate]){
          const tile=stripTiles.get(date);
          if(tile)paintMasterTile(tile,date,selectedDate);
        }
      }
      stripRenderedSelection=selectedDate;
      if(stripTarget||!stripReady)alignStrip();
    }
    function extendStrip(){
      if(extending||!activeMaster()||!stripReady||!weekDays.clientWidth)return;
      const step=tileStep();
      if(!step)return;
      const edge=step*11;
      extending=true;
      try{
        const date=getSelectedDate();
        if(weekDays.scrollLeft<edge){
          const original=weekDays.firstElementChild,oldLeft=original.offsetLeft;
          const start=stripStart,added=[];
          for(let i=EXTEND_DAYS;i>=1;i--)
            added.push(createMasterTile(addDays(start,-i),date));
          weekDays.prepend(...added);stripStart=addDays(start,-EXTEND_DAYS);
          weekDays.scrollLeft+=original.offsetLeft-oldLeft;
          if(stripTiles.size>MAX_STRIP_DAYS){
            for(let i=0;i<EXTEND_DAYS;i++){
              const last=weekDays.lastElementChild;
              if(!last)break;
              stripTiles.delete(last.dataset.date);last.remove();
            }
            stripEnd=addDays(stripEnd,-EXTEND_DAYS);
          }
        }else if(weekDays.scrollLeft+weekDays.clientWidth>weekDays.scrollWidth-edge){
          const end=stripEnd,added=[];
          for(let i=1;i<=EXTEND_DAYS;i++)
            added.push(createMasterTile(addDays(end,i),date));
          weekDays.append(...added);stripEnd=addDays(end,EXTEND_DAYS);
          if(stripTiles.size>MAX_STRIP_DAYS){
            const anchor=weekDays.children[EXTEND_DAYS],oldLeft=anchor.offsetLeft;
            for(let i=0;i<EXTEND_DAYS;i++){
              const first=weekDays.firstElementChild;
              stripTiles.delete(first.dataset.date);first.remove();
            }
            stripStart=addDays(stripStart,EXTEND_DAYS);
            weekDays.scrollLeft+=anchor.offsetLeft-oldLeft;
          }
        }
        rememberViewport();
      }finally{extending=false;}
    }
    function selectDay(date,preserveMasterScroll){
      if(!preserveMasterScroll||getCurrentRole()!=="master"){
        setSelectedDate(date);setCurrentTab("calendar");render();return;
      }
      const scrollY=deps.verticalScrollPosition();
      setSelectedDate(date);setCurrentTab("calendar");render();
      deps.restoreVerticalScroll(scrollY);
      deps.requestAnimationFrame(()=>{
        if(getCurrentRole()==="master"&&getCurrentTab()==="calendar"&&getSelectedDate()===date)
          deps.restoreVerticalScroll(scrollY);
      });
    }
    function renderCalendar(){
      const selectedDate=getSelectedDate();
      calendarDate.value=selectedDate;
      // The master calendar keeps the real date input tappable under a compact
      // text label. The "Today" shortcut appears only when another day is selected.
      const compactLabel=deps.getElement?.("masterCalendarDateText");
      if(compactLabel){
        const date=parseDate(selectedDate);
        compactLabel.textContent=date.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})+
          " "+date.getFullYear();
      }
      const {monday,sunday,days}=weekDates(selectedDate);
      ordersDayDateLabel.textContent=parseDate(monday).getDate()+"–"+
        parseDate(sunday).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
      const orders=getOrders();
      const isMaster=getCurrentRole()==="master";
      if(isMaster)renderMasterStrip(selectedDate,orders);
      else{
        stripStart=null;stripEnd=null;stripReady=false;stripTarget=null;
        stripRenderedSelection=null;stripTiles.clear();stripOrdersRef=null;
        stripDayData.clear();stripOrdersByDate.clear();
        weekDays.replaceChildren();
      }
      ordersWeekDays.replaceChildren();
      for(const date of days){
        const day=parseDate(date);
        const hasOrders=orders.some(o=>o.date===date&&o.status!=="Отменён");
        if(!isMaster){
          const btn=make("button","day"+(date===selectedDate?" active":"")+
            (hasOrders?" has-orders":""));
          btn.type="button";
          btn.setAttribute("aria-label",day.toLocaleDateString("ru-RU"));
          btn.setAttribute("aria-pressed",String(date===selectedDate));
          btn.append(make("span","weekday",day.toLocaleDateString("ru-RU",{weekday:"short"})));
          btn.append(make("strong","",day.getDate()));
          btn.addEventListener("click",()=>selectDay(date,true));
          weekDays.append(btn);
        }
        const chip=make("button","rd-orders-weekday"+(date===selectedDate?" is-selected":"")+
          (hasOrders?" has-orders":""));
        chip.type="button";
        chip.setAttribute("aria-label",day.toLocaleDateString("ru-RU"));
        chip.setAttribute("aria-pressed",String(date===selectedDate));
        chip.append(make("span","",day.toLocaleDateString("ru-RU",{weekday:"short"})));
        chip.append(make("strong","",day.getDate()));
        chip.addEventListener("click",()=>selectDay(date,false));
        ordersWeekDays.append(chip);
      }
    }
    function bindNavigation(){
      if(!deps.getElement||!deps.masterClock)throw new TypeError("Нет навигации календаря");
      const onClick=(id,fn)=>{
        const node=deps.getElement(id);
        if(!node)throw new TypeError("Кнопка календаря не найдена: "+id);
        node.addEventListener("click",fn);
      };
      const shift=days=>{
        const date=addDays(getSelectedDate(),days);
        requestStripDate(weekDates(date).monday);
        setSelectedDate(date);setCurrentTab("calendar");render();
      };
      const today=()=>{
        const date=getCurrentRole()==="master"?deps.masterClock().date:localDate(new Date());
        requestStripDate(weekDates(date).monday);
        setSelectedDate(date);setCurrentTab("calendar");render();
      };
      onClick("prevWeek",()=>shift(-7));
      onClick("nextWeek",()=>shift(7));
      onClick("goToday",today);
      calendarDate.addEventListener("change",()=>{
        if(calendarDate.value){requestStripDate(weekDates(calendarDate.value).monday);setSelectedDate(calendarDate.value);render();}
      });
      onClick("rdOrdersPrevWeek",()=>shift(-7));
      onClick("rdOrdersNextWeek",()=>shift(7));
      onClick("rdOrdersToday",today);
      // iOS supplies scrolling and inertia; no custom touch handlers or week jumps.
      weekDays.addEventListener("scroll",()=>{
        if(extending)return;
        rememberViewport();
        extendStrip();
      },{passive:true});
      const Resize=deps.ResizeObserver||root?.ResizeObserver;
      if(Resize){
        const observer=new Resize(()=>observeStripResize());
        observer.observe(weekDays);
      }else if(typeof deps.requestAnimationFrame==="function")
        deps.requestAnimationFrame(observeStripResize);

    }
    return {renderCalendar,bindNavigation};
  }
  if(root){
    root.__rdCalendarUtils={localDate,parseDate,addDays,formatDate,weekDates,canPrefillSlot};
    root.__rdCreateCalendarModule=createCalendarModule;
  }
  if(typeof module!=="undefined"&&module.exports)
    module.exports={localDate,parseDate,addDays,formatDate,weekDates,canPrefillSlot,createCalendarModule};
})(typeof window!=="undefined"?window:null);
