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
    // Keep a wide native-scroll window, extending it when the finger approaches an edge.
    // Horizontal scrolling never changes the selected order/date until a tile is tapped.
    let stripStart=null,stripEnd=null,stripReady=false,stripTarget=null;
    const EXTEND_DAYS=28;
    const stripStep=()=>{
      const first=weekDays.firstElementChild;
      return first?.offsetWidth?first.offsetWidth+3:0;
    };
    function pixelForDate(date){
      const first=weekDays.firstElementChild;
      const tile=Array.from(weekDays.children||[]).find(node=>node.dataset?.date===date);
      return first&&tile&&Number.isFinite(tile.offsetLeft)&&Number.isFinite(first.offsetLeft)
        ?tile.offsetLeft-first.offsetLeft:null;
    }
    function requestStripDate(date){
      if(getCurrentRole()==="master")stripTarget=date;
    }
    function createMasterTile(date,selectedDate,orders){
      const day=parseDate(date);
      const hasOrders=orders.some(o=>o.date===date&&o.status!=="Отменён");
      const load=typeof deps.estimateDayLoad==="function"
        ?deps.estimateDayLoad(orders,date):null;
      const button=make("button","day"+(date===selectedDate?" active":"")+
        (hasOrders?" has-orders":"")+(load?" workload-"+load.level:""));
      button.type="button";
      button.dataset.date=date;
      const accessible=load?day.toLocaleDateString("ru-RU")+". "+load.label:
        day.toLocaleDateString("ru-RU");
      button.setAttribute("aria-label",accessible);
      if(load)button.setAttribute("title",accessible);
      button.setAttribute("aria-pressed",String(date===selectedDate));
      button.append(make("span","weekday",day.toLocaleDateString("ru-RU",{weekday:"short"})));
      button.append(make("strong","",day.getDate()));
      button.addEventListener("click",()=>selectDay(date,true));
      return button;
    }
    function extendStrip(){
      if(getCurrentRole()!=="master"||getCurrentTab()!=="calendar"||
         !stripReady||!weekDays.clientWidth||!stripStep())return;
      const edge=stripStep()*10,orders=getOrders();
      const selected=getSelectedDate();
      if(weekDays.scrollLeft<edge){
        const oldFirst=weekDays.firstElementChild;
        const before=oldFirst?.offsetLeft??0;
        const nodes=[];
        for(let i=EXTEND_DAYS;i>=1;i--)
          nodes.push(createMasterTile(addDays(stripStart,-i),selected,orders));
        weekDays.prepend(...nodes);
        stripStart=addDays(stripStart,-EXTEND_DAYS);
        const offset=oldFirst.offsetLeft-before;
        if(Number.isFinite(offset))weekDays.scrollLeft+=offset;
      }else if(weekDays.scrollLeft+weekDays.clientWidth>weekDays.scrollWidth-edge){
        const nodes=[];
        for(let i=1;i<=EXTEND_DAYS;i++)
          nodes.push(createMasterTile(addDays(stripEnd,i),selected,orders));
        weekDays.append(...nodes);
        stripEnd=addDays(stripEnd,EXTEND_DAYS);
      }
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
      const previousOffset=Number(weekDays.scrollLeft)||0;
      if(isMaster){
        if(!stripStart||selectedDate<stripStart||selectedDate>stripEnd){
          stripStart=addDays(monday,-EXTEND_DAYS);
          stripEnd=addDays(monday,70);
          stripReady=false;
          stripTarget=monday;
        }
        weekDays.replaceChildren();
        for(let date=stripStart;date<=stripEnd;date=addDays(date,1))
          weekDays.append(createMasterTile(date,selectedDate,orders));
        // Initial view starts with Monday, but users can scroll one date at a time.
        if(stripTarget||!stripReady){
          const target=stripTarget||monday;
          const alignWhenVisible=()=>{
            // Calendar render runs before its panel is unhidden; wait for the next paint.
            if(getCurrentRole()!=="master"||stripTarget!==target)return;
            const x=pixelForDate(target);
            if(x!==null&&weekDays.clientWidth){
              weekDays.scrollLeft=x;
              stripReady=true;
              stripTarget=null;
            }
          };
          alignWhenVisible();
          if(!stripReady&&typeof deps.requestAnimationFrame==="function")
            deps.requestAnimationFrame(alignWhenVisible);
        }else weekDays.scrollLeft=previousOffset;
      }else{
        stripStart=null;stripEnd=null;stripReady=false;stripTarget=null;
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
      // Let iOS handle drag and inertia; scroll-snap aligns to the nearest day.
      weekDays.addEventListener("scroll",extendStrip,{passive:true});

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
