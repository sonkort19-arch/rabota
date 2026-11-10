
/* Presentation-only upgrade. All auth, orders, finances and mutations stay in index.html. */
"use strict";
(()=>{
const app=document.getElementById("appScreen");
const body=document.body;
body.classList.add("rd");
const $=id=>document.getElementById(id);
const makeNode=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=String(text);return n};
const sections=["home","leads","orders","calendar","clients","finance","ai"];
const titles={home:"Главная",leads:"Лиды",orders:"Заказы",calendar:"Календарь",clients:"Клиенты",finance:"Финансы",ai:"ИИ-чат"};
const crmReturnPages=new Set(["home","leads","orders","calendar","clients","finance"]);
function aiChatUrl(draft){
 const source=crmReturnPages.has(activePage)?activePage:"home";
 const query=new URLSearchParams({from:source});
 if(draft)query.set("draft",draft);
 return "/ai.html?"+query.toString();
}
function openAiChat(draft){window.location.assign(aiChatUrl(draft))}
/* Consistent, accessible outline icons: no third-party library and no remote assets. */
const iconPaths={
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
 leads:'<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 13h5"/><circle cx="19" cy="18" r="3"/>',
 orders:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h6M9 17h4"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/>',
 clients:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 finance:'<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-8h4v8M2 21h20"/>',
 ai:'<path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
 more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
 search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 alert:'<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.01"/>',
 wallet:'<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M4 9V6a3 3 0 0 1 3-3h11M16 13h6v5h-6a2.5 2.5 0 0 1 0-5Z"/>',
 chart:'<path d="M3 20V4M3 20h18M7 16l4-5 4 3 5-8"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
  progress:'<path d="M9.11 5.02 L10.17 4.67 L10.37 2.74 L13.63 2.74 L13.83 4.67 L14.89 5.02 L14.89 5.02 L15.89 5.53 L17.39 4.3 L19.7 6.61 L18.47 8.11 L18.98 9.11 L18.98 9.11 L19.33 10.17 L21.26 10.37 L21.26 13.63 L19.33 13.83 L18.98 14.89 L18.98 14.89 L18.47 15.89 L19.7 17.39 L17.39 19.7 L15.89 18.47 L14.89 18.98 L14.89 18.98 L13.83 19.33 L13.63 21.26 L10.37 21.26 L10.17 19.33 L9.11 18.98 L9.11 18.98 L8.11 18.47 L6.61 19.7 L4.3 17.39 L5.53 15.89 L5.02 14.89 L5.02 14.89 L4.67 13.83 L2.74 13.63 L2.74 10.37 L4.67 10.17 L5.02 9.11 L5.02 9.11 L5.53 8.11 L4.3 6.61 L6.61 4.3 L8.11 5.53 L9.11 5.02Z"/><circle cx="12" cy="12" r="2.8"/>',
 pin:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 radiator:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M11 5v14M15 5v14M19 5v14M3 9h18"/>',
 heat:'<path d="M5 20c-3-5 4-6 1-11M11 20c-3-5 4-6 1-11M17 20c-3-5 4-6 1-11"/>',
 note:'<path d="M4 4h16v13H9l-5 4V4Z"/><path d="M8 9h8M8 13h6"/>',
 phone:'<path d="M6 3h4l1 5-2.5 2c1.3 2.7 2.8 4.2 5.5 5.5l2-2.5 5 1v4c0 1.5-1.5 2.5-3.2 2.2C9.7 19.3 4.7 14.3 3.8 6.2 3.5 4.5 4.5 3 6 3Z"/>',
 message:'<path d="M20 11.6A8.4 8.4 0 0 1 7.7 19L3 21l1.7-4.8A8.4 8.4 0 1 1 20 11.6Z"/><path d="M9 9c1 3 2 4 5 5"/>',
 pencil:'<path d="m4 20 4.5-1 11-11a2 2 0 0 0-3-3l-11 11L4 20ZM14.5 7.5l3 3"/>',
 location:'<path d="M3 20h18"/><path d="m5 17 7-12 7 12"/>'

};
function uiIcon(name,extra=""){
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
 svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("fill","none");
 svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.85");
 svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");
 svg.setAttribute("aria-hidden","true");svg.classList.add("rd-svgicon");
 if(extra)svg.classList.add(extra);
 svg.innerHTML=iconPaths[name]||iconPaths.orders;return svg;
}
let activePage="home",ready=false,lastOrderKey="",rdSearchTerm="",selectedClientKey=null,builtRole=null,calendarMode="week",calendarMaster="",calendarStatus="",calendarHideDone=false,calendarOpened=false;
let calendarWeekCache="",calendarDetailCache="",calendarMastersCache="";
let calendarFiltersOpen=false;
const calendarExpandedOrders=new Set();
function selectCalendarDate(date,openDay=false){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))return;
 const mode=openDay?"day":calendarMode;
 if(selectedDate===date&&calendarMode===mode)return;
 selectedDate=date;calendarMode=mode;drawCalendar();
}
function switchCalendarMode(mode){
 if(!["week","day","list"].includes(mode)||calendarMode===mode)return;
 calendarMode=mode;drawCalendar();
}
function syncCalendarFilterUI(){
 const nav=$("rdCalendarNavigation"),board=$("rdCalendarBoard"),button=$("rdCalendarFilterToggle");
 if(!nav||!board||!button)return;
 nav.classList.toggle("is-filters-open",calendarFiltersOpen);
 board.classList.toggle("is-filters-open",calendarFiltersOpen);
 const count=Number(Boolean(calendarMaster))+Number(Boolean(calendarStatus))+Number(calendarHideDone);
 button.textContent=count?"Фильтры ("+count+")":"Фильтры";
 button.classList.toggle("has-filters",count>0);
 button.setAttribute("aria-expanded",String(calendarFiltersOpen));
}
const orderTabFilters={calendar:{master:"",status:"",search:""},all:{master:"",status:"",search:""},history:{master:"",status:"",search:""}};
let orderFiltersOpen=false;
let summaryFilter="";
let homeAnalyticsOpen=false;
function clearQuickFilter(){summaryFilter="";}
function syncOrderFiltersButton(){
 const btn=$("rdOrdersFilterToggle");if(!btn)return;
 const dateActive=currentTab==="history"?Boolean(orderHistoryDateFilter):
   currentTab==="all"?Boolean(orderListDateFilter):false;
 const count=Number(dateActive)+Number(Boolean($("rdMasterFilter")?.value))+
   Number(Boolean($("rdStatusFilter")?.value));
 btn.textContent=count?"Фильтры ("+count+")":"Фильтры";
 btn.classList.toggle("has-filters",count>0);
 btn.setAttribute("aria-expanded",String(orderFiltersOpen));
}
function storeOrderFilters(tab){
 const state=orderTabFilters[tab];if(!state)return;
 state.master=$("rdMasterFilter")?.value||"";
 state.status=$("rdStatusFilter")?.value||"";
 state.search=rdSearchTerm;
}
function restoreOrderFilters(tab){
 const state=orderTabFilters[tab];if(!state)return;
 const master=$("rdMasterFilter"),status=$("rdStatusFilter"),search=$("rdTopSearch");
 if(master)master.value=state.master;
 if(status)status.value=state.status;
 rdSearchTerm=state.search;
 if(search)search.value=state.search;
}
window.__rdSwitchOrderFilters=(oldTab,newTab)=>{clearQuickFilter();storeOrderFilters(oldTab);restoreOrderFilters(newTab)};
window.__rdOrderRestoreFilters=restoreOrderFilters;
function todayMoscow(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function dateLong(day){if(!day)return "Дата не указана";return parseDate(day).toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}
function cash(num){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(num)||0)+" ₽"}
function smText(t){return String(t||"").trim()}
function activeOrders(){return getOrders().filter(o=>o.status!=="Отменён")}
function boxText(tag,text,cls){return makeNode(tag,cls||"",text)}
function panel(title,intro){
 const n=makeNode("section","rd-panel");
 const heading=makeNode("div","rd-panel-heading");
 const name=title.includes("ИИ")?"ai":title.includes("Динамика")?"chart":title.includes("записи")?"clock":title.includes("внимания")?"alert":title.includes("заказы")?"orders":"clients";
 heading.append(uiIcon(name),boxText("h2",title));n.append(heading);
 if(intro)n.append(boxText("div",intro,"rd-panel-intro"));return n;
}
function rowEntry(parent,label,desc,meta,action){const row=makeNode("div","rd-row");const left=makeNode("div","rd-row-main");left.append(boxText("strong",label),boxText("span",desc));row.append(left,boxText("span",meta,"rd-row-meta"));if(action){row.style.cursor="pointer";row.tabIndex=0;row.setAttribute("role","button");row.addEventListener("click",action);row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();action()}})}parent.append(row)}
function sectionView(id,title,subtitle){
 const n=makeNode("section","rd-view");n.id=id;
 n.append(boxText("div","CRM / Работа · московское время","rd-view-kicker"),
 boxText("h1",title,"rd-view-title"),boxText("p",subtitle,"rd-view-subtitle"));
 return n;
}
function stats(node,items){
 const wrap=makeNode("div","rd-stats");
 items.forEach(item=>{
  const label=item.label;
  const kind=label==="В работе"?"progress":label==="Новые"?"clock":
   label==="Не оплачено"||label.includes("оплач")||label.includes("Оплач")||label.includes("оплат")?"wallet":
   label.includes("Выполнено")?"check":label.includes("Клиенты")?"clients":
   label.includes("сегодня")?"calendar":"orders";
  const card=makeNode(item.filter?"button":"div","rd-stat rd-stat-"+kind+(item.filter?" rd-stat-shortcut":""));
  if(item.filter){
   card.type="button";
   card.dataset.filter=item.filter;
   card.setAttribute("aria-label","Показать заказы: "+label+", "+item.value);
   card.setAttribute("aria-pressed",String(summaryFilter===item.filter));
   card.classList.toggle("is-selected",summaryFilter===item.filter);
   card.addEventListener("click",()=>applySummaryFilter(item.filter));
  }
  const icon=makeNode("span","rd-stat-icon");
  icon.setAttribute("aria-hidden","true");
  icon.append(uiIcon(kind));
  const heading=makeNode("div","rd-stat-heading");
  heading.append(icon,boxText("small",label));
  const statBody=makeNode("div","rd-stat-body");
  statBody.append(boxText("strong",item.value,"rd-accent"),boxText("span",item.hint,"rd-stat-hint"));
  card.append(heading,statBody);wrap.append(card);
 });
 node.append(wrap);
}
function navButton(key){const btn=makeNode("button","rd-nav-btn");btn.type="button";btn.dataset.page=key;
 const emblem=makeNode("span","rd-icon");emblem.append(uiIcon(key));
 btn.append(emblem,boxText("span",titles[key]));btn.addEventListener("click",()=>navigate(key));return btn}
function permittedSections(){
 return sections.filter(key=>!(["finance","ai"].includes(key)&&currentRole!=="owner"));
}
function makeProfileMenu(){
 const toggle=makeNode("button","rd-user rd-profile-trigger");
 toggle.type="button";toggle.id="rdProfileToggle";
 toggle.setAttribute("aria-label","Профиль и выход из аккаунта");
 toggle.setAttribute("aria-expanded","false");
 toggle.setAttribute("aria-controls","rdProfileMenu");
 toggle.append(boxText("span",currentRole==="owner"?"В":"М","rd-user-dot"),
  boxText("strong",currentRole==="owner"?"Владелец":"Менеджер"));
 const menu=makeNode("section","rd-profile-menu");menu.id="rdProfileMenu";menu.hidden=true;
 menu.setAttribute("role","dialog");menu.setAttribute("aria-label","Профиль");
 menu.append(boxText("strong","Мой кабинет","rd-profile-title"),
  boxText("span",currentRole==="owner"?"Владелец":"Менеджер","rd-profile-role"));
 const logout=makeNode("button","rd-profile-logout","Выйти из аккаунта");
 logout.type="button";logout.addEventListener("click",()=>{$("logoutBtn").click()});
 menu.append(logout);
 function close(){menu.hidden=true;toggle.setAttribute("aria-expanded","false")}
 toggle.addEventListener("click",()=>{
  const opening=menu.hidden;
  menu.hidden=!opening;toggle.setAttribute("aria-expanded",String(opening));
 });
 document.addEventListener("pointerdown",event=>{
  if(!menu.hidden&&!toggle.contains(event.target)&&!menu.contains(event.target))close();
 });
 document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!menu.hidden){close();toggle.focus()}
 });
 return {toggle,menu,close};
}
let closeMobileMore=()=>{};
function build(){
 if(ready)return;
 const side=makeNode("aside","rd-shell");side.setAttribute("aria-label","Главное меню");
 const brand=makeNode("div","rd-brand");brand.append(boxText("span","▰","rd-logo"));
 const brandText=makeNode("div");brandText.append(boxText("strong","Работа"),boxText("small","CRM · промывка отопления"));brand.append(brandText);side.append(brand);
 const nav=makeNode("nav","rd-nav");
 for(const key of permittedSections())nav.append(navButton(key));
 side.append(nav);
 const foot=makeNode("div","rd-sidefoot");foot.append(boxText("strong","Мой кабинет"),boxText("div","Система заказов и расписания."));
 const logout=makeNode("button","","Выйти из аккаунта");logout.type="button";logout.addEventListener("click",()=>$("logoutBtn").click());foot.append(logout);side.append(foot);
 const top=makeNode("div","rd-top");
 const search=makeNode("input","rd-top-search");search.id="rdTopSearch";search.type="search";search.placeholder="Поиск заказов, клиентов, адресов...";search.setAttribute("aria-label","Поиск по заказам, клиентам и адресам");
 search.addEventListener("input",()=>{
 if(activePage==="leads"){window.__rdLeadsSearch?.(search.value);return}
 if(activePage==="orders")clearQuickFilter();
 rdSearchTerm=search.value.toLocaleLowerCase("ru").trim();
 if(activePage==="clients"){selectedClientKey=null;drawClients();return}
 if(rdSearchTerm&&activePage!=="orders"){
  const intendedSearch=rdSearchTerm;
  navigate("orders");
  rdSearchTerm=intendedSearch;
  orderTabFilters.all.search=intendedSearch;
  $("rdTopSearch").value=intendedSearch;
 }
 filterCards();
});
 top.append(search,boxText("span","Данные из Supabase","rd-top-title"));
 const profile=makeProfileMenu();top.append(profile.toggle);
 const mobile=makeNode("nav","rd-mobilebar");mobile.id="rdMobileNav";
 mobile.setAttribute("aria-label","Основные разделы приложения");
 const primaryMobileSections=["home","leads","orders","calendar"];
 for(const key of primaryMobileSections)mobile.append(navButton(key));
 const navMore=makeNode("button","rd-nav-btn rd-mobile-more-trigger");
 navMore.type="button";navMore.id="rdMobileMoreBtn";
 navMore.setAttribute("aria-label","Ещё: другие разделы");
 navMore.setAttribute("aria-haspopup","true");
 navMore.setAttribute("aria-expanded","false");
 navMore.setAttribute("aria-controls","rdMobileMoreSheet");
 const moreIcon=makeNode("span","rd-icon");moreIcon.append(uiIcon("more"));
 navMore.append(moreIcon,boxText("span","Ещё"));
 mobile.append(navMore);
 const veil=makeNode("button","rd-more-veil");veil.type="button";
 veil.setAttribute("aria-label","Закрыть дополнительные разделы");
 veil.hidden=true;
 const moreSheet=makeNode("nav","rd-more-sheet");
 moreSheet.id="rdMobileMoreSheet";moreSheet.hidden=true;
 moreSheet.setAttribute("aria-label","Дополнительные разделы");
 const moreHeader=makeNode("div","rd-more-header");
 moreHeader.append(boxText("h2","Другие разделы"));
 const moreClose=makeNode("button","rd-more-close","×");
 moreClose.type="button";
 moreClose.setAttribute("aria-label","Закрыть меню дополнительных разделов");
 moreHeader.append(moreClose);
 moreSheet.append(moreHeader);
 for(const key of permittedSections().filter(section=>!primaryMobileSections.includes(section))){
  moreSheet.append(navButton(key));
 }
 const closeMore=()=>{
  moreSheet.hidden=true;veil.hidden=true;
  navMore.setAttribute("aria-expanded","false");
 };
 closeMobileMore=closeMore;
 moreClose.addEventListener("click",()=>{closeMore();navMore.focus()});
 navMore.addEventListener("click",()=>{
  const opening=moreSheet.hidden;
  moreSheet.hidden=!opening;veil.hidden=!opening;
  navMore.setAttribute("aria-expanded",String(opening));
  if(opening)moreSheet.querySelector(".rd-nav-btn")?.focus();
 });
 veil.addEventListener("click",()=>{closeMore();navMore.focus()});
 document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!moreSheet.hidden){closeMore();navMore.focus()}
 });
 window.addEventListener("resize",()=>{
  if(window.innerWidth>790&&!moreSheet.hidden)closeMore();
 });
 app.prepend(top,side,profile.menu,mobile,veil,moreSheet);
 const home=sectionView("rdHome","Главная","Краткая сводка заказов и расписания");
 const homeTitlebar=makeNode("div","rd-home-titlebar");
 const homeSync=makeNode("span","rd-home-synced",$("syncStatus")?.textContent||"");
 homeSync.id="rdHomeSynced";homeSync.setAttribute("role","status");
 homeTitlebar.append(home.querySelector(".rd-view-title"),homeSync);
 home.insertBefore(homeTitlebar,home.querySelector(".rd-view-subtitle"));
 const leads=sectionView("rdLeads","Лиды","Звонки, консультации и повторные контакты");
 const leadsRoot=makeNode("div","rd-leads-mount");leadsRoot.id="rdLeadsMount";leads.append(leadsRoot);
 const clients=sectionView("rdClients","Клиенты","Клиенты из доступных вам заказов");
 const clientsToolbar=makeNode("div","rd-toolbar");
 const clientsInput=makeNode("input");clientsInput.id="rdClientSearch";clientsInput.type="search";clientsInput.placeholder="Найти клиента или телефон";clientsInput.setAttribute("aria-label","Поиск клиентов");
 clientsInput.addEventListener("input",()=>{selectedClientKey=null;drawClients()});
 clientsToolbar.id="rdClientToolbar";clientsToolbar.append(clientsInput);clients.append(clientsToolbar);
 clients.append(makeNode("div","rd-client-list"));clients.querySelector(".rd-client-list").id="rdClientsList";
 const clientHistory=makeNode("section","rd-panel rd-client-history");clientHistory.id="rdClientHistory";clientHistory.hidden=true;clients.append(clientHistory);
 const calendar=sectionView("rdCalendarIntro","Календарь","Расписание, занятость мастеров и редактирование записей");
 calendar.classList.add("rd-calendar-intro");
 const calendarTitlebar=makeNode("div","rd-calendar-titlebar");
 const calendarSync=makeNode("span","rd-calendar-synced",$("syncStatus")?.textContent||"");
 calendarSync.id="rdCalendarSynced";calendarSync.setAttribute("role","status");
 calendarTitlebar.append(calendar.querySelector(".rd-view-title"),calendarSync);
 const quickCalendar=makeNode("button","rd-cal-slots","Свободные окна");
 quickCalendar.type="button";
 quickCalendar.addEventListener("click",()=>window.__rdQuickSlots?.open());
 calendarTitlebar.append(quickCalendar);
 calendar.insertBefore(calendarTitlebar,calendar.querySelector(".rd-view-subtitle"));
 const calendarNav=makeNode("div","rd-toolbar");calendarNav.id="rdCalendarNavigation";
 const previous=makeNode("button","secondary rd-cal-step","‹");
 previous.type="button";previous.title="Предыдущая неделя";previous.setAttribute("aria-label","Предыдущая неделя");
 previous.addEventListener("click",()=>selectCalendarDate(addDays(selectedDate,-7)));
 const next=makeNode("button","secondary rd-cal-step","›");
 next.type="button";next.title="Следующая неделя";next.setAttribute("aria-label","Следующая неделя");
 next.addEventListener("click",()=>selectCalendarDate(addDays(selectedDate,7)));
 const todayBtn=makeNode("button","secondary rd-cal-today","Сегодня");
 todayBtn.type="button";todayBtn.addEventListener("click",()=>selectCalendarDate(todayMoscow()));
 const calendarDateField=makeNode("div","rd-cal-date-field");
 const calendarDateLabel=makeNode("span","rd-cal-date-label");calendarDateLabel.id="rdCalendarDateLabel";calendarDateLabel.setAttribute("aria-hidden","true");
 const calendarSelect=makeNode("input");calendarSelect.type="date";calendarSelect.id="rdCalendarDate";calendarSelect.setAttribute("aria-label","Выбрать дату в расписании");
 calendarDateField.append(calendarDateLabel,calendarSelect);
 calendarSelect.addEventListener("change",()=>selectCalendarDate(calendarSelect.value));
 const calendarMasterSelect=makeNode("select");calendarMasterSelect.id="rdCalendarMaster";
 calendarMasterSelect.setAttribute("aria-label","Показать мастера");
 calendarMasterSelect.addEventListener("change",()=>{calendarMaster=calendarMasterSelect.value;drawCalendar()});
 const calendarStatusSelect=makeNode("select");calendarStatusSelect.id="rdCalendarStatus";
 calendarStatusSelect.setAttribute("aria-label","Фильтр календаря по статусу");
 [["","Все статусы"],["Новый","Новый"],["Записан","Записан"],["В работе","В работе"],["Выполнен","Выполнен"]].forEach(([value,label])=>{
  const o=makeNode("option","",label);o.value=value;calendarStatusSelect.append(o)
 });
 calendarStatusSelect.addEventListener("change",()=>{calendarStatus=calendarStatusSelect.value;drawCalendar()});
 const calendarFilterToggle=makeNode("button","secondary rd-cal-filter-toggle","Фильтры");
 calendarFilterToggle.id="rdCalendarFilterToggle";calendarFilterToggle.type="button";
 calendarFilterToggle.setAttribute("aria-controls","rdCalendarMaster rdCalendarStatus rdCalendarHideDone");
 calendarFilterToggle.setAttribute("aria-expanded","false");
 calendarFilterToggle.addEventListener("click",()=>{
  calendarFiltersOpen=!calendarFiltersOpen;syncCalendarFilterUI();
 });
 calendarNav.append(previous,calendarDateField,next,todayBtn,calendarFilterToggle,
  calendarMasterSelect,calendarStatusSelect);
 const board=makeNode("section","rd-panel rd-view-area rd-calendar-panel");board.id="rdCalendarBoard";
 const boardHeading=makeNode("div","rd-calendar-heading");
 const weekHeading=boxText("h2","Расписание на неделю");weekHeading.id="rdCalendarWeekTitle";
 const modes=makeNode("div","rd-calendar-modes");modes.setAttribute("role","group");modes.setAttribute("aria-label","Режим просмотра календаря");
 [["week","Неделя"],["day","День"],["list","Список"]].forEach(([mode,label])=>{
  const btn=makeNode("button","rd-calendar-mode",label);btn.type="button";btn.dataset.mode=mode;
  btn.addEventListener("click",()=>switchCalendarMode(mode));modes.append(btn)
 });
 boardHeading.append(weekHeading,modes);
 const doneLabel=makeNode("label","rd-calendar-done-toggle");
 const doneCheck=makeNode("input");doneCheck.type="checkbox";doneCheck.id="rdCalendarHideDone";
 doneCheck.addEventListener("change",()=>{calendarHideDone=doneCheck.checked;drawCalendar()});
 doneLabel.append(doneCheck,boxText("span","Скрыть выполненные"));
 const weekGrid=makeNode("div","rd-week-grid"),weekStrip=makeNode("div","rd-week-strip"),dayDetail=makeNode("div","rd-selected-day");
 weekStrip.setAttribute("role","group");weekStrip.setAttribute("aria-label","Выберите день недели");
 dayDetail.setAttribute("aria-live","polite");
 board.append(boardHeading,weekGrid,weekStrip,makeNode("div","rd-calendar-divider"),dayDetail);
 boardHeading.append(doneLabel);
 const ordersTitle=sectionView("rdOrdersIntro","Заказы","Все заявки, статусы, поиск и быстрые действия");
 const ordersQuick=makeNode("button","rd-orders-quick-slots","Свободные окна");
 ordersQuick.type="button";
 ordersQuick.addEventListener("click",()=>window.__rdQuickSlots?.open());
 ordersTitle.append(ordersQuick);
 const titleBar=makeNode("div","rd-orders-titlebar");
 const synced=makeNode("span","rd-orders-synced",$("syncStatus")?.textContent||"");
 synced.id="rdOrdersSynced";synced.setAttribute("role","status");
 titleBar.append(ordersTitle.querySelector(".rd-view-title"),synced);
 ordersTitle.insertBefore(titleBar,ordersTitle.querySelector(".rd-view-subtitle"));
 const orderStats=makeNode("div","");orderStats.id="rdOrderStats";
 const filterToggle=makeNode("button","rd-orders-filter-toggle","Фильтры");
 filterToggle.id="rdOrdersFilterToggle";filterToggle.type="button";
 filterToggle.setAttribute("aria-controls","rdOrderToolbar");
 filterToggle.setAttribute("aria-expanded","false");
 filterToggle.addEventListener("click",()=>{
  orderFiltersOpen=!orderFiltersOpen;
  $("rdOrderToolbar").classList.toggle("is-open",orderFiltersOpen);
  syncOrderFiltersButton();
 });
 const orderTools=makeNode("div","rd-toolbar");orderTools.id="rdOrderToolbar";
 const orderDate=makeNode("input");orderDate.type="date";orderDate.id="rdOrderDate";orderDate.setAttribute("aria-label","Фильтр по дате");orderDate.addEventListener("change",()=>{
  if(activePage==="orders"&&currentTab==="calendar"){
    clearQuickFilter();
    if(orderDate.value){selectedDate=orderDate.value;render()}
    return;
  }
  if(currentTab==="history")orderHistoryDateFilter=orderDate.value;
  else orderListDateFilter=orderDate.value;
  clearQuickFilter();filterCards();
});
 const dateWrap=makeNode("label","rd-date-filter");dateWrap.append(boxText("span","Дата"),orderDate);
 const masterSelect=makeNode("select");masterSelect.id="rdMasterFilter";masterSelect.setAttribute("aria-label","Фильтр по мастеру");masterSelect.addEventListener("change",()=>{clearQuickFilter();filterCards()});
 const statusSelect=makeNode("select");statusSelect.id="rdStatusFilter";statusSelect.setAttribute("aria-label","Фильтр по статусу");
 [["","Все статусы"],["Новый","Новый"],["Записан","Записан"],["В работе","В работе"],["Выполнен","Выполнен"],["Отменён","Отменён"],["unpaid","Ожидают оплаты"]].forEach(([value,label])=>{const opt=makeNode("option","",label);opt.value=value;statusSelect.append(opt)});
 statusSelect.addEventListener("change",()=>{clearQuickFilter();filterCards()});
 const clear=makeNode("button","secondary","Сбросить");clear.addEventListener("click",()=>{
  if(currentTab==="history")orderHistoryDateFilter="";
  else if(currentTab==="all")orderListDateFilter="";
  orderDate.value=currentTab==="calendar"?selectedDate:"";
  statusSelect.value="";masterSelect.value="";rdSearchTerm="";$("rdTopSearch").value="";
  orderTabFilters[currentTab]={master:"",status:"",search:""};
  clearQuickFilter();render();
 });
 orderTools.append(dateWrap,masterSelect,statusSelect,clear);
 const financeTitle=sectionView("rdFinanceIntro","Финансы","Начисления, касса и история операций");
 app.insertBefore(home,$("ordersArea"));
 app.insertBefore(clients,$("ordersArea"));
 app.insertBefore(leads,$("ordersArea"));
 $("ordersArea").prepend(ordersTitle,orderStats,orderTools,calendar,calendarNav,board);
 const listHead=$("ordersArea").querySelector(".list-head");
 const listActions=makeNode("div","rd-orders-list-actions");
 listActions.append($("orderCount"),filterToggle);
 listHead.append(listActions);
 $("financePanel").prepend(financeTitle);
 // Staff access administration is still available, but should not obscure the booking list.
 $("ordersArea").append($("teamPanel"));
 // Original order editor, calendar state, and financial forms are retained.
 $("ordersArea").insertBefore($("newOrderBtn"),$("ordersArea").querySelector(".tabs"));
 builtRole=currentRole;ready=true;
 const requested=new URLSearchParams(window.location.search).get("view");
 const initial=crmReturnPages.has(requested)&&(requested!=="finance"||currentRole==="owner")?requested:"home";
 navigate(initial);
}
function navigate(key){
 closeMobileMore();
 if(key==="ai"){openAiChat();return}
 if(!ready)return;
 if(key==="finance"&&currentRole!=="owner")return;
 if(activePage==="orders"&&key!=="orders")storeOrderFilters(currentTab);
 const globalSearch=$("rdTopSearch");
 if(globalSearch){
  globalSearch.placeholder=key==="leads"?"Поиск лидов по имени и телефону...":"Поиск заказов, клиентов, адресов...";
  if(activePage==="leads"&&key!=="leads"){globalSearch.value="";rdSearchTerm="";}
 }
 // Keep the visible screen, active navigation and legacy tab state in sync.
 // Update visibility before legacy rendering: a render error must not leave
 // the previous screen selected with the next screen's internal tab state.
 activePage=key;window.__rdCurrentPage=key;
 if(key==="finance")$("viewFinanceBtn").click();
 else if(financeActive)$("viewOrdersBtn").click();
 const isOrders=key==="orders",isCalendar=key==="calendar";
 // Initial calendar date must be Moscow today, not the date left in the Orders tab.
 // Revisiting calendar later keeps an explicitly selected date.
 if(isCalendar&&!calendarOpened){selectedDate=todayMoscow();calendarOpened=true;}
 $("ordersArea").hidden=!(isOrders||isCalendar);
 $("financePanel").hidden=key!=="finance";
 $("rdHome").hidden=key!=="home";
 $("rdClients").hidden=key!=="clients";
 $("rdLeads").hidden=key!=="leads";
 $("rdOrdersIntro").hidden=!isOrders;
 $("rdOrderStats").hidden=!isOrders;
 $("rdOrderToolbar").hidden=!isOrders;
 $("rdCalendarIntro").hidden=!isCalendar;
 $("rdCalendarBoard").hidden=!isCalendar;
 $("rdCalendarNavigation").hidden=!isCalendar;
 $("calendarPanel").hidden=true;
 $("ordersArea").querySelector(".tabs").hidden=!isOrders;
 $("ordersArea").querySelector(".list-head").hidden=!isOrders;
 $("orders").hidden=!isOrders;
 $("newOrderBtn").hidden=!isOrders || !(currentRole==="owner"||currentRole==="manager");
 $("teamPanel").hidden=key!=="orders"||currentRole!=="owner";
 $("rdFinanceIntro").hidden=key!=="finance";
 app.className=app.className.replace(/\brd-view-\S+/g,"").trim()+" rd-view-"+key;
 document.querySelectorAll(".rd-nav-btn[data-page]").forEach(btn=>
  btn.setAttribute("aria-current",btn.dataset.page===key?"page":"false"));
 const moreButton=$("rdMobileMoreBtn");
 if(moreButton)moreButton.setAttribute("aria-current",["clients","finance"].includes(key)?"page":"false");
 if(isOrders||isCalendar){
  currentTab=isCalendar?"calendar":"all";
  if(isOrders)restoreOrderFilters(currentTab);
  render(); // Legacy render triggers __rdRefresh, which rebuilds the selected view.
 }else if(key==="home")drawHome();
 else if(key==="clients")drawClients();
 else if(key==="leads")window.__rdLeadsRender?.();
 window.scrollTo({top:0,behavior:"instant"});
}
function drawChart(parent,values,month){
 // Draw the real month's orders. SVG is self-contained; no chart dependency,
 // network requests, hard-coded counts, or writes to customer/finance data.
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
 svg.setAttribute("viewBox","0 0 640 240");
 svg.setAttribute("role","img");
 svg.setAttribute("aria-label","Динамика заказов: количество заявок по дням выбранного месяца");
 svg.classList.add("rd-chart","rd-chart-v2");
 const mk=(tag,attrs={})=>{
  const node=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
 };
 const data=values.map(n=>n===null?null:Math.max(0,Number(n)||0));
 const left=45,right=620,top=24,bottom=195;
 const step=Math.max(1,Math.ceil(Math.max(0,...data.filter(value=>value!==null))/4));
 const ceiling=step*4;
 const dx=(right-left)/Math.max(1,data.length-1);
 const points=data.flatMap((value,i)=>value===null?[]:[{
  x:left+i*dx,y:bottom-value/ceiling*(bottom-top),value,day:i+1
 }]);
 const defs=mk("defs"),grad=mk("linearGradient",{id:"rdChartGradient",x1:"0",y1:"0",x2:"0",y2:"1"});
 grad.append(
  mk("stop",{offset:"0%","stop-color":"#5976ff","stop-opacity":".32"}),
  mk("stop",{offset:"55%","stop-color":"#7da8ff","stop-opacity":".15"}),
  mk("stop",{offset:"100%","stop-color":"#b5d7ff","stop-opacity":".015"})
 );
 defs.append(grad);svg.append(defs);
 for(let i=0;i<=4;i++){
  const y=bottom-(bottom-top)*i/4;
  svg.append(mk("line",{x1:left,x2:right,y1:y,y2:y,class:"rd-chart-grid"}));
  const label=mk("text",{x:left-12,y:y+4,"text-anchor":"end",class:"rd-chart-axis rd-chart-y"});
  label.textContent=String(step*i);svg.append(label);
 }
 const shownDays=new Set([0,data.length-1]);
 for(let i=0;i<data.length;i+=Math.max(1,Math.round(data.length/6)))shownDays.add(i);
 for(const i of [...shownDays].sort((a,b)=>a-b)){
  if(i<0||i>=data.length)continue;
  const x=left+i*dx;
  if(i>0&&i<data.length-1)svg.append(mk("line",{x1:x,x2:x,y1:top,y2:bottom,class:"rd-chart-grid rd-chart-vertical"}));
  const label=mk("text",{x,y:bottom+23,"text-anchor":"middle",class:"rd-chart-axis rd-chart-x"});
  label.textContent=String(i+1);svg.append(label);
 }
 // Monotone cubic interpolation: smooth transitions without inventing negative
 // orders or overshooting the actual maximum on a sharp daily spike.
 const slope=[];
 for(let i=0;i<points.length-1;i++)slope.push((points[i+1].y-points[i].y)/dx);
 const tangent=points.map((p,i)=>{
  if(i===0)return slope[0]||0;
  if(i===points.length-1)return slope[i-1]||0;
  const a=slope[i-1],b=slope[i];
  return a*b<=0?0:2*a*b/(a+b);
 });
 let curve=points.length?"M "+points[0].x.toFixed(2)+" "+points[0].y.toFixed(2):"";
 for(let i=0;i<points.length-1;i++){
  const p=points[i],q=points[i+1],d=(q.x-p.x)/3;
  curve+=" C "+(p.x+d).toFixed(2)+" "+(p.y+tangent[i]*d).toFixed(2)+
   " "+(q.x-d).toFixed(2)+" "+(q.y-tangent[i+1]*d).toFixed(2)+
   " "+q.x.toFixed(2)+" "+q.y.toFixed(2);
 }
 if(points.length){
  svg.append(mk("path",{d:curve+" L "+points[points.length-1].x+" "+bottom+" L "+left+" "+bottom+" Z",class:"rd-chart-area"}));
  svg.append(mk("path",{d:curve,class:"rd-chart-line"}));
  if(points.length<data.length){
   const cutX=Math.min(right,points[points.length-1].x+dx/2);
   svg.append(mk("line",{x1:cutX,x2:cutX,y1:top,y2:bottom,class:"rd-chart-future-separator"}));
   const label=mk("text",{x:Math.min(right-4,cutX+8),y:top+12,class:"rd-chart-future-label","text-anchor":"start"});
   label.textContent="Будущие дни";svg.append(label);
  }
 }
 const hoverLine=mk("line",{x1:left,x2:left,y1:top,y2:bottom,class:"rd-chart-hover-line"});
 const hoverDot=mk("circle",{cx:left,cy:bottom,r:6,class:"rd-chart-hover-dot"});
 const tooltip=mk("g",{class:"rd-chart-tooltip"});
 const tipRect=mk("rect",{width:118,height:49,rx:11,ry:11,class:"rd-chart-tooltip-bg"});
 const tipDay=mk("text",{x:12,y:19,class:"rd-chart-tooltip-day"});
 const tipCount=mk("text",{x:12,y:37,class:"rd-chart-tooltip-count"});
 tooltip.append(tipRect,tipDay,tipCount);
 svg.append(hoverLine,hoverDot,tooltip);
 const showDay=index=>{
  const p=points[index];if(!p)return;
  hoverLine.setAttribute("x1",p.x);hoverLine.setAttribute("x2",p.x);
  hoverDot.setAttribute("cx",p.x);hoverDot.setAttribute("cy",p.y);
  const count=p.value;
  tipDay.textContent=p.day+" "+parseDate(month+"-01").toLocaleDateString("ru-RU",{month:"short"});
  tipCount.textContent=count+" "+(count%10===1&&count%100!==11?"заказ":count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?"заказа":"заказов");
  const bx=Math.max(left,Math.min(right-118,p.x-59));
  const by=p.y<top+67?p.y+13:p.y-61;
  tooltip.setAttribute("transform","translate("+bx.toFixed(1)+" "+by.toFixed(1)+")");
 };
 // Do not leave a tooltip floating over the chart on first render.
 // It becomes visible only when the user hovers, taps or focuses a point.
 const hideChartTip=()=>{
  hoverLine.style.display="none";hoverDot.style.display="none";tooltip.style.display="none";
 };
 hideChartTip();
 svg.addEventListener("mouseleave",hideChartTip);
 svg.addEventListener("focusout",event=>{
  if(!event.relatedTarget||!svg.contains(event.relatedTarget))hideChartTip();
 });
 // Show exact daily counts on hover, focus or tap. No data is sent or saved.
 for(let i=0;i<points.length;i++){
  const p=points[i];
  if(p.value>0 || i===0 || i===points.length-1)
   svg.append(mk("circle",{cx:p.x,cy:p.y,r:p.value?3.1:2.1,class:"rd-chart-point"}));
  const hit=mk("rect",{
   x:p.x-dx/2,y:top,width:Math.max(10,dx),height:bottom-top+7,
   fill:"transparent",class:"rd-chart-hit",
   "aria-label":p.day+" число — "+p.value+" заказов"
  });
  if(p.value>0)hit.setAttribute("tabindex","0");
  const activate=()=>{
   hoverLine.style.display="";hoverDot.style.display="";tooltip.style.display="";
   showDay(i);
  };
  hit.addEventListener("mouseenter",activate);
  hit.addEventListener("focus",activate);
  hit.addEventListener("click",activate);
  svg.append(hit);
 }
 parent.append(svg);
}
function openDashboardOrders({filter="",orderId=null,date=""}={}){
 if(!ready)return;
 navigate("orders");
 // Clear stale manual filters before selecting a dashboard shortcut.
 const dateInput=$("rdOrderDate"),master=$("rdMasterFilter"),status=$("rdStatusFilter"),search=$("rdTopSearch");
 orderListDateFilter="";rdSearchTerm="";summaryFilter="";
 if(dateInput)dateInput.value="";
 if(master)master.value="";
 if(status)status.value="";
 if(search)search.value="";
 orderTabFilters.all={master:"",status:"",search:""};
 if(filter)applySummaryFilter(filter);
 else{
  if(date){
   orderListDateFilter=date;
   if(dateInput)dateInput.value=date;
  }
  render();
  $("ordersArea")?.querySelector(".list-head")?.scrollIntoView({block:"start",behavior:"smooth"});
 }
 if(orderId){
  const opened=window.__rdOpenOrderDetail?.(String(orderId));
  if(!opened)console.warn("Не удалось открыть карточку заказа из главной панели");
 }
}
function dashboardMetric(label,value,filter){
 const button=makeNode("button","rd-home-metric");
 button.type="button";
 button.setAttribute("aria-label",label+": "+value+". Показать заказы");
 button.append(boxText("strong",String(value)),boxText("span",label));
 button.addEventListener("click",()=>openDashboardOrders(filter));
 return button;
}
function dashboardAction(icon,label,action){
 const btn=makeNode("button","rd-home-action");
 btn.type="button";
 btn.append(uiIcon(icon),boxText("span",label));
 btn.addEventListener("click",action);
 return btn;
}
function homeSlotPicker(){
 const section=makeNode("section","rd-home-slot-picker");
 const header=makeNode("div","rd-home-slot-heading");
 const heading=makeNode("div");
 heading.append(boxText("h2","Свободные окна"),boxText("p","Ближайшее время для записи клиента"));
 const all=makeNode("button","rd-home-slots-all","Все окна ›");
 all.type="button";all.addEventListener("click",()=>window.__rdQuickSlots?.open());
 header.append(heading,all);section.append(header);
 const data=window.__rdQuickSlotsSnapshot?.()||{masters:[]};
 const masters=Array.isArray(data.masters)?data.masters:[];
 const primary=masters.find(name=>smText(name).toLocaleLowerCase("ru")==="рауль")||masters[0];
 const api=window.__rdOrderAvailability,core=window.__rdQuickSlots?.core;
 const spots=primary&&core&&api?core.candidateSlots({
   masters:[primary],now:new Date(),horizon:14,limit:3,
   checkTime:(time,date,master)=>api.checkTime(time,date,master)
 }):[];
 const note=makeNode("p","rd-home-slots-note",
   primary?"Мастер: "+primary+" · время предварительное":"Уточните исполнителя, чтобы подобрать время");
 section.append(note);
 if(spots.length){
   const grid=makeNode("div","rd-home-slot-grid");
   for(const spot of spots){
     const button=makeNode("button","rd-home-slot-choice");
     button.type="button";
     button.setAttribute("aria-label",dateLong(spot.date)+" "+spot.time+", мастер "+spot.master+". Открыть запись");
     button.append(boxText("strong",spot.time),boxText("span",dateLong(spot.date)+(spot.tight?" · плотно":"")));
     button.addEventListener("click",async()=>{
       button.disabled=true;note.textContent="Проверяем время в CRM…";
       try{
         const applied=await window.__rdQuickSlots?.book(spot);
         if(!applied)note.textContent="Расписание изменилось. Выберите актуальное время.";
       }catch(error){note.textContent="Не удалось проверить время: "+(error?.message||"ошибка сети");}
       finally{button.disabled=false;}
     });
     grid.append(button);
   }
   section.append(grid);
 }else{
   section.append(makeNode("p","rd-home-slots-empty",
     primary?"Подходящих типовых окон не найдено. Откройте календарь для уточнения.":"Список мастеров пока недоступен."));
 }
 section.append(boxText("small","По текущим заказам · перед записью перепроверим","rd-home-slots-disclaimer"));
 return section;
}
function drawHome(){
 if(!ready||activePage!=="home")return;
 const root=$("rdHome");
 while(root.children.length>3)root.lastElementChild.remove();
 const orders=activeOrders(),today=todayMoscow(),month=today.slice(0,7);
 if(currentRole==="owner"||currentRole==="manager")root.append(homeSlotPicker());
 const thisMonth=orders.filter(o=>o.date?.startsWith(month));
 const customers=new Set(thisMonth.map(o=>normalizePhone(o.phone)||String(o.name||"").toLocaleLowerCase("ru")).filter(Boolean));
 const completed=thisMonth.filter(o=>o.status==="Выполнен");
 // Monetary figure represents recorded paid job prices by appointment date, not bank or cash receipts.
 const paid=thisMonth.filter(o=>o.paid&&o.price!=null&&Number.isFinite(Number(o.price)));
 const inProgress=orders.filter(o=>o.status==="В работе");
 const unpaid=orders.filter(o=>o.status==="Выполнен"&&!o.paid);
 const noMaster=orders.filter(o=>!smText(o.master)&&o.status!=="Выполнен");
 const todayCount=orders.filter(o=>o.date===today).length;
 const metrics=makeNode("div","rd-home-metrics");
 metrics.append(
  dashboardMetric("Сегодня",todayCount,{date:today}),
  dashboardMetric("В работе",inProgress.length,{filter:"progress"}),
  dashboardMetric("Долги",unpaid.length,{filter:"unpaid"})
 );
 root.append(metrics);
 const paidTotal=paid.reduce((sum,o)=>sum+Number(o.price),0);
 const paidSummary=makeNode("div","rd-home-paid-summary");
 paidSummary.append(
  boxText("span","Стоимость оплаченных заказов за месяц","rd-home-paid-label"),
  boxText("strong",cash(paidTotal),"rd-home-paid-total"),
  boxText("small","По дате визита · не остаток кассы и не прибыль","rd-home-paid-hint")
 );
 let attention=null;
 if(unpaid.length||noMaster.length){
  attention=panel("Требуют внимания");
  attention.classList.add("rd-home-attention","rd-home-primary-panel");
  if(unpaid.length)rowEntry(attention,"Завершены без оплаты","Нужно получить или проверить оплату",String(unpaid.length),
   ()=>openDashboardOrders({filter:"unpaid"}));
  if(noMaster.length){
   const first=[...noMaster].sort((a,b)=>
    String(a.date||"9999-12-31").localeCompare(String(b.date||"9999-12-31"))||
    String(a.time||"").localeCompare(String(b.time||"")))[0];
   const when=(first.date?dateLong(first.date):"Без даты")+
    (first.time?" · "+first.time:"")+
    (first.name?" · "+first.name:"");
   rowEntry(attention,"Не назначен мастер",when,
    "Назначить"+(noMaster.length>1?" · "+noMaster.length:""),()=>{
     navigate("orders");
     if(!window.__rdOpenAssignOrder?.(first.id))openDashboardOrders({filter:"unassigned"});
    });
  }
 }else{
  attention=makeNode("div","rd-home-all-clear");
  attention.append(uiIcon("check"),boxText("span","Нет срочных задач по оплате и назначению мастеров"));
 }
 const nowMoscow=new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Europe/Moscow"});
 const future=orders.filter(o=>o.status!=="Выполнен"&&o.date&&
   (o.date>today||(o.date===today&&(o.time||"23:59")>=nowMoscow)))
   .sort((a,b)=>String(a.date+" "+(a.time||"")).localeCompare(String(b.date+" "+(b.time||""))));
 const upcoming=panel("Ближайшая запись");
 upcoming.classList.add("rd-home-upcoming","rd-home-primary-panel");
 if(future.length){
  const next=future[0];
  const shortDate=dateLong(next.date)+(next.master?" · "+next.master:"");
  rowEntry(upcoming,next.name||"Клиент",shortDate,next.time||"—",
   ()=>openDashboardOrders({orderId:next.id}));
 }else upcoming.append(boxText("div","Ближайших записей нет","rd-empty"));
 root.append(upcoming);
 if(attention)root.append(attention);
 const actions=makeNode("div","rd-home-actions");
 if(currentRole==="owner"||currentRole==="manager")
  actions.append(dashboardAction("plus","Новый заказ",()=>{navigate("orders");$("newOrderBtn").click()}));
 actions.append(dashboardAction("calendar","Календарь",()=>navigate("calendar")));
 if(currentRole==="owner")actions.append(dashboardAction("ai","ИИ-чат",()=>openAiChat()));
 else actions.append(dashboardAction("orders","Заказы",()=>navigate("orders")));
 root.append(actions);
 root.append(paidSummary);
 const details=document.createElement("details");
 details.className="rd-home-analytics";
 details.open=homeAnalyticsOpen;
 const toggle=makeNode("summary","rd-home-analytics-toggle","Аналитика и история");
 details.append(toggle);
 details.addEventListener("toggle",()=>{homeAnalyticsOpen=details.open});
 const analytics=makeNode("div","rd-home-analytics-content");
 stats(analytics,[
  {label:"Клиенты за месяц",value:String(customers.size),hint:"Уникальные контакты"},
  {label:"Выполнено за месяц",value:String(completed.length),hint:"По дате визита"}
 ]);
 const chart=panel("Динамика заказов","Записи по дням месяца (МСК), будущие дни не учитываются");
 const badge=boxText("span",parseDate(month+"-01").toLocaleDateString("ru-RU",{month:"long",year:"numeric"}),"rd-chart-month");
 chart.querySelector(".rd-panel-heading").append(badge);
 const start=parseDate(month+"-01");
 const days=new Date(start.getFullYear(),start.getMonth()+1,0).getDate();
 const series=Array.from({length:days},(_,i)=>{
  const date=month+"-"+String(i+1).padStart(2,"0");
  return date>today?null:thisMonth.filter(o=>o.date===date).length;
 });
 drawChart(chart,series,month);
 analytics.append(chart);
 const latest=panel("Последние заказы");
 const recent=[...getOrders()].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,5);
 if(!recent.length)latest.append(boxText("div","Заказов пока нет","rd-empty"));
 recent.forEach(o=>rowEntry(latest,o.name||"Клиент",
  (o.date?dateLong(o.date):"Без даты")+(o.master?" · "+o.master:""),
  o.price==null?"—":cash(o.price),()=>openDashboardOrders({orderId:o.id})));
 analytics.append(latest);
 if(currentRole==="owner"){
  const assistant=panel("ИИ-помощник","Вопросы о заказах и расписании");
  for(const label of ["Найти свободное окно","Показать неоплаченные заказы","Сколько заказов за неделю?"]){
   const b=makeNode("button","rd-quick",label);b.type="button";
   b.addEventListener("click",()=>openAiChat(label));
   assistant.append(b);
  }
  analytics.append(assistant);
 }
 details.append(analytics);root.append(details);
}

function drawOrderSummary(){
 if(!ready)return;
 const el=$("rdOrderStats");el.replaceChildren();
 const active=getOrders().filter(o=>!["Отменён","Выполнен"].includes(o.status)),newOrders=active.filter(o=>o.status==="Новый");
 const inProgress=active.filter(o=>o.status==="В работе");
 // Payment is due only for completed, unpaid jobs; booked jobs are not debts.
 const unpaid=getOrders().filter(o=>o.status==="Выполнен"&&!o.paid);
 stats(el,[{label:"Активные",value:String(active.length),hint:"Не завершены",filter:"active"},
 {label:"В работе",value:String(inProgress.length),hint:"Сейчас выполняют",filter:"progress"},
 {label:"Ждём оплату",value:String(unpaid.length),hint:"Выполнены без оплаты",filter:"unpaid"}]);
 const select=$("rdMasterFilter"),previous=select.value;
 select.replaceChildren();const initial=makeNode("option","","Все мастера");initial.value="";select.append(initial);
 const masters=[...new Set(getOrders().map(o=>smText(o.master)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
 masters.forEach(master=>{const option=makeNode("option","",master);option.value=master;select.append(option)});
 select.value=masters.includes(previous)?previous:"";
 syncOrderFiltersButton();
}
function drawCalendar(){
 if(!ready||activePage!=="calendar")return;
 const calendarDate=$("rdCalendarDate");
 calendarDate.value=selectedDate;
 const boardRoot=$("rdCalendarBoard");
 const board=boardRoot.querySelector(".rd-week-grid");
 const weekStrip=boardRoot.querySelector(".rd-week-strip");
 const detail=boardRoot.querySelector(".rd-selected-day");
 const weekTitle=$("rdCalendarWeekTitle");
 const masterSelect=$("rdCalendarMaster");
 const doneLabel=boardRoot.querySelector(".rd-calendar-done-toggle");
 const allOrders=getOrders().filter(o=>o.date && o.status!=="Отменён");
 const masters=[...new Set(allOrders.map(o=>smText(o.master)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
 if(calendarMaster && !masters.includes(calendarMaster))calendarMaster="";
 const masterKey=masters.join("\u001f");
 if(calendarMastersCache!==masterKey||!masterSelect.options.length){
  masterSelect.replaceChildren();
  const all=makeNode("option","","Все мастера");all.value="";masterSelect.append(all);
  for(const name of masters){const opt=makeNode("option","",name);opt.value=name;masterSelect.append(opt)}
  calendarMastersCache=masterKey;
 }
 masterSelect.value=calendarMaster;
  $("rdCalendarStatus").value=calendarStatus;
 $("rdCalendarHideDone").checked=calendarHideDone;
 syncCalendarFilterUI();
 // Filters are visual only. Never edit real orders during a calendar redraw.
 const orders=allOrders.filter(o=>
  (!calendarMaster||smText(o.master)===calendarMaster)&&
  (!calendarStatus||o.status===calendarStatus)&&
  (!calendarHideDone||o.status!=="Выполнен")
 );
 const monday=addDays(selectedDate,-((parseDate(selectedDate).getDay()+6)%7));
 const sunday=addDays(monday,6);
 const weekLabel=parseDate(monday).toLocaleDateString("ru-RU",{day:"numeric",month:"short"})+" – "+
  parseDate(sunday).toLocaleDateString("ru-RU",{day:"numeric",month:"short",year:"numeric"});
 const firstDate=parseDate(monday),lastDate=parseDate(sunday);
 const sameMonth=firstDate.getFullYear()===lastDate.getFullYear()&&firstDate.getMonth()===lastDate.getMonth();
 const shortWeek=sameMonth?
  firstDate.getDate()+"–"+lastDate.getDate()+" "+lastDate.toLocaleDateString("ru-RU",{month:"short"}):
  firstDate.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})+"–"+
  lastDate.toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
 $("rdCalendarDateLabel").textContent=calendarMode==="day"?
  parseDate(selectedDate).toLocaleDateString("ru-RU",{day:"numeric",month:"short"}):shortWeek;
 weekTitle.textContent=(calendarMode==="day"?"День":calendarMode==="list"?"Список":"Неделя")+" · "+(calendarMode==="day"?dateLong(selectedDate):weekLabel);
 boardRoot.dataset.calendarMode=calendarMode;
 boardRoot.querySelectorAll(".rd-calendar-mode").forEach(button=>{
  const selected=button.dataset.mode===calendarMode;
  button.setAttribute("aria-pressed",String(selected));
  button.classList.toggle("is-active",selected);
 });
 const today=todayMoscow(),weekDays=[];
 // Reuse the seven-day navigation until week, filters or data really change.
 const weekKey=[monday,calendarMaster,calendarStatus,String(calendarHideDone),
  String(window.__rdOrdersRevision||0)].join("|");
 const rebuildWeek=weekKey!==calendarWeekCache||board.children.length!==7||weekStrip.children.length!==7;
 if(rebuildWeek){board.replaceChildren();weekStrip.replaceChildren();}
 const detailKey=[calendarMode,calendarMode==="day"?selectedDate:monday,weekKey].join("|");
 const rebuildDetail=detailKey!==calendarDetailCache||!detail.children.length;
 const byTime=(a,b)=>String(a.time||"").localeCompare(String(b.time||""));
 const statusClass=o=>o.status==="Выполнен"?"is-done":o.status==="В работе"?"is-progress":"is-booked";
 const statusName=o=>o.status||"Новый";
 const amount=o=>o.price!=null&&o.price!==""&&Number.isFinite(Number(o.price))?cash(o.price):null;
 const dayCount=n=>n+" "+(n%10===1&&n%100!==11?"запись":n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?"записи":"записей");
 const selectDay=date=>selectCalendarDate(date,true);
 for(let i=0;i<7;i++){
  const date=addDays(monday,i),items=orders.filter(o=>o.date===date).sort(byTime);
  weekDays.push({date,items});
  const dateObj=parseDate(date);
  if(!rebuildWeek){
   const day=board.children[i],chip=weekStrip.children[i];
   day?.classList.toggle("is-today",date===selectedDate);
   chip?.classList.toggle("is-selected",date===selectedDate);
   chip?.setAttribute("aria-pressed",String(date===selectedDate));
   continue;
  }
  const day=makeNode("section","rd-calendar-day"+(date===selectedDate?" is-today":""));
  const dayHeader=makeNode("button","rd-cal-dayhead");
  dayHeader.type="button";dayHeader.setAttribute("aria-label","Показать заявки на "+dateObj.toLocaleDateString("ru-RU"));
  dayHeader.append(boxText("strong",dateObj.toLocaleDateString("ru-RU",{weekday:"short",day:"numeric",month:"short"})));
  if(date===today)dayHeader.append(boxText("span","Сегодня","rd-cal-today-badge"));
  dayHeader.append(boxText("small",String(items.length),"rd-cal-count"));
  dayHeader.addEventListener("click",()=>selectDay(date));
  day.append(dayHeader);
  if(!items.length){
   const empty=makeNode("div","rd-cal-empty");empty.append(uiIcon("calendar"),boxText("span","Нет записей"));
   day.append(empty);
  }
  for(const o of items){
   const event=makeNode("button","rd-event "+statusClass(o));
   event.type="button";event.setAttribute("aria-label","Открыть заявку: "+(o.name||"Без имени")+" "+(o.time||""));
   const row=makeNode("span","rd-cal-event-top");
   row.append(boxText("strong",o.time||"—"),boxText("i","","rd-cal-event-dot"));
   event.append(row,boxText("b",o.name||"Без имени"),boxText("span",o.master||"Мастер не назначен"));
   const bottom=makeNode("span","rd-cal-event-bottom");
   bottom.append(boxText("em",statusName(o),"rd-cal-mini-state"));
   if(amount(o))bottom.append(boxText("small",amount(o)));
   event.append(bottom);
   event.addEventListener("click",()=>openForm(o.id));day.append(event);
  }
  board.append(day);
  const chip=makeNode("button","rd-day-chip"+(date===selectedDate?" is-selected":""));
  chip.type="button";chip.setAttribute("aria-pressed",String(date===selectedDate));
  chip.append(boxText("span",dateObj.toLocaleDateString("ru-RU",{weekday:"short"})),
   boxText("strong",String(dateObj.getDate())),boxText("small",String(items.length)));
  chip.addEventListener("click",()=>selectDay(date));weekStrip.append(chip);
 }
 calendarWeekCache=weekKey;
 if(!rebuildDetail)return;
 detail.replaceChildren();
 const detailHeading=makeNode("div","rd-selected-heading");
 const total=calendarMode==="day"?
  (weekDays.find(d=>d.date===selectedDate)?.items.length||0):
  weekDays.reduce((sum,d)=>sum+d.items.length,0);
 const title=calendarMode==="day"?
  parseDate(selectedDate).toLocaleDateString("ru-RU",{day:"numeric",month:"long",weekday:"long"}):
  "Записи за неделю";
 detailHeading.append(boxText("h3",title),boxText("span",dayCount(total),"rd-selected-count"));
 detail.append(detailHeading);
  function showOrder(o,withDate=false){
  // Native <details> keeps each card collapsed by default and keyboard accessible.
  const card=makeNode("details","rd-mobile-event rd-cal-collapsible "+statusClass(o));
  const orderKey=String(o.id);
  card.dataset.orderId=orderKey;
  card.open=calendarExpandedOrders.has(orderKey);
  card.addEventListener("toggle",()=>{
   if(card.open)calendarExpandedOrders.add(orderKey);
   else calendarExpandedOrders.delete(orderKey);
  });
  const summary=makeNode("summary","rd-cal-summary");
  const summaryContent=makeNode("div","rd-cal-summary-content");
  const heading=makeNode("div","rd-cal-summary-heading");
  heading.append(
   boxText("strong",o.time||"—","rd-cal-summary-time"),
   boxText("strong",o.name||"Без имени","rd-cal-summary-name"),
   boxText("span",statusName(o),"rd-calendar-badge "+statusClass(o))
  );
  const brief=withDate&&o.date?
   [parseDate(o.date).toLocaleDateString("ru-RU",{day:"numeric",month:"short"}),o.master||"Мастер не назначен"]:
   [o.master||"Мастер не назначен"];
  if(o.radiators!==""&&o.radiators!=null)brief.push(o.radiators+" радиаторов");
  if(o.floorLoops!==""&&o.floorLoops!=null)brief.push(o.floorLoops+" контур(ов)");
  const secondary=makeNode("div","rd-cal-summary-bottom");
  secondary.append(boxText("span",brief.join(" · "),"rd-cal-summary-brief"));
  if(amount(o))secondary.append(boxText("strong",amount(o),"rd-cal-summary-price"));
  summaryContent.append(heading,secondary);
  const chevron=makeNode("span","rd-cal-summary-chevron");
  chevron.setAttribute("aria-hidden","true");
  summary.append(summaryContent,chevron);
  const expanded=makeNode("div","rd-cal-expanded");
  if(smText(o.address))expanded.append(boxText("div",o.address,"rd-cal-expanded-address"));
  const specs=[];
  if(o.radiators!==""&&o.radiators!=null)specs.push("Радиаторы: "+o.radiators+" шт.");
  if(o.floorLoops!==""&&o.floorLoops!=null)specs.push("Тёплый пол: "+o.floorLoops+" контур(ов)");
  if(specs.length)expanded.append(boxText("div",specs.join(" · "),"rd-calendar-note"));
  if(smText(o.details))expanded.append(boxText("p",o.details,"rd-calendar-note"));
  const actions=makeNode("div","rd-calendar-actions");
  const phone=smText(o.phone),normalized=normalizePhone(phone);
  if(phone){
   const call=makeNode("a","rd-cal-action","Позвонить");
   call.href="tel:"+phone.replace(/[^+\d]/g,"");actions.append(call);
  }
  if(normalized){
   const whatsapp=makeNode("a","rd-cal-action rd-cal-whatsapp","WhatsApp");
   whatsapp.href="https://wa.me/"+normalized;whatsapp.target="_blank";whatsapp.rel="noopener noreferrer";
   actions.append(whatsapp);
  }
  if(currentRole==="owner"||currentRole==="manager"){
   const edit=makeNode("button","rd-cal-action rd-cal-edit","Изменить");
   edit.type="button";edit.addEventListener("click",()=>openForm(o.id));actions.append(edit);
  }
  if(actions.children.length)expanded.append(actions);
  if(!expanded.children.length)expanded.append(boxText("p","Дополнительных сведений нет.","rd-calendar-note"));
  card.append(summary,expanded);
  detail.append(card);
 }
 if(calendarMode==="week"){
  for(const d of weekDays){
   if(!d.items.length)continue;
   detail.append(boxText("h4",parseDate(d.date).toLocaleDateString("ru-RU",
    {weekday:"long",day:"numeric",month:"long"}),"rd-cal-list-day"));
   d.items.forEach(o=>showOrder(o));
  }
 }else if(calendarMode==="list"){
  for(const d of weekDays)d.items.forEach(o=>showOrder(o,true));
 }else{
  weekDays.find(d=>d.date===selectedDate)?.items.forEach(o=>showOrder(o));
 }
 if(!total)detail.append(boxText("p","На выбранный период записей нет.","rd-empty"));
 calendarDetailCache=detailKey;
}
function drawClients(){
 if(!ready||activePage!=="clients")return;
 const list=$("rdClientsList"),history=$("rdClientHistory"),toolbar=$("rdClientToolbar");
 list.replaceChildren();history.replaceChildren();
 const groups=new Map();
 for(const o of getOrders()){
  const clientName=smText(o.name).toLocaleLowerCase("ru");
  const phoneKey=normalizePhone(o.phone);
  // A phone can be shared by family members: do not merge different names by phone alone.
  const key=(phoneKey?"phone:"+phoneKey+"|":"")+"name:"+clientName;
  if(!groups.has(key))groups.set(key,{key,name:o.name,phone:o.phone,items:[],last:""});
  const item=groups.get(key);item.items.push(o);if((o.date||"")>item.last)item.last=o.date;
 }
 const selected=groups.get(selectedClientKey);
 if(selected){
  list.hidden=true;toolbar.hidden=true;history.hidden=false;
  const back=makeNode("button","secondary","‹ Все клиенты");back.type="button";
  back.addEventListener("click",()=>{selectedClientKey=null;drawClients()});history.append(back);
  history.append(boxText("h2",selected.name||"Без имени"),boxText("p",(selected.phone||"Телефон не указан")+" · "+selected.items.length+" заказ(ов)","rd-muted"));
  const entries=[...selected.items].sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||""))||
    String(b.time||"").localeCompare(String(a.time||"")));
  for(const o of entries){
   const card=makeNode("article","rd-history-row");
   card.append(boxText("strong",(o.date?dateLong(o.date):"Без даты")+(o.time?" · "+o.time:"")),
     boxText("span",(o.status||"Новый")+(o.master?" · "+o.master:"")),
     boxText("span",o.address||"Адрес не указан"),
     boxText("span",(o.price==null?"Стоимость не указана":cash(o.price))+" · "+(o.paid?"Оплачено":"Не оплачено")));
   if(currentRole==="owner"||currentRole==="manager"){
    const btn=makeNode("button","secondary","Открыть заявку");btn.type="button";btn.addEventListener("click",()=>openForm(o.id));card.append(btn);
   }
   history.append(card);
  }
  return;
 }
 history.hidden=true;toolbar.hidden=false;list.hidden=false;
 const local=$("rdClientSearch").value.toLocaleLowerCase("ru").trim(),global=rdSearchTerm;
 const values=[...groups.values()].filter(item=>{
  const haystack=(item.name+" "+item.phone).toLocaleLowerCase("ru");
  return haystack.includes(local)&&haystack.includes(global);
 }).sort((a,b)=>b.last.localeCompare(a.last)||a.name.localeCompare(b.name,"ru"));
 if(!values.length){list.append(boxText("div","Клиенты не найдены","rd-empty"));return}
 for(const g of values.slice(0,150)){
  const card=makeNode("article","rd-client");
  card.append(boxText("strong",g.name||"Без имени"),boxText("span",g.phone||"Телефон не указан"),
   boxText("span","Заказов: "+g.items.length+" · Последняя запись: "+(g.last?dateLong(g.last):"—")));
  const btn=makeNode("button","","Вся история клиента");btn.type="button";
  btn.addEventListener("click",()=>{selectedClientKey=g.key;drawClients()});card.append(btn);list.append(card);
 }
 if(values.length>150)list.append(boxText("div","Показаны первые 150 клиентов. Уточните поиск.","rd-note"));
}
function compactOrderCard(card){
 if(currentRole==="master"||!card)return;
 const top=card.querySelector(".card-top");
 const name=card.querySelector(".client");
 if(top&&name){
  const avatar=boxText("span",(name.textContent.trim()[0]||"К").toLocaleUpperCase("ru"),"rd-order-avatar");
  top.prepend(avatar);
 }
 const dateBadge=top?.querySelector(".date-pill");
 if(dateBadge)dateBadge.prepend(uiIcon("calendar"));
 const lines=[...card.querySelectorAll(":scope > .info")];
 const infoKind=text=>text.startsWith("Адрес:")?"pin":
  text.startsWith("Мастер:")?"clients":text.startsWith("Стоимость:")?"wallet":
  text.startsWith("Радиаторы:")?"radiator":text.startsWith("Тёплый пол:")?"heat":
  text.startsWith("Комментарий:")?"note":text.startsWith("Телефон:")?"phone":"note";
 for(const line of lines){
  const label=line.textContent.trim();
  line.classList.add("rd-info-row");
  line.prepend(uiIcon(infoKind(label)));
 }
 const actions=card.querySelector(":scope > .actions");if(!actions)return;
 for(const button of actions.querySelectorAll(".action")){
  const glyph=button.classList.contains("wa")?"message":
   button.classList.contains("edit")?"pencil":
   button.classList.contains("map-link")?"pin":"phone";
  button.prepend(uiIcon(glyph));
 }
 const expandable=lines.filter(el=>!/^(Адрес:|Мастер:|Стоимость:)/.test(el.textContent.trim()));
 if(!expandable.length)return;
 const extra=makeNode("div","rd-order-extra");extra.hidden=true;
 for(const el of expandable)extra.append(el);
 const toggle=makeNode("button","rd-order-expand","Показать детали заявки");
 toggle.type="button";toggle.setAttribute("aria-expanded","false");
 toggle.addEventListener("click",()=>{
  extra.hidden=!extra.hidden;toggle.setAttribute("aria-expanded",String(!extra.hidden));
  toggle.textContent=extra.hidden?"Показать детали заявки":"Скрыть детали";
 });
 card.insertBefore(toggle,actions);card.insertBefore(extra,actions);
}
window.__rdDecorateOrder=compactOrderCard;
function applySummaryFilter(key){
 if(activePage!=="orders"||!["active","progress","unpaid","unassigned"].includes(key))return;
 summaryFilter=summaryFilter===key?"":key;
 currentTab="all";orderListDateFilter="";
 const date=$("rdOrderDate"),master=$("rdMasterFilter"),status=$("rdStatusFilter"),search=$("rdTopSearch");
 if(date)date.value="";if(master)master.value="";if(status)status.value="";if(search)search.value="";
 rdSearchTerm="";orderTabFilters.all={master:"",status:"",search:""};
 render();
 $("ordersArea")?.querySelector(".list-head")?.scrollIntoView({block:"start",behavior:"smooth"});
}
function syncSummaryButtons(){
 document.querySelectorAll("#rdOrderStats .rd-stat-shortcut").forEach(button=>{
  const selected=button.dataset.filter===summaryFilter;
  button.classList.toggle("is-selected",selected);
  button.setAttribute("aria-pressed",String(selected));
 });
}
function filterCards(){
 if(!ready||activePage!=="orders")return;
 const date=currentTab==="calendar"?"":currentTab==="history"?orderHistoryDateFilter:orderListDateFilter,
  master=$("rdMasterFilter").value,status=$("rdStatusFilter").value;
 let visible=0,total=0;
 for(const card of $("orders").querySelectorAll(".order-card")){
  total++;
  const show=(!rdSearchTerm||String(card.dataset.search||"").includes(rdSearchTerm)) &&
    (!date||card.dataset.date===date)&&(!master||card.dataset.master===master)&&
    (!status||(status==="unpaid"?card.dataset.unpaid==="true":status==="unpaid_any"?card.dataset.unpaid==="true":card.dataset.status===status))&&
    (currentTab!=="all"||!summaryFilter||
      (summaryFilter==="active"?!["Выполнен","Отменён"].includes(card.dataset.status):
       summaryFilter==="progress"?card.dataset.status==="В работе":
       summaryFilter==="unassigned"?!["Отменён","Выполнен"].includes(card.dataset.status)&&!String(card.dataset.master||"").trim():
       card.dataset.unpaid==="true"));
  card.hidden=!show;if(show)visible++;
 }
 if(total)$("orderCount").textContent=visible+" из "+total;
 syncOrderFiltersButton();
 syncSummaryButtons();
 const oldEmpty=$("rdOrderFilterEmpty");if(oldEmpty)oldEmpty.remove();
 if(total&&visible===0&&["all","history"].includes(currentTab)){
  const empty=makeNode("div","rd-order-filter-empty");empty.id="rdOrderFilterEmpty";
  empty.setAttribute("role","status");
  empty.append(boxText("strong",currentTab==="history"?"Выполненные заказы не найдены":"Заказы не найдены"),
   boxText("p","По выбранным фильтрам совпадений нет. Заказы остаются в базе."));
  const reset=makeNode("button","secondary",currentTab==="history"?"Показать всю историю":"Показать все заказы");
  reset.type="button";
  reset.addEventListener("click",()=>{
   if(currentTab==="history")orderHistoryDateFilter="";
   else orderListDateFilter="";
   $("rdOrderDate").value="";$("rdMasterFilter").value="";$("rdStatusFilter").value="";
   rdSearchTerm="";$("rdTopSearch").value="";
   orderTabFilters[currentTab]={master:"",status:"",search:""};
   render();
  });
  empty.append(reset);$("orders").append(empty);
 }
}
window.__rdGoToLeads=()=>navigate("leads");
window.__rdAccess=()=>{
 if(ready&&builtRole!==currentRole){window.location.reload();return}
 if(currentRole==="master"){app.classList.add("rd-master");return}
 if(!["owner","manager"].includes(currentRole))return;
 build();
 window.__rdLeadsSyncNav?.();
};
window.__rdQuickSlotsRefresh=()=>{if(ready&&activePage==="home")drawHome();};
window.__rdRefresh=()=>{
 if(!ready)return;
 if(activePage==="home")drawHome();
 if(activePage==="calendar")drawCalendar();
 if(activePage==="clients")drawClients();
 if(activePage==="orders"){drawOrderSummary();filterCards();}
};
})();
