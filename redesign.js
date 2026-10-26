
/* Presentation-only upgrade. All auth, orders, finances and mutations stay in index.html. */
"use strict";
(()=>{
const app=document.getElementById("appScreen");
const body=document.body;
body.classList.add("rd");
const $=id=>document.getElementById(id);
const makeNode=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=String(text);return n};
const sections=["home","orders","calendar","clients","finance","ai"];
const titles={home:"Главная",orders:"Заказы",calendar:"Календарь",clients:"Клиенты",finance:"Финансы",ai:"ИИ-чат"};
/* Consistent, accessible outline icons: no third-party library and no remote assets. */
const iconPaths={
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
 orders:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h6M9 17h4"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/>',
 clients:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 finance:'<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-8h4v8M2 21h20"/>',
 ai:'<path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
 search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 alert:'<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.01"/>',
 wallet:'<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M4 9V6a3 3 0 0 1 3-3h11M16 13h6v5h-6a2.5 2.5 0 0 1 0-5Z"/>',
 chart:'<path d="M3 20V4M3 20h18M7 16l4-5 4 3 5-8"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 progress:'<circle cx="12" cy="12" r="3"/><path d="M19.5 12a7.5 7.5 0 0 0-.1-1.1l1.5-1.2-1.5-2.6-1.9.6a7.9 7.9 0 0 0-1.9-1.1L15.3 4h-3l-.4 2.6a7.9 7.9 0 0 0-1.9 1.1l-1.9-.6-1.5 2.6 1.5 1.2a7.5 7.5 0 0 0 0 2.2l-1.5 1.2 1.5 2.6 1.9-.6a7.9 7.9 0 0 0 1.9 1.1l.4 2.6h3l.4-2.6a7.9 7.9 0 0 0 1.9-1.1l1.9.6 1.5-2.6-1.5-1.2a7.5 7.5 0 0 0 .1-1.1Z"/>',
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
let activePage="home",ready=false,lastOrderKey="",rdSearchTerm="",selectedClientKey=null,builtRole=null,calendarMode="week",calendarMaster="",calendarStatus="",calendarHideDone=false;
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
   label==="Не оплачено"||label.includes("оплач")||label.includes("Оплач")?"wallet":
   label.includes("Выполнено")?"check":label.includes("Клиенты")?"clients":
   label.includes("сегодня")?"calendar":"orders";
  const card=makeNode("div","rd-stat rd-stat-"+kind);
  const icon=makeNode("span","rd-stat-icon");
  icon.setAttribute("aria-hidden","true");
  icon.append(uiIcon(kind));
  const body=makeNode("div","rd-stat-body");
  body.append(boxText("small",label),boxText("strong",item.value,"rd-accent"),boxText("span",item.hint,"rd-stat-hint"));
  card.append(icon,body);wrap.append(card);
 });
 node.append(wrap);
}
function navButton(key){const btn=makeNode("button","rd-nav-btn");btn.type="button";btn.dataset.page=key;
 const emblem=makeNode("span","rd-icon");emblem.append(uiIcon(key));
 btn.append(emblem,boxText("span",titles[key]));btn.addEventListener("click",()=>navigate(key));return btn}
function makeMobileMenu(){
 const veil=makeNode("button","rd-more-veil");veil.type="button";veil.hidden=true;veil.setAttribute("aria-label","Закрыть дополнительное меню");
 const sheet=makeNode("section","rd-more-sheet");sheet.hidden=true;sheet.id="rdMoreSheet";sheet.setAttribute("aria-label","Дополнительные разделы");
 sheet.append(boxText("h2","Другие разделы"));
 const items=currentRole==="owner"?["clients","finance"]:["clients"];
 for(const key of items){const btn=navButton(key);btn.classList.add("rd-more-item");sheet.append(btn)}
 const exit=makeNode("button","rd-nav-btn rd-more-item");exit.type="button";exit.append(boxText("span","⇥","rd-icon"),boxText("span","Выйти"));exit.addEventListener("click",()=>{$("logoutBtn").click()});sheet.append(exit);
 function close(){sheet.hidden=true;veil.hidden=true;document.body.classList.remove("rd-menu-open");toggle?.setAttribute("aria-expanded","false")}
 let toggle=null;
 function open(){const expanded=!sheet.hidden;if(expanded){close();return}veil.hidden=false;sheet.hidden=false;document.body.classList.add("rd-menu-open");toggle?.setAttribute("aria-expanded","true")}
 veil.addEventListener("click",close);
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!sheet.hidden)close()});
 // Menu item clicks navigate, then dismiss the overlay.
 sheet.querySelectorAll(".rd-more-item[data-page]").forEach(btn=>btn.addEventListener("click",close));
 toggle=makeNode("button","rd-nav-btn rd-more-trigger");toggle.type="button";toggle.dataset.page="more";toggle.setAttribute("aria-controls",sheet.id);toggle.setAttribute("aria-expanded","false");
 toggle.append(boxText("span","⋯","rd-icon"),boxText("span","Ещё"));toggle.addEventListener("click",open);
 return {veil,sheet,toggle,close};
}
function build(){
 if(ready)return;
 const side=makeNode("aside","rd-shell");side.setAttribute("aria-label","Главное меню");
 const brand=makeNode("div","rd-brand");brand.append(boxText("span","▰","rd-logo"));
 const brandText=makeNode("div");brandText.append(boxText("strong","Работа"),boxText("small","CRM · промывка отопления"));brand.append(brandText);side.append(brand);
 const nav=makeNode("nav","rd-nav");
 for(const key of sections){if(key==="ai"&&currentRole!=="owner")continue;if(key==="finance"&&currentRole!=="owner")continue;nav.append(navButton(key))}side.append(nav);
 const foot=makeNode("div","rd-sidefoot");foot.append(boxText("strong","Мой кабинет"),boxText("div","Система заказов и расписания."));
 const logout=makeNode("button","","Выйти из аккаунта");logout.type="button";logout.addEventListener("click",()=>$("logoutBtn").click());foot.append(logout);side.append(foot);
 const top=makeNode("div","rd-top");
 const search=makeNode("input","rd-top-search");search.id="rdTopSearch";search.type="search";search.placeholder="Поиск заказов, клиентов, адресов...";search.setAttribute("aria-label","Поиск по заказам, клиентам и адресам");
 search.addEventListener("input",()=>{
 rdSearchTerm=search.value.toLocaleLowerCase("ru").trim();
 if(activePage==="clients"){selectedClientKey=null;drawClients();return}
 if(rdSearchTerm&&activePage!=="orders")navigate("orders");
 filterCards();
});
 top.append(search,boxText("span","Данные из Supabase","rd-top-title"));
 const user=makeNode("div","rd-user");user.append(boxText("span",currentRole==="owner"?"В":"М","rd-user-dot"),boxText("strong",currentRole==="owner"?"Владелец":"Менеджер"));top.append(user);
 const mobile=makeNode("nav","rd-mobilebar");mobile.setAttribute("aria-label","Быстрое меню");
 const visible=currentRole==="owner"?["home","orders","calendar","ai"]:["home","orders","calendar","clients"];
 visible.forEach(key=>mobile.append(navButton(key)));
 const more=makeMobileMenu();mobile.append(more.toggle);
 app.prepend(top,side,more.veil,more.sheet,mobile);
 const home=sectionView("rdHome",currentRole==="owner"?"Панель владельца":"Панель менеджера","Обзор заказов и расписания в реальном времени");
 const clients=sectionView("rdClients","Клиенты","Клиенты из доступных вам заказов");
 const clientsToolbar=makeNode("div","rd-toolbar");
 const clientsInput=makeNode("input");clientsInput.id="rdClientSearch";clientsInput.type="search";clientsInput.placeholder="Найти клиента или телефон";clientsInput.setAttribute("aria-label","Поиск клиентов");
 clientsInput.addEventListener("input",()=>{selectedClientKey=null;drawClients()});
 clientsToolbar.id="rdClientToolbar";clientsToolbar.append(clientsInput);clients.append(clientsToolbar);
 clients.append(makeNode("div","rd-client-list"));clients.querySelector(".rd-client-list").id="rdClientsList";
 const clientHistory=makeNode("section","rd-panel rd-client-history");clientHistory.id="rdClientHistory";clientHistory.hidden=true;clients.append(clientHistory);
 const calendar=sectionView("rdCalendarIntro","Календарь","Записи по дням и занятость мастеров");
 calendar.classList.add("rd-calendar-intro");
 const calendarCreate=makeNode("button","rd-primary rd-cal-create");
 calendarCreate.type="button";calendarCreate.append(uiIcon("plus"),boxText("span","Новый заказ"));
 calendarCreate.addEventListener("click",()=> $("newOrderBtn").click());
 calendar.append(calendarCreate);
 const calendarNav=makeNode("div","rd-toolbar");calendarNav.id="rdCalendarNavigation";
 const previous=makeNode("button","secondary rd-cal-step","‹");
 previous.type="button";previous.title="Предыдущая неделя";previous.setAttribute("aria-label","Предыдущая неделя");
 previous.addEventListener("click",()=>$("prevWeek").click());
 const next=makeNode("button","secondary rd-cal-step","›");
 next.type="button";next.title="Следующая неделя";next.setAttribute("aria-label","Следующая неделя");
 next.addEventListener("click",()=>$("nextWeek").click());
 const todayBtn=makeNode("button","secondary rd-cal-today","Сегодня");
 todayBtn.type="button";todayBtn.addEventListener("click",()=>$("goToday").click());
 const calendarSelect=makeNode("input");calendarSelect.type="date";calendarSelect.id="rdCalendarDate";calendarSelect.setAttribute("aria-label","Выбрать дату в расписании");
 calendarSelect.addEventListener("change",()=>{if(!calendarSelect.value)return;selectedDate=calendarSelect.value;currentTab="calendar";render()});
 const calendarMasterSelect=makeNode("select");calendarMasterSelect.id="rdCalendarMaster";
 calendarMasterSelect.setAttribute("aria-label","Показать мастера");
 calendarMasterSelect.addEventListener("change",()=>{calendarMaster=calendarMasterSelect.value;drawCalendar()});
 const calendarStatusSelect=makeNode("select");calendarStatusSelect.id="rdCalendarStatus";
 calendarStatusSelect.setAttribute("aria-label","Фильтр календаря по статусу");
 [["","Все статусы"],["Новый","Новый"],["Записан","Записан"],["В работе","В работе"],["Выполнен","Выполнен"]].forEach(([value,label])=>{
  const o=makeNode("option","",label);o.value=value;calendarStatusSelect.append(o)
 });
 calendarStatusSelect.addEventListener("change",()=>{calendarStatus=calendarStatusSelect.value;drawCalendar()});
 calendarNav.append(previous,next,todayBtn,calendarSelect,calendarMasterSelect,calendarStatusSelect);
 const board=makeNode("section","rd-panel rd-view-area rd-calendar-panel");board.id="rdCalendarBoard";
 const boardHeading=makeNode("div","rd-calendar-heading");
 const weekHeading=boxText("h2","Расписание на неделю");weekHeading.id="rdCalendarWeekTitle";
 const modes=makeNode("div","rd-calendar-modes");modes.setAttribute("role","group");modes.setAttribute("aria-label","Режим просмотра календаря");
 [["week","Неделя"],["day","День"],["list","Список"]].forEach(([mode,label])=>{
  const btn=makeNode("button","rd-calendar-mode",label);btn.type="button";btn.dataset.mode=mode;
  btn.addEventListener("click",()=>{calendarMode=mode;drawCalendar()});modes.append(btn)
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
 const orderStats=makeNode("div","");orderStats.id="rdOrderStats";
 const orderTools=makeNode("div","rd-toolbar");orderTools.id="rdOrderToolbar";
 const orderDate=makeNode("input");orderDate.type="date";orderDate.id="rdOrderDate";orderDate.setAttribute("aria-label","Фильтр по дате");orderDate.addEventListener("change",filterCards);
 const dateWrap=makeNode("label","rd-date-filter");dateWrap.append(boxText("span","Дата"),orderDate);
 const masterSelect=makeNode("select");masterSelect.id="rdMasterFilter";masterSelect.setAttribute("aria-label","Фильтр по мастеру");masterSelect.addEventListener("change",filterCards);
 const statusSelect=makeNode("select");statusSelect.id="rdStatusFilter";statusSelect.setAttribute("aria-label","Фильтр по статусу");
 [["","Все статусы"],["Новый","Новый"],["Записан","Записан"],["В работе","В работе"],["Выполнен","Выполнен"],["unpaid","Выполнены без оплаты"]].forEach(([value,label])=>{const opt=makeNode("option","",label);opt.value=value;statusSelect.append(opt)});
 statusSelect.addEventListener("change",()=>{currentTab=["Выполнен","unpaid"].includes(statusSelect.value)?"history":"all";render();filterCards()});
 const clear=makeNode("button","secondary","Сбросить");clear.addEventListener("click",()=>{orderDate.value="";statusSelect.value="";masterSelect.value="";rdSearchTerm="";$("rdTopSearch").value="";currentTab="all";render();filterCards()});
 orderTools.append(dateWrap,masterSelect,statusSelect,clear);
 const financeTitle=sectionView("rdFinanceIntro","Финансы","Начисления, касса и история операций");
 app.insertBefore(home,$("ordersArea"));
 app.insertBefore(clients,$("ordersArea"));
 $("ordersArea").prepend(ordersTitle,orderStats,orderTools,calendar,calendarNav,board);
 $("financePanel").prepend(financeTitle);
 // Staff access administration is still available, but should not obscure the booking list.
 $("ordersArea").append($("teamPanel"));
 // Original order editor, calendar state, and financial forms are retained.
 $("ordersArea").insertBefore($("ordersArea").querySelector("#newOrderBtn"),$("ordersArea").querySelector("#teamPanel"));
 builtRole=currentRole;ready=true; navigate("home");drawHome();
}
function navigate(key){
 if(key==="ai"){window.location.assign("/ai.html");return}
 if(!ready)return;
 if(key==="finance"&&currentRole!=="owner")return;
 // Keep the visible screen, active navigation and legacy tab state in sync.
 // Update visibility before legacy rendering: a render error must not leave
 // the previous screen selected with the next screen's internal tab state.
 activePage=key;window.__rdCurrentPage=key;
 if(key==="finance")$("viewFinanceBtn").click();
 else if(financeActive)$("viewOrdersBtn").click();
 const isOrders=key==="orders",isCalendar=key==="calendar";
 $("ordersArea").hidden=!(isOrders||isCalendar);
 $("financePanel").hidden=key!=="finance";
 $("rdHome").hidden=key!=="home";
 $("rdClients").hidden=key!=="clients";
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
 const calendarAction=$("rdCalendarIntro").querySelector(".rd-cal-create");
 calendarAction.hidden=!isCalendar || !(currentRole==="owner"||currentRole==="manager");
 $("teamPanel").hidden=key!=="orders"||currentRole!=="owner";
 $("rdFinanceIntro").hidden=key!=="finance";
 app.className=app.className.replace(/\brd-view-\S+/g,"").trim()+" rd-view-"+key;
 document.querySelectorAll(".rd-nav-btn").forEach(btn=>
  btn.setAttribute("aria-current",
   (btn.dataset.page===key||(btn.dataset.page==="more"&&["clients","finance"].includes(key)))?"page":"false"));
 if(isOrders||isCalendar){
  currentTab=isCalendar?"calendar":"all";
  render(); // Legacy render triggers __rdRefresh, which rebuilds the selected view.
 }else if(key==="home")drawHome();
 else if(key==="clients")drawClients();
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
 const data=values.map(n=>Math.max(0,Number(n)||0));
 const left=45,right=620,top=24,bottom=195;
 const step=Math.max(1,Math.ceil(Math.max(0,...data)/4));
 const ceiling=step*4;
 const dx=(right-left)/Math.max(1,data.length-1);
 const points=data.map((value,i)=>({
  x:left+i*dx,y:bottom-value/ceiling*(bottom-top),value,day:i+1
 }));
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
  svg.append(mk("path",{d:curve+" L "+right+" "+bottom+" L "+left+" "+bottom+" Z",class:"rd-chart-area"}));
  svg.append(mk("path",{d:curve,class:"rd-chart-line"}));
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
 let peak=0;for(let i=1;i<points.length;i++)if(points[i].value>points[peak].value)peak=i;
 if(points.length&&points[peak].value>0)showDay(peak);
 else {hoverLine.style.display="none";hoverDot.style.display="none";tooltip.style.display="none";}
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
function drawHome(){
 if(!ready||activePage!=="home")return;
 const root=$("rdHome");while(root.children.length>3)root.lastElementChild.remove();
 const orders=activeOrders(),today=todayMoscow(),month=today.slice(0,7);
 const thisMonth=orders.filter(o=>o.date?.startsWith(month));
 const customers=new Set(thisMonth.map(o=>normalizePhone(o.phone)||o.name.toLocaleLowerCase("ru")));
 const complete=thisMonth.filter(o=>o.status==="Выполнен");
 const paid=thisMonth.filter(o=>o.paid&&o.price!=null&&Number.isFinite(o.price));
 stats(root,[
  {label:"Заказы сегодня",value:String(orders.filter(o=>o.date===today).length),hint:"Записи на текущую дату (МСК)"},
  {label:"Клиенты за месяц",value:String(customers.size),hint:"Уникальные номера / имена"},
  {label:"Стоимость оплаченных заказов",value:cash(paid.reduce((n,o)=>n+o.price,0)),hint:"По дате визита; не фактические поступления месяца"},
  {label:"Выполнено за месяц",value:String(complete.length),hint:"По статусу «Выполнен»"}
 ]);
 const middle=makeNode("div","rd-grid-main");
 const chart=panel("Динамика заказов","Количество записей по дням месяца (МСК)");
 const monthBadge=boxText("span",parseDate(month+"-01").toLocaleDateString("ru-RU",{month:"long",year:"numeric"}),"rd-chart-month");
 chart.querySelector(".rd-panel-heading").append(monthBadge);
 const monthStart=month+"-01",date0=parseDate(monthStart),days=new Date(date0.getFullYear(),date0.getMonth()+1,0).getDate();
 const series=Array.from({length:days},(_,i)=>thisMonth.filter(o=>o.date===month+"-"+String(i+1).padStart(2,"0")).length);
 drawChart(chart,series,month);
 if(currentRole==="owner"){
  const assistant=panel("✦ ИИ-помощник","Спрашивайте о заказах и расписании");
  for(const label of ["Найти свободное окно","Показать неоплаченные заказы","Сколько заказов за неделю?"]){
   const b=makeNode("button","rd-quick",label+"  ›");b.type="button";b.addEventListener("click",()=>window.location.assign("/ai.html?draft="+encodeURIComponent(label)));assistant.append(b);
  }
  const ai=makeNode("button","rd-primary","Открыть ИИ-чат");ai.style.width="100%";ai.style.marginTop="9px";ai.addEventListener("click",()=>window.location.assign("/ai.html"));assistant.append(ai);
  middle.append(chart,assistant);
 }else{
  const actions=panel("Быстрые действия","Работа с заявками и расписанием");
  const create=makeNode("button","rd-quick","Новая заявка  ›");create.type="button";
  create.addEventListener("click",()=>{navigate("orders");$("newOrderBtn").click()});
  const goCalendar=makeNode("button","rd-quick","Посмотреть календарь  ›");goCalendar.type="button";
  goCalendar.addEventListener("click",()=>navigate("calendar"));
  actions.append(create,goCalendar);middle.append(chart,actions);
 }
 root.append(middle);
 const two=makeNode("div","rd-grid-main rd-blockgap");
 const upcoming=panel("Ближайшие записи");upcoming.classList.add("rd-upcoming-panel");
 const nowMoscow=new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Europe/Moscow"});
 const future=orders.filter(o=>o.date&&(o.date>today||(o.date===today&&(o.time||"23:59")>=nowMoscow)))
   .sort((a,b)=>String(a.date+" "+a.time).localeCompare(String(b.date+" "+b.time))).slice(0,5);
 if(!future.length)upcoming.append(boxText("div","Ближайших записей нет","rd-empty"));
 future.forEach(o=>rowEntry(upcoming,o.name,o.master?dateLong(o.date)+" · "+o.master:dateLong(o.date),o.time||"—",()=>{navigate("orders");openForm(o.id)}));
 const notice=panel("Что требует внимания");notice.classList.add("rd-alert-panel");
 const unpaid=orders.filter(o=>o.status==="Выполнен"&&!o.paid),noMaster=orders.filter(o=>!smText(o.master)&&o.status!=="Выполнен");
 rowEntry(notice,"Неоплаченные выполненные заказы","По статусу и отметке оплаты",String(unpaid.length),()=>{
 navigate("orders");$("rdStatusFilter").value="unpaid";currentTab="history";render();filterCards();
});
 rowEntry(notice,"Заказы без мастера","Нужно назначить исполнителя",String(noMaster.length),()=>navigate("orders"));
 rowEntry(notice,"Свободные окна","Смотрите актуальный календарь","Открыть",()=>navigate("calendar"));
 two.append(upcoming,notice);root.append(two);
 const latest=panel("Последние заказы");const recent=[...getOrders()].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,5);
 if(!recent.length)latest.append(boxText("div","Заказов пока нет","rd-empty"));
 recent.forEach(o=>rowEntry(latest,o.name,(o.date?dateLong(o.date):"Без даты")+" · "+(o.master||"Без мастера"),o.price==null?"—":cash(o.price),()=>{navigate("orders");openForm(o.id)}));
 latest.classList.add("rd-blockgap");root.append(latest,boxText("div","Финансовая касса и распределение средств остаются в действующем разделе «Финансы».","rd-footer"));
}
function drawOrderSummary(){
 if(!ready)return;
 const el=$("rdOrderStats");el.replaceChildren();
 const active=getOrders().filter(o=>!["Отменён","Выполнен"].includes(o.status)),newOrders=active.filter(o=>o.status==="Новый");
 const inProgress=active.filter(o=>o.status==="В работе"),unpaid=getOrders().filter(o=>o.status==="Выполнен"&&!o.paid);
 stats(el,[{label:"Активные заказы",value:String(active.length),hint:"Не выполненные и не отменённые"},
 {label:"Новые",value:String(newOrders.length),hint:"Ожидают обработки"},
 {label:"В работе",value:String(inProgress.length),hint:"Текущий статус"},
 {label:"Не оплачено",value:String(unpaid.length),hint:"Завершены без отметки оплаты"}]);
 const select=$("rdMasterFilter"),previous=select.value;
 select.replaceChildren();const initial=makeNode("option","","Все мастера");initial.value="";select.append(initial);
 const masters=[...new Set(getOrders().map(o=>smText(o.master)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
 masters.forEach(master=>{const option=makeNode("option","",master);option.value=master;select.append(option)});
 select.value=masters.includes(previous)?previous:"";
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
 const previousMaster=calendarMaster;
 if(previousMaster && !masters.includes(previousMaster))calendarMaster="";
 masterSelect.replaceChildren();
 const all=makeNode("option","","Все мастера");all.value="";masterSelect.append(all);
 for(const name of masters){const opt=makeNode("option","",name);opt.value=name;masterSelect.append(opt)}
 masterSelect.value=calendarMaster;
 $("rdCalendarStatus").value=calendarStatus;
 $("rdCalendarHideDone").checked=calendarHideDone;
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
 weekTitle.textContent=(calendarMode==="day"?"День":"Неделя")+" · "+(calendarMode==="day"?dateLong(selectedDate):weekLabel);
 boardRoot.dataset.calendarMode=calendarMode;
 boardRoot.querySelectorAll(".rd-calendar-mode").forEach(button=>{
  const selected=button.dataset.mode===calendarMode;
  button.setAttribute("aria-pressed",String(selected));
  button.classList.toggle("is-active",selected);
 });
 board.replaceChildren();weekStrip.replaceChildren();detail.replaceChildren();
 const today=todayMoscow(),weekDays=[];
 const byTime=(a,b)=>String(a.time||"").localeCompare(String(b.time||""));
 const statusClass=o=>o.status==="Выполнен"?"is-done":o.status==="В работе"?"is-progress":"is-booked";
 const statusName=o=>o.status||"Новый";
 const amount=o=>o.price!=null&&o.price!==""&&Number.isFinite(Number(o.price))?cash(o.price):null;
 const dayCount=n=>n+" "+(n%10===1&&n%100!==11?"запись":n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?"записи":"записей");
 const selectDay=date=>{
  selectedDate=date;calendarMode="day";currentTab="calendar";render();
 };
 for(let i=0;i<7;i++){
  const date=addDays(monday,i),items=orders.filter(o=>o.date===date).sort(byTime);
  weekDays.push({date,items});
  const dateObj=parseDate(date);
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
 const detailHeading=makeNode("div","rd-selected-heading");
 const total=calendarMode==="list"?weekDays.reduce((sum,d)=>sum+d.items.length,0):
  orders.filter(o=>o.date===selectedDate).length;
 detailHeading.append(boxText("h3",calendarMode==="list"?"Записи за неделю":
  parseDate(selectedDate).toLocaleDateString("ru-RU",{day:"numeric",month:"long",weekday:"long"})),
  boxText("span",dayCount(total),"rd-selected-count"));
 detail.append(detailHeading);
 function showOrder(o){
  const card=makeNode("article","rd-mobile-event "+statusClass(o));
  const time=makeNode("div","rd-calendar-time");
  time.append(boxText("strong",o.time||"—"),boxText("small",o.date?dateLong(o.date):""));
  const content=makeNode("div","rd-calendar-entry");
  const first=makeNode("div","rd-cal-order-heading");
  first.append(boxText("strong",o.name||"Без имени"),boxText("span",statusName(o),"rd-calendar-badge "+statusClass(o)));
  content.append(first);
  const meta=makeNode("div","rd-cal-order-meta");
  meta.append(boxText("span","Мастер: "+(o.master||"не назначен")));
  if(smText(o.address))meta.append(boxText("span",o.address));
  if(amount(o))meta.append(boxText("span",amount(o),"rd-cal-price"));
  content.append(meta);
  const specs=[];
  if(o.radiators!==""&&o.radiators!=null)specs.push("Радиаторы: "+o.radiators+" шт.");
  if(o.floorLoops!==""&&o.floorLoops!=null)specs.push("Тёплый пол: "+o.floorLoops+" контур(ов)");
  if(specs.length)content.append(boxText("div",specs.join(" · "),"rd-calendar-note"));
  if(smText(o.details))content.append(boxText("p",o.details,"rd-calendar-note"));
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
  if(actions.children.length)content.append(actions);
  card.append(time,content);detail.append(card);
 }
 if(calendarMode==="list"){
  for(const d of weekDays){
   if(!d.items.length)continue;
   const title=boxText("h4",parseDate(d.date).toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"}),"rd-cal-list-day");
   detail.append(title);
   d.items.forEach(showOrder);
  }
 }else weekDays.find(d=>d.date===selectedDate)?.items.forEach(showOrder);
 if(!total)detail.append(boxText("p","На выбранный период записей нет.","rd-empty"));
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
function filterCards(){
 if(!ready||activePage!=="orders")return;
 const date=$("rdOrderDate").value,master=$("rdMasterFilter").value,status=$("rdStatusFilter").value;
 let visible=0,total=0;
 for(const card of $("orders").querySelectorAll(".order-card")){
  total++;
  const show=(!rdSearchTerm||String(card.dataset.search||"").includes(rdSearchTerm)) &&
    (!date||card.dataset.date===date)&&(!master||card.dataset.master===master)&&
    (!status||(status==="unpaid"?card.dataset.unpaid==="true":card.dataset.status===status));
  card.hidden=!show;if(show)visible++;
 }
 if(total)$("orderCount").textContent="Показано "+visible+" из "+total;
}
window.__rdAccess=()=>{
 if(ready&&builtRole!==currentRole){window.location.reload();return}
 if(currentRole==="master"){app.classList.add("rd-master");return}
 if(!["owner","manager"].includes(currentRole))return;
 build();
};
window.__rdRefresh=()=>{
 if(!ready)return;
 if(activePage==="home")drawHome();
 if(activePage==="calendar")drawCalendar();
 if(activePage==="clients")drawClients();
 if(activePage==="orders"){drawOrderSummary();filterCards();}
};
})();
