
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
 plus:'<path d="M12 4v16M4 12h16"/>'
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
let activePage="home",ready=false,lastOrderKey="",rdSearchTerm="",selectedClientKey=null,builtRole=null;
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
 items.forEach((item,i)=>{
  const kind=item.label.includes("Клиенты")?"clients":item.label.includes("оплач")||item.label.includes("Оплач")?"wallet":
   item.label.includes("Выполнено")?"check":item.label==="Новые"?"clock":item.label.includes("работе")?"orders":
   item.label.includes("сегодня")?"calendar":"orders";
  const n=makeNode("div","rd-stat rd-stat-"+kind);
  const heading=makeNode("div","rd-stat-heading");
  const emblem=makeNode("span","rd-stat-icon");emblem.append(uiIcon(kind));
  heading.append(emblem,boxText("small",item.label));
  n.append(heading,boxText("strong",item.value,"rd-accent"),boxText("span",item.hint));wrap.append(n);
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
 calendar.append(boxText("p","Показаны фактические заявки. Свободное время согласовывайте с мастером.","rd-muted"));
 const calendarNav=makeNode("div","rd-toolbar");calendarNav.id="rdCalendarNavigation";
 const previous=makeNode("button","secondary","‹ Предыдущая неделя");previous.type="button";previous.addEventListener("click",()=>$("prevWeek").click());
 const todayBtn=makeNode("button","secondary","Сегодня");todayBtn.type="button";todayBtn.addEventListener("click",()=>$("goToday").click());
 const next=makeNode("button","secondary","Следующая неделя ›");next.type="button";next.addEventListener("click",()=>$("nextWeek").click());
 const calendarSelect=makeNode("input");calendarSelect.type="date";calendarSelect.id="rdCalendarDate";calendarSelect.setAttribute("aria-label","Выбрать дату в расписании");
 calendarSelect.addEventListener("change",()=>{if(!calendarSelect.value)return;selectedDate=calendarSelect.value;currentTab="calendar";render()});
 calendarNav.append(previous,todayBtn,next,calendarSelect);
 const board=makeNode("section","rd-panel rd-view-area");board.id="rdCalendarBoard";
 const weekGrid=makeNode("div","rd-week-grid"),weekStrip=makeNode("div","rd-week-strip"),dayDetail=makeNode("div","rd-selected-day");
 weekStrip.setAttribute("role","group");weekStrip.setAttribute("aria-label","Выберите день недели");
 dayDetail.setAttribute("aria-live","polite");
 board.append(boxText("h2","Неделя · записи мастеров"),weekGrid,weekStrip,dayDetail);
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
 $("newOrderBtn").hidden=!(isOrders||isCalendar) || !(currentRole==="owner"||currentRole==="manager");
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
function drawChart(parent,values){
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 540 170");svg.setAttribute("role","img");svg.setAttribute("aria-label","График количества заказов по дням");svg.classList.add("rd-chart");
 let max=Math.max(1,...values),points=values.map((v,i)=>[8+i*524/Math.max(1,values.length-1),154-v*125/max]);
 const mk=(tag,attrs)=>{const n=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n};
 const defs=mk("defs",{}),grad=mk("linearGradient",{id:"rdChartGradient",x1:"0",y1:"0",x2:"0",y2:"1"});
 grad.append(mk("stop",{offset:"0%","stop-color":"#5e9af5","stop-opacity":".4"}),mk("stop",{offset:"100%","stop-color":"#5e9af5","stop-opacity":"0"}));defs.append(grad);svg.append(defs);
 for(let y of [29,70,112,154])svg.append(mk("line",{x1:8,x2:532,y1:y,y2:y,stroke:"#e7eaf3","stroke-width":"1","stroke-dasharray":"3 5"}));
 for(let i=0;i<6;i++){const label=mk("text",{x:8+i*524/5,y:169,"text-anchor":i===0?"start":i===5?"end":"middle",class:"rd-chart-axis"});label.textContent=String(Math.round(1+i*(values.length-1)/5));svg.append(label)}
 const path=points.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
 if(points.length){svg.append(mk("path",{d:path+" L "+points[points.length-1][0].toFixed(1)+",154 L "+points[0][0].toFixed(1)+",154 Z",class:"rd-chart-area"}));svg.append(mk("path",{d:path,class:"rd-chart-line"}))}
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
 drawChart(chart,series);
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
 $("rdCalendarDate").value=selectedDate;
 const board=$("rdCalendarBoard").querySelector(".rd-week-grid");board.replaceChildren();
 const weekStrip=$("rdCalendarBoard").querySelector(".rd-week-strip");weekStrip.replaceChildren();
 const dayDetail=$("rdCalendarBoard").querySelector(".rd-selected-day");dayDetail.replaceChildren();
 const monday=addDays(selectedDate,-((parseDate(selectedDate).getDay()+6)%7));
 const orders=getOrders().filter(o=>o.date && o.status!=="Отменён");
 for(let i=0;i<7;i++){
  const date=addDays(monday,i),day=makeNode("div","rd-calendar-day"+(date===selectedDate?" is-today":""));
  const dayHeader=makeNode("div","rd-cal-dayhead");
 dayHeader.append(boxText("h3",parseDate(date).toLocaleDateString("ru-RU",{weekday:"short",day:"numeric",month:"short"})));
 day.append(dayHeader);
  const items=orders.filter(o=>o.date===date).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  dayHeader.append(boxText("small",items.length?items.length+" зап.":"Нет записей","rd-cal-count"));
 if(!items.length){const empty=makeNode("div","rd-cal-empty");empty.append(uiIcon("calendar"),boxText("span","Свободный день"));day.append(empty)}
  for(const o of items){
   const event=makeNode("button","rd-event"+(o.status==="Выполнен"?" is-done":""));
   event.type="button";if(o.status==="В работе")event.classList.add("is-progress");
 event.append(boxText("small",o.time||"—"),boxText("strong",o.name||"Без имени"),boxText("span",o.master||"Без мастера"));
   event.addEventListener("click",()=>openForm(o.id));day.append(event);
  }
  board.append(day);
  const count=items.length;
  const chip=makeNode("button","rd-day-chip"+(date===selectedDate?" is-selected":""));
  chip.type="button";chip.setAttribute("aria-pressed",String(date===selectedDate));
  chip.append(boxText("span",parseDate(date).toLocaleDateString("ru-RU",{weekday:"short"})),
              boxText("strong",String(parseDate(date).getDate())),
              boxText("small",count?count+" зап.":"—"));
  chip.addEventListener("click",()=>{selectedDate=date;currentTab="calendar";render()});
  weekStrip.append(chip);
 }
 const selected=orders.filter(o=>o.date===selectedDate).sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
 const heading=makeNode("div","rd-selected-heading");
 heading.append(boxText("h3",parseDate(selectedDate).toLocaleDateString("ru-RU",{day:"numeric",month:"long",weekday:"long"})),
  boxText("span",selected.length+" "+(selected.length===1?"запись":selected.length>1&&selected.length<5?"записи":"записей"),"rd-selected-count"));
 dayDetail.append(heading);
 if(!selected.length)dayDetail.append(boxText("p","На этот день записей нет.","rd-empty"));
 for(const o of selected){
  const event=makeNode("button","rd-mobile-event");event.type="button";
  const left=makeNode("div","rd-calendar-time");left.append(boxText("strong",o.time||"—"));
  const content=makeNode("div","rd-calendar-entry");
  content.append(boxText("strong",o.name||"Без имени"),
    boxText("span",(o.master||"Мастер не назначен")+" · "+(o.address||"Адрес не указан"),"rd-calendar-meta"));
  if(smText(o.details))content.append(boxText("small",o.details,"rd-calendar-note"));
  const badge=boxText("span",o.status||"Новый","rd-calendar-badge");
  if(o.status==="Выполнен")badge.classList.add("is-done");
  else if(o.status==="В работе")badge.classList.add("is-progress");
  else badge.classList.add("is-booked");
  event.append(left,content,badge);
  event.setAttribute("aria-label","Открыть заявку: "+(o.name||"Без имени")+", "+(o.time||"время не указано"));
  event.addEventListener("click",()=>openForm(o.id));dayDetail.append(event);
 }
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
 const lines=[...card.querySelectorAll(":scope > .info")];
 const expandable=lines.filter(el=>!/^(Адрес:|Мастер:|Стоимость:)/.test(el.textContent.trim()));
 if(!expandable.length)return;
 const actions=card.querySelector(":scope > .actions");if(!actions)return;
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
