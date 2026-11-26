/* One orders workspace. Only view state lives here; existing order forms,
 * dialogs, permissions and persistence remain in their original modules. */
"use strict";
(()=>{
  const $=id=>document.getElementById(id);
  const node=(tag,cls="",text)=>{
    const value=document.createElement(tag);
    if(cls)value.className=cls;
    if(text!==undefined)value.textContent=String(text);
    return value;
  };
  const LIST_PAGE_SIZE=40;
  const initialState={mode:"calendar",searchOpen:false,query:"",status:"",master:"",date:"",quick:"",searchReturn:null,listPage:0};
  const state={...initialState};
  const cancelledOpen=new Set();
  let mounted=false,sourceCache=null,nextOrder=null,listRows=null,listDayCounts=null;
  const icon=kind=>{
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
    svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");
    svg.setAttribute("stroke-width","1.9");svg.setAttribute("stroke-linecap","round");
    svg.setAttribute("stroke-linejoin","round");
    const paths={search:"M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",filter:"M3 4h18l-7 8v7l-4 2v-9z",close:"m6 6 12 12M18 6 6 18"};
    const path=document.createElementNS(svg.namespaceURI,"path");
    path.setAttribute("d",paths[kind]);svg.append(path);return svg;
  };
  function button(id,label,kind,action){
    const result=node("button","ow-icon-button");result.type="button";result.id=id;
    result.setAttribute("aria-label",label);result.title=label;
    if(kind)result.append(icon(kind));else result.textContent=label;
    result.addEventListener("click",action);return result;
  }
  function isActive(){
    if(!["owner","manager","master"].includes(currentRole)||$("appScreen")?.hidden||$("ordersArea")?.hidden)return false;
    return currentRole==="master"
      ?!["payments","reports","settings"].includes(window.__rdMasterCurrentPage)
      :window.__rdCurrentPage==="orders";
  }
  function currentMode(){return state.searchOpen?"all":state.mode;}
  function beforeRender(){
    if(!isActive())return;
    if(currentTab==="history"){
      currentTab="all";state.status="Выполнен";state.listPage=0;
    }
    if(!state.searchOpen)state.mode=currentTab==="calendar"?"calendar":"all";
  }
  function calendarOrders(rows){
    if(!isActive())return rows;
    const key=[currentRole,currentUser?.id||"",state.master,window.__rdOrdersRevision||0].join("|");
    if(sourceCache?.rows===rows&&sourceCache.key===key)return sourceCache.filtered;
    const filtered=rows.filter(order=>(currentRole!=="master"||order.assignedUserId===currentUser?.id)&&
      (!state.master||String(order.master||"").trim()===state.master));
    sourceCache={rows,key,filtered};return filtered;
  }
  function filterOrders(rows){
    const query=window.__rdOrderReference.normalize(state.query);
    const phoneQuery=/^[+\d\s()-]{3,}$/.test(query)?query.replace(/\D/g,""):"";
    return rows.filter(order=>{
      if(currentRole==="master"&&order.assignedUserId!==currentUser?.id)return false;
      if(state.master&&String(order.master||"").trim()!==state.master)return false;
      if(state.status&&(state.status==="unpaid"?!(order.status==="Выполнен"&&!order.paid):order.status!==state.status))return false;
      if(state.quick&&(["Выполнен","Отменён"].includes(order.status)||
        (state.quick==="unassigned"&&String(order.master||"").trim())))return false;
      if(currentTab!=="calendar"&&!state.searchOpen&&state.date&&order.date!==state.date)return false;
      if(!query)return true;
      const haystack=window.__rdOrderReference.normalize([order.name,order.phone,order.address,
        order.master,order.date,order.time,order.status,order.referenceCode,order.orderNumber,order.id].join(" "));
      return haystack.includes(query)||Boolean(phoneQuery&&String(order.phone||"").replace(/\D/g,"").includes(phoneQuery));
    });
  }
  function pageList(rows,activeOrderId){
    listRows=currentTab==="all"?rows:null;
    listDayCounts=null;
    if(!listRows)return rows;
    const activeIndex=activeOrderId?rows.findIndex(order=>String(order.id)===activeOrderId):-1;
    const lastPage=Math.max(0,Math.ceil(rows.length/LIST_PAGE_SIZE)-1);
    state.listPage=activeIndex>=0?Math.floor(activeIndex/LIST_PAGE_SIZE):Math.min(state.listPage,lastPage);
    if(!lastPage)return rows;
    listDayCounts=new Map();
    for(const order of rows){
      const date=order.date||"";
      listDayCounts.set(date,(listDayCounts.get(date)||0)+1);
    }
    const start=state.listPage*LIST_PAGE_SIZE;
    return rows.slice(start,start+LIST_PAGE_SIZE);
  }
  function listPosition(id){
    if(!isActive()||currentTab!=="all"||!listRows)return null;
    const index=listRows.findIndex(order=>String(order.id)===String(id));
    if(index<0)return null;
    return {index,total:listRows.length,previous:listRows[index-1]?.id,next:listRows[index+1]?.id};
  }
  function revealOrder(id){
    const position=listPosition(id);
    if(!position)return;
    const page=Math.floor(position.index/LIST_PAGE_SIZE);
    if(page!==state.listPage){state.listPage=page;render();}
  }
  function renderListPages(){
    if(currentTab!=="all"||!listRows||listRows.length<=LIST_PAGE_SIZE)return;
    const pages=Math.ceil(listRows.length/LIST_PAGE_SIZE);
    const change=delta=>{
      state.listPage+=delta;
      render();
      const title=$("listTitle");
      title.tabIndex=-1;
      title.focus({preventScroll:true});
      title.scrollIntoView({block:"start"});
    };
    const nav=node("nav","ow-list-pages");nav.setAttribute("aria-label","Страницы заказов");
    const prev=node("button","secondary","Назад"),next=node("button","secondary","Далее");
    const current=node("span","ow-list-page","Страница "+(state.listPage+1)+" из "+pages);
    prev.type=next.type="button";
    prev.disabled=state.listPage===0;next.disabled=state.listPage===pages-1;
    prev.addEventListener("click",()=>change(-1));next.addEventListener("click",()=>change(1));
    nav.append(prev,current,next);$("orders").append(nav);
  }
  function navigateMode(mode){
    if(currentRole==="master"&&window.__rdMasterNavigate){
      window.__rdMasterNavigate(mode==="calendar"?"day":"orders",false);
    }else{
      currentTab=mode;render();
    }
  }
  function selectMode(mode){
    if(!["calendar","all"].includes(mode))return;
    closeFilters();
    if(state.searchOpen)restoreSearch(false);
    state.mode=mode;
    navigateMode(mode);
  }
  function openSearch(){
    if(state.searchOpen)return;
    closeFilters();
    state.searchReturn={mode:state.mode,date:selectedDate,status:state.status,master:state.master,listDate:state.date,quick:state.quick,listPage:state.listPage};
    state.searchOpen=true;state.query="";state.status="";state.master="";state.date="";state.quick="";state.listPage=0;
    navigateMode("all");
    $("owSearchInput")?.focus({preventScroll:true});
  }
  function restoreSearch(redraw=true){
    closeFilters();
    const previous=state.searchReturn;
    state.searchOpen=false;state.query="";state.searchReturn=null;
    if(previous){
      state.mode=previous.mode;selectedDate=previous.date;
      if(currentRole==="master")masterFollowsToday=selectedDate===masterClock().date;
      state.status=previous.status;state.master=previous.master;state.date=previous.listDate;state.quick=previous.quick;state.listPage=previous.listPage;
    }
    if($("owSearchInput"))$("owSearchInput").value="";
    if(redraw){navigateMode(state.mode);$("owSearchToggle")?.focus({preventScroll:true});}
    else currentTab=state.mode;
  }
  function field(id,labelText,tag="select"){
    const label=node("label","ow-filter-field",labelText);
    const input=node(tag);input.id=id;label.htmlFor=id;label.append(input);return {label,input};
  }
  function addOptions(select,options){
    select.replaceChildren(...options.map(([value,title])=>{
      const option=node("option","",title);option.value=value;return option;
    }));
  }
  function closeFilters(restoreFocus=false){
    const panel=$("owFilters");
    if(!panel||panel.hidden)return;
    panel.hidden=true;
    const toggle=$("owFilterToggle");
    toggle?.setAttribute("aria-expanded","false");
    if(restoreFocus)toggle?.focus({preventScroll:true});
  }
  function resetForAccount(){
    closeFilters();
    Object.assign(state,initialState);
    cancelledOpen.clear();
    sourceCache=null;nextOrder=null;listRows=null;listDayCounts=null;
    if($("owSearchInput"))$("owSearchInput").value="";
    if($("owSearch"))$("owSearch").hidden=true;
  }
  function openFilters(){
    const panel=$("owFilters");
    if(!panel)return;
    if(!panel.hidden){closeFilters();return;}
    $("owFilterStatus").value=state.status;
    const master=$("owFilterMaster"),masters=[...new Set(getOrders().map(o=>String(o.master||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
    addOptions(master,[["","Все мастера"],...masters.map(name=>[name,name])]);
    master.value=state.master;master.closest("label").hidden=currentRole==="master";
    const date=$("owFilterDate");date.value=state.date;
    date.closest("label").hidden=currentTab==="calendar"||state.searchOpen;
    panel.hidden=false;$("owFilterToggle").setAttribute("aria-expanded","true");
    $("owFilterStatus").focus({preventScroll:true});
  }
  function mount(){
    if(mounted||!isActive())return;
    const area=$("ordersArea"),calendar=$("calendarPanel");
    const tools=node("section");tools.id="owTools";tools.setAttribute("aria-label","Управление заказами");
    const toolbar=node("div","ow-toolbar");
    const modes=node("div","ow-view-switch");modes.id="owViewSwitch";modes.setAttribute("role","tablist");modes.setAttribute("aria-label","Вид заказов");
    for(const [value,label] of [["calendar","По дням"],["all","Все заказы"]]){
      const tab=node("button","",label);tab.type="button";tab.dataset.owMode=value;
      tab.setAttribute("role","tab");tab.setAttribute("aria-controls","orders");
      tab.addEventListener("click",()=>selectMode(value));modes.append(tab);
    }
    modes.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();const value=event.key==="Home"?"calendar":event.key==="End"?"all":currentTab==="calendar"?"all":"calendar";
      selectMode(value);modes.querySelector('[data-ow-mode="'+value+'"]').focus({preventScroll:true});
    });
    const search=node("div","ow-search");search.id="owSearch";search.hidden=true;
    const input=node("input");input.id="owSearchInput";input.type="search";
    input.setAttribute("aria-label","Поиск по всем заказам");
    input.placeholder="Имя, телефон, адрес, №";input.autocomplete="off";
    input.addEventListener("input",()=>{state.query=input.value;state.listPage=0;render();});
    search.append(input,button("owSearchClose","Закрыть поиск","close",()=>restoreSearch()));
    const searchToggle=button("owSearchToggle","Найти заказ","search",openSearch);
    searchToggle.setAttribute("aria-controls","owSearch");searchToggle.setAttribute("aria-expanded","false");
    const filter=button("owFilterToggle","Фильтры заказов","filter",openFilters);
    filter.setAttribute("aria-controls","owFilters");filter.setAttribute("aria-expanded","false");
    toolbar.append(modes,searchToggle,search,filter);
    const summary=node("div","ow-filter-summary");summary.id="owFilterSummary";summary.hidden=true;
    const panel=node("section");panel.id="owFilters";panel.hidden=true;
    panel.setAttribute("aria-labelledby","owFilterTitle");
    const form=node("form");form.id="owFilterForm";
    const title=node("h2","","Фильтры заказов");title.id="owFilterTitle";
    const top=node("div","ow-filter-head");
    top.append(title,button("owFilterCancel","Закрыть фильтры","close",()=>closeFilters(true)));
    const status=field("owFilterStatus","Статус");
    addOptions(status.input,[["","Все статусы"],["Записан","Записаны"],["В работе","В работе"],["Выполнен","Выполнены"],["Отменён","Отменены"],["unpaid","Ожидают оплаты"]]);
    const master=field("owFilterMaster","Мастер"),date=field("owFilterDate","Дата","input");date.input.type="date";
    const actions=node("div","ow-filter-actions");
    const reset=node("button","secondary","Сбросить");reset.id="owFilterReset";reset.type="button";
    reset.addEventListener("click",()=>{status.input.value="";master.input.value="";date.input.value="";});
    const apply=node("button","primary","Применить");apply.id="owFilterApply";apply.type="submit";
    actions.append(reset,apply);form.append(top,status.label,master.label,date.label,actions);panel.append(form);
    tools.append(toolbar,panel,summary);area.insertBefore(tools,calendar);
    form.addEventListener("submit",event=>{
      event.preventDefault();state.status=status.input.value;state.master=currentRole==="master"?"":master.input.value;
      state.date=currentTab==="calendar"||state.searchOpen?"":date.input.value;state.quick="";state.listPage=0;closeFilters(true);render();
    });
    tools.addEventListener("keydown",event=>{
      if(event.key!=="Escape"||panel.hidden&&!state.searchOpen)return;
      event.preventDefault();
      if(!panel.hidden)closeFilters(true);
      else restoreSearch();
    });
    const today=$("goToday");today.querySelector("span").textContent="Сегодня";today.setAttribute("aria-label","Вернуться к сегодняшнему дню");
    const settings=$("rdSettings");
    if(settings){
      const tools=node("section","ow-settings-tools");tools.setAttribute("aria-label","Инструменты заказов");
      tools.append(node("h2","","Заказы и расписание"));
      for(const control of [document.querySelector(".rd-orders-quick-slots"),document.querySelector(".rd-raul-share-tools")])
        if(control)tools.append(control);
      settings.append(tools);
    }
    mounted=true;
  }
  function selectDay(date){
    state.mode="calendar";currentTab="calendar";
    const input=$("calendarDate");input.value=date;input.dispatchEvent(new Event("change",{bubbles:true}));
  }
  function openNext(){
    if(!nextOrder)return;
    const id=nextOrder.id,date=nextOrder.date;
    state.status="";state.quick="";selectDay(date);
    if(currentRole==="master")window.__rdOpenMasterOrder?.(id);
    else window.__rdOpenOrderDetail?.(id);
  }
  function refreshNext(){
    const root=$("masterTodaySummary");
    if(currentTab!=="calendar"||state.searchOpen){
      nextOrder=null;root.hidden=true;root.replaceChildren();delete root.dataset.owNext;return;
    }
    const now=masterClock();
    nextOrder=calendarOrders(getOrders()).filter(order=>order.status==="Записан"&&
      (order.date>now.date||(order.date===now.date&&masterTimeMinutes(order.time)>=now.minutes)))
      .sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.time||"").localeCompare(String(b.time||"")))[0]||null;
    root.hidden=!nextOrder;
    if(root.hidden){root.replaceChildren();delete root.dataset.owNext;return;}
    const when=(nextOrder.date===now.date?"Сегодня":formatDate(nextOrder.date))+" · "+(nextOrder.time||"Без времени")+" · "+(nextOrder.name||"Клиент");
    const signature=JSON.stringify([nextOrder.id,when]);
    if(root.dataset.owNext===signature&&root.children.length)return;
    root.dataset.owNext=signature;
    const jump=node("button","master-next-jump master-next-compact");jump.type="button";
    jump.setAttribute("aria-label","Ближайший выезд: "+when+". Открыть заказ");
    jump.append(node("span","master-next-caption","Ближайший"),node("strong","master-next-value",when));
    jump.addEventListener("click",openNext);root.replaceChildren(jump);
  }
  function renderCancelled(rows,createCard){
    if(!rows.length)return;
    const section=node("section","ow-cancelled");
    const toggle=node("button","ow-cancelled-toggle","Отменённые · "+rows.length);toggle.type="button";
    const list=node("div","ow-cancelled-body");list.id="owCancelledOrders";
    list.hidden=!cancelledOpen.has(selectedDate);
    toggle.setAttribute("aria-controls",list.id);toggle.setAttribute("aria-expanded",String(!list.hidden));
    rows.forEach(order=>list.append(createCard(order)));
    toggle.addEventListener("click",()=>{
      list.hidden=!list.hidden;
      if(list.hidden)cancelledOpen.delete(selectedDate);else cancelledOpen.add(selectedDate);
      toggle.setAttribute("aria-expanded",String(!list.hidden));
    });
    section.append(toggle,list);$("orders").append(section);
  }
  function refresh(){
    const active=isActive();$("appScreen")?.classList.toggle("rd-unified-orders",active);
    if($("owSearchToggle"))$("owSearchToggle").hidden=!active;
    if(!active){
      closeFilters();
      if(state.searchOpen)restoreSearch(false);
      return;
    }
    mount();beforeRender();
    $("owSearchToggle").hidden=state.searchOpen;$("owSearchToggle").setAttribute("aria-expanded",String(state.searchOpen));
    $("owSearch").hidden=!state.searchOpen;$("owViewSwitch").hidden=state.searchOpen;
    for(const tab of $("owViewSwitch").querySelectorAll("button")){
      const selected=tab.dataset.owMode===(currentTab==="calendar"?"calendar":"all");
      tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected?0:-1;
    }
    $("calendarPanel").hidden=currentTab!=="calendar"||state.searchOpen;
    $("rdOrdersDayPicker").hidden=true;
    if(currentTab==="calendar"){
      const date=parseDate(selectedDate);const month=date.toLocaleDateString("ru-RU",{month:"long",year:"numeric"}).replace(/\s*г\.?$/i,"").trim();
      if(currentRole!=="master")$("masterCalendarDateText").textContent=month.charAt(0).toUpperCase()+month.slice(1);
      $("listTitle").textContent=masterDayLabel(selectedDate);
    }else $("listTitle").textContent=state.searchOpen?"Результаты поиска":"Все заказы";
    const filters=[state.quick==="active"?"Активные заказы":state.quick==="unassigned"?"Без мастера":"",state.status==="unpaid"?"Ожидают оплаты":state.status,state.master,currentTab!=="calendar"&&!state.searchOpen&&state.date?formatDate(state.date):""].filter(Boolean);
    const summary=$("owFilterSummary");summary.hidden=!filters.length;summary.replaceChildren();
    if(filters.length){
      summary.append(node("span","",filters.join(" · ")));
      const clear=node("button","","Сбросить");clear.type="button";
      clear.addEventListener("click",()=>{state.status="";state.master="";state.date="";state.quick="";state.listPage=0;render();});summary.append(clear);
    }
    $("owFilterToggle").classList.toggle("has-filters",filters.length>0);
    $("owFilterToggle").setAttribute("aria-label","Фильтры заказов"+(filters.length?", активно: "+filters.length:""));
    refreshNext();
    const empty=$("orders").querySelector(":scope > .empty");
    if(empty){
      const text=state.searchOpen?"Заказы не найдены":filters.length?"По выбранным фильтрам заказов нет":currentTab==="calendar"?
        (selectedDate===masterClock().date?"На сегодня выездов нет":"На этот день выездов нет"):"Заказов пока нет";
      empty.replaceChildren(node("span","",text));
      if(currentTab==="calendar"&&nextOrder&&nextOrder.date!==selectedDate){
        const next=node("button","ow-empty-next","Открыть ближайший день с заказом");next.type="button";
        next.addEventListener("click",()=>{state.status="";state.quick="";selectDay(nextOrder.date);});empty.append(next);
      }
    }
  }
  function show({filter="",orderId=null,date="",onDismiss}={}){
    if(!["owner","manager","master"].includes(currentRole))return false;
    if(state.searchOpen)restoreSearch(false);
    state.query="";state.status="";state.master="";state.date="";state.quick="";state.listPage=0;
    state.mode=date&&!orderId?"calendar":"all";
    if(date&&!orderId){selectedDate=date;if(currentRole==="master")masterFollowsToday=date===masterClock().date;}
    if(filter==="progress")state.status="В работе";
    else if(filter==="unpaid")state.status="unpaid";
    else if(["active","unassigned"].includes(filter))state.quick=filter;
    if(currentRole==="master")navigateMode(state.mode);
    else window.__rdNavigate?.("orders");
    if(!orderId)return true;
    if(currentRole==="master"){
      const order=getOrders().find(o=>String(o.id)===String(orderId)&&o.assignedUserId===currentUser?.id);
      if(!order)return false;
      revealOrder(order.id);
      window.__rdOpenMasterOrder?.(order.id);return true;
    }
    return Boolean(window.__rdOpenOrderDetail?.(String(orderId),onDismiss));
  }
  window.__rdOrdersWorkspace={isActive,currentMode,beforeRender,filterOrders,calendarOrders,
    pageList,listPosition,revealOrder,renderListPages,dayCounts:()=>listDayCounts,
    selectMode,show,refresh,refreshOverview:refreshNext,renderCancelled,closeFilters,resetForAccount,status:()=>state.status};
  const previousRefresh=window.__rdRefresh;
  window.__rdRefresh=(...args)=>{const value=previousRefresh?.(...args);refresh();return value;};
  const previousAccess=window.__rdAccess;
  window.__rdAccess=(...args)=>{const value=previousAccess?.(...args);refresh();return value;};
  refresh();
  if(isActive())render();
})();
