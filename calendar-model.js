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
      const todayRow=deps.getElement?.("masterCalendarTodayRow");
      if(todayRow){
        const today=getCurrentRole()==="master"?deps.masterClock().date:localDate(new Date());
        todayRow.hidden=selectedDate===today;
      }
      const {monday,sunday,days}=weekDates(selectedDate);
      ordersDayDateLabel.textContent=parseDate(monday).getDate()+"–"+
        parseDate(sunday).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
      const orders=getOrders();
      weekDays.replaceChildren();
      ordersWeekDays.replaceChildren();
      for(const date of days){
        const dateObj=parseDate(date);
        const hasOrders=orders.some(o=>o.date===date&&o.status!=="Отменён");
        const btn=make("button","day"+(date===selectedDate?" active":"")+
          (hasOrders?" has-orders":""));
        btn.type="button";
        btn.setAttribute("aria-label",dateObj.toLocaleDateString("ru-RU"));
        btn.setAttribute("aria-pressed",String(date===selectedDate));
        btn.append(make("span","weekday",dateObj.toLocaleDateString("ru-RU",{weekday:"short"})));
        btn.append(make("strong","",dateObj.getDate()));
        btn.addEventListener("click",()=>selectDay(date,true));
        weekDays.append(btn);
        const chip=make("button","rd-orders-weekday"+(date===selectedDate?" is-selected":"")+
          (hasOrders?" has-orders":""));
        chip.type="button";
        chip.setAttribute("aria-label",dateObj.toLocaleDateString("ru-RU"));
        chip.setAttribute("aria-pressed",String(date===selectedDate));
        chip.append(make("span","",dateObj.toLocaleDateString("ru-RU",{weekday:"short"})));
        chip.append(make("strong","",dateObj.getDate()));
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
      const shift=days=>{setSelectedDate(addDays(getSelectedDate(),days));setCurrentTab("calendar");render();};
      const today=()=>{setSelectedDate(getCurrentRole()==="master"?deps.masterClock().date:localDate(new Date()));setCurrentTab("calendar");render();};
      onClick("prevWeek",()=>shift(-7));
      onClick("nextWeek",()=>shift(7));
      onClick("goToday",today);
      calendarDate.addEventListener("change",()=>{
        if(calendarDate.value){setSelectedDate(calendarDate.value);render();}
      });
      onClick("rdOrdersPrevWeek",()=>shift(-7));
      onClick("rdOrdersNextWeek",()=>shift(7));
      onClick("rdOrdersToday",today);
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
