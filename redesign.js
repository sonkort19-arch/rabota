
/* Presentation-only upgrade. All auth, orders, finances and mutations stay in index.html. */
"use strict";
(()=>{
const app=document.getElementById("appScreen");
const body=document.body;
body.classList.add("rd");
const $=id=>document.getElementById(id);
const makeNode=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=String(text);return n};
const sections=["home","orders","calendar","clients","finance","ai"];
const titles={home:"Панель владельца",orders:"Заказы",calendar:"Календарь",clients:"Клиенты",finance:"Финансы",ai:"ИИ-чат"};
const icon={home:"⌂",orders:"▤",calendar:"▦",clients:"♙",finance:"▥",ai:"✦"};
let activePage="home",ready=false,lastOrderKey="",rdSearchTerm="";
function todayMoscow(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function dateLong(day){if(!day)return "Дата не указана";return parseDate(day).toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}
function cash(num){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(num)||0)+" ₽"}
function smText(t){return String(t||"").trim()}
function activeOrders(){return getOrders().filter(o=>o.status!=="Отменён")}
function boxText(tag,text,cls){return makeNode(tag,cls||"",text)}
function panel(title,intro){let n=makeNode("section","rd-panel"),h=boxText("h2",title);n.append(h);if(intro)n.append(boxText("div",intro,"rd-panel-intro"));return n}
function rowEntry(parent,label,desc,meta,action){const row=makeNode("div","rd-row");const left=makeNode("div","rd-row-main");left.append(boxText("strong",label),boxText("span",desc));row.append(left,boxText("span",meta,"rd-row-meta"));if(action){row.style.cursor="pointer";row.tabIndex=0;row.setAttribute("role","button");row.addEventListener("click",action);row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();action()}})}parent.append(row)}
function sectionView(id,title,subtitle){let n=makeNode("section","rd-view");n.id=id;n.append(boxText("h1",title,"rd-view-title"),boxText("p",subtitle,"rd-view-subtitle"));return n}
function stats(node,items){const wrap=makeNode("div","rd-stats");for(const item of items){const n=makeNode("div","rd-stat");n.append(boxText("small",item.label),boxText("strong",item.value,"rd-accent"),boxText("span",item.hint));wrap.append(n)}node.append(wrap)}
function navButton(key){const btn=makeNode("button","rd-nav-btn");btn.type="button";btn.dataset.page=key;btn.append(boxText("span",icon[key],"rd-icon"),boxText("span",titles[key]));btn.addEventListener("click",()=>navigate(key));return btn}
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
 const search=makeNode("input","rd-top-search");search.id="rdTopSearch";search.type="search";search.placeholder="Поиск по заказам, клиентам, адресам...";search.setAttribute("aria-label","Поиск по заказам");
 search.addEventListener("input",()=>{rdSearchTerm=search.value.toLocaleLowerCase("ru").trim();if(rdSearchTerm&&activePage!=="orders"&&activePage!=="clients")navigate("orders");filterCards()});
 top.append(search,boxText("span","Данные из Supabase","rd-top-title"));
 const user=makeNode("div","rd-user");user.append(boxText("span","●","rd-user-dot"),boxText("strong",currentRole==="owner"?"Владелец":"Менеджер"));top.append(user);
 const mobile=makeNode("nav","rd-mobilebar");mobile.setAttribute("aria-label","Быстрое меню");for(const key of sections){if(key==="ai"&&currentRole!=="owner")continue;if(key==="finance"&&currentRole!=="owner")continue;mobile.append(navButton(key))}
 app.prepend(top,side,mobile);
 const home=sectionView("rdHome","Панель владельца","Обзор заказов и расписания в реальном времени");
 const clients=sectionView("rdClients","Клиенты","Клиенты из доступных вам заказов");
 const clientsToolbar=makeNode("div","rd-toolbar");
 const clientsInput=makeNode("input");clientsInput.id="rdClientSearch";clientsInput.type="search";clientsInput.placeholder="Найти клиента или телефон";clientsInput.setAttribute("aria-label","Поиск клиентов");
 clientsInput.addEventListener("input",drawClients);
 clientsToolbar.append(clientsInput);clients.append(clientsToolbar);
 clients.append(makeNode("div","rd-client-list"));clients.querySelector(".rd-client-list").id="rdClientsList";
 const calendar=sectionView("rdCalendarIntro","Календарь","Записи по дням и занятость мастеров");
 calendar.append(boxText("p","Показаны фактические заявки. Свободное время согласовывайте с мастером.","rd-muted"));
 const board=makeNode("section","rd-panel rd-view-area");board.id="rdCalendarBoard";board.append(boxText("h2","Неделя · записи мастеров"),makeNode("div","rd-week-grid"));
 const ordersTitle=sectionView("rdOrdersIntro","Заказы","Все заявки, статусы, поиск и быстрые действия");
 const financeTitle=sectionView("rdFinanceIntro","Финансы","Начисления, касса и история операций");
 app.insertBefore(home,$("ordersArea"));
 app.insertBefore(clients,$("ordersArea"));
 $("ordersArea").prepend(ordersTitle,calendar,board);
 $("financePanel").prepend(financeTitle);
 // The original order editor, calendar week navigation, and finance forms are retained.
 $("ordersArea").insertBefore($("ordersArea").querySelector("#newOrderBtn"),$("ordersArea").querySelector("#teamPanel"));
 ready=true; navigate("home");drawHome();
}
function navigate(key){
 if(key==="ai"){window.location.assign("/ai.html");return}
 if(!ready)return;
 if(key==="finance"&&currentRole!=="owner")return;
 activePage=key;
 if(key==="finance"){$("viewFinanceBtn").click()}
 else if(financeActive){$("viewOrdersBtn").click()}
 if(key==="orders"){currentTab="all";render()}
 if(key==="calendar"){currentTab="calendar";render()}
 const isOrders=key==="orders",isCalendar=key==="calendar";
 $("ordersArea").hidden=!(isOrders||isCalendar);
 $("financePanel").hidden=key!=="finance";
 $("rdHome").hidden=key!=="home";
 $("rdClients").hidden=key!=="clients";
 $("rdOrdersIntro").hidden=!isOrders;
 $("rdCalendarIntro").hidden=!isCalendar;
 $("rdCalendarBoard").hidden=!isCalendar;
 $("calendarPanel").hidden=!isCalendar;
 $("ordersArea").querySelector(".tabs").hidden=!isOrders;
 $("ordersArea").querySelector(".list-head").hidden=!isOrders&&!isCalendar;
 $("orders").hidden=!isOrders&&!isCalendar;
 $("newOrderBtn").hidden=!(isOrders||isCalendar) || !(currentRole==="owner"||currentRole==="manager");
 $("teamPanel").hidden=key!=="orders"||currentRole!=="owner";
 $("rdFinanceIntro").hidden=key!=="finance";
 app.className=app.className.replace(/\brd-view-\S+/g,"").trim()+" rd-view-"+key;
 document.querySelectorAll(".rd-nav-btn").forEach(btn=>btn.setAttribute("aria-current",btn.dataset.page===key?"page":"false"));
 if(key==="home")drawHome();
 if(key==="clients")drawClients();
 if(key==="calendar")drawCalendar();
 if(key==="orders")filterCards();
 window.scrollTo({top:0,behavior:"instant"});
}
function drawChart(parent,values){
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 540 170");svg.setAttribute("role","img");svg.setAttribute("aria-label","График количества заказов по дням");svg.classList.add("rd-chart");
 let max=Math.max(1,...values),points=values.map((v,i)=>[8+i*524/Math.max(1,values.length-1),154-v*125/max]);
 const mk=(tag,attrs)=>{const n=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n};
 const defs=mk("defs",{}),grad=mk("linearGradient",{id:"rdChartGradient",x1:"0",y1:"0",x2:"0",y2:"1"});
 grad.append(mk("stop",{offset:"0%","stop-color":"#5e9af5","stop-opacity":".4"}),mk("stop",{offset:"100%","stop-color":"#5e9af5","stop-opacity":"0"}));defs.append(grad);svg.append(defs);
 for(let y of [29,70,112,154])svg.append(mk("line",{x1:0,x2:540,y1:y,y2:y,stroke:"#334155","stroke-width":".8"}));
 const path=points.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
 if(points.length){svg.append(mk("path",{d:path+" L "+points[points.length-1][0].toFixed(1)+",154 L "+points[0][0].toFixed(1)+",154 Z",class:"rd-chart-area"}));svg.append(mk("path",{d:path,class:"rd-chart-line"}))}
 parent.append(svg);
}
function drawHome(){
 if(!ready||activePage!=="home")return;
 const root=$("rdHome");while(root.children.length>2)root.lastElementChild.remove();
 const orders=activeOrders(),today=todayMoscow(),month=today.slice(0,7);
 const thisMonth=orders.filter(o=>o.date?.startsWith(month));
 const customers=new Set(thisMonth.map(o=>normalizePhone(o.phone)||o.name.toLocaleLowerCase("ru")));
 const complete=thisMonth.filter(o=>o.status==="Выполнен");
 const paid=thisMonth.filter(o=>o.paid&&o.price!=null&&Number.isFinite(o.price));
 stats(root,[
  {label:"Заказы сегодня",value:String(orders.filter(o=>o.date===today).length),hint:"Записи на текущую дату (МСК)"},
  {label:"Клиенты за месяц",value:String(customers.size),hint:"Уникальные номера / имена"},
  {label:"Оплаченные заказы",value:cash(paid.reduce((n,o)=>n+o.price,0)),hint:"Сумма отмеченных оплат за месяц, не касса"},
  {label:"Выполнено за месяц",value:String(complete.length),hint:"По статусу «Выполнен»"}
 ]);
 const middle=makeNode("div","rd-grid-main");
 const chart=panel("Динамика заказов","Количество записей по дням месяца (МСК)");
 const monthStart=month+"-01",date0=parseDate(monthStart),days=new Date(date0.getFullYear(),date0.getMonth()+1,0).getDate();
 const series=Array.from({length:days},(_,i)=>thisMonth.filter(o=>o.date===month+"-"+String(i+1).padStart(2,"0")).length);
 drawChart(chart,series);
 const assistant=panel("✦ ИИ-помощник","Спрашивайте о заказах и расписании");
 for(const label of ["Найти свободное окно","Показать неоплаченные заказы","Сколько заказов за неделю?"]){
  const b=makeNode("button","rd-quick",label+"  ›");b.type="button";b.addEventListener("click",()=>window.location.assign("/ai.html"));assistant.append(b);
 }
 const ai=makeNode("button","rd-primary","Открыть ИИ-чат");ai.style.width="100%";ai.style.marginTop="9px";ai.addEventListener("click",()=>window.location.assign("/ai.html"));assistant.append(ai);middle.append(chart,assistant);root.append(middle);
 const two=makeNode("div","rd-grid-main rd-blockgap");
 const upcoming=panel("Ближайшие записи");
 const nowMoscow=new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Europe/Moscow"});
 const future=orders.filter(o=>o.date&&(o.date>today||(o.date===today&&(o.time||"23:59")>=nowMoscow)))
   .sort((a,b)=>String(a.date+" "+a.time).localeCompare(String(b.date+" "+b.time))).slice(0,5);
 if(!future.length)upcoming.append(boxText("div","Ближайших записей нет","rd-empty"));
 future.forEach(o=>rowEntry(upcoming,o.name,o.master?dateLong(o.date)+" · "+o.master:dateLong(o.date),o.time||"—",()=>{navigate("orders");openForm(o.id)}));
 const notice=panel("Что требует внимания");
 const unpaid=orders.filter(o=>o.status==="Выполнен"&&!o.paid),noMaster=orders.filter(o=>!smText(o.master)&&o.status!=="Выполнен");
 rowEntry(notice,"Неоплаченные выполненные заказы","По статусу и отметке оплаты",String(unpaid.length),()=>navigate("orders"));
 rowEntry(notice,"Заказы без мастера","Нужно назначить исполнителя",String(noMaster.length),()=>navigate("orders"));
 rowEntry(notice,"Свободные окна","Смотрите актуальный календарь","Открыть",()=>navigate("calendar"));
 two.append(upcoming,notice);root.append(two);
 const latest=panel("Последние заказы");const recent=[...getOrders()].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,5);
 if(!recent.length)latest.append(boxText("div","Заказов пока нет","rd-empty"));
 recent.forEach(o=>rowEntry(latest,o.name,(o.date?dateLong(o.date):"Без даты")+" · "+(o.master||"Без мастера"),o.price==null?"—":cash(o.price),()=>{navigate("orders");openForm(o.id)}));
 latest.classList.add("rd-blockgap");root.append(latest,boxText("div","Финансовая касса и распределение средств остаются в действующем разделе «Финансы».","rd-footer"));
}
function drawCalendar(){
 if(!ready||activePage!=="calendar")return;
 const board=$("rdCalendarBoard").querySelector(".rd-week-grid");board.replaceChildren();
 const monday=addDays(selectedDate,-((parseDate(selectedDate).getDay()+6)%7));
 const orders=getOrders().filter(o=>o.date && o.status!=="Отменён");
 for(let i=0;i<7;i++){
  const date=addDays(monday,i),day=makeNode("div","rd-calendar-day"+(date===selectedDate?" is-today":""));
  day.append(boxText("h3",parseDate(date).toLocaleDateString("ru-RU",{weekday:"short",day:"numeric",month:"short"})));
  const items=orders.filter(o=>o.date===date).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  if(!items.length)day.append(boxText("p","Нет записей","rd-muted"));
  for(const o of items){
   const event=makeNode("button","rd-event"+(o.status==="Выполнен"?" is-done":""));
   event.type="button";event.append(boxText("strong",(o.time||"—")+" · "+o.name),boxText("span",o.master||"Мастер не назначен"));
   event.addEventListener("click",()=>openForm(o.id));day.append(event);
  }
  board.append(day);
 }
}
function drawClients(){
 if(!ready||activePage!=="clients")return;
 const list=$("rdClientsList");list.replaceChildren();
 const groups=new Map();
 for(const o of getOrders()){
  const key=normalizePhone(o.phone)||"name:"+smText(o.name).toLocaleLowerCase("ru");
  if(!groups.has(key))groups.set(key,{name:o.name,phone:o.phone,items:[],last:""});
  const item=groups.get(key);item.items.push(o);if(o.date>item.last)item.last=o.date;
 }
 const term=$("rdClientSearch").value.toLocaleLowerCase("ru").trim();
 const values=[...groups.values()].filter(item=>(item.name+" "+item.phone).toLocaleLowerCase("ru").includes(term))
 .sort((a,b)=>b.last.localeCompare(a.last)||a.name.localeCompare(b.name,"ru"));
 if(!values.length){list.append(boxText("div","Клиенты не найдены","rd-empty"));return}
 for(const g of values.slice(0,150)){
  const card=makeNode("article","rd-client");card.append(boxText("strong",g.name||"Без имени"),boxText("span",g.phone||"Телефон не указан"),boxText("span","Заказов: "+g.items.length+" · Последняя запись: "+(g.last?dateLong(g.last):"—")));
  const btn=makeNode("button","","Открыть заказы");btn.type="button";btn.addEventListener("click",()=>{navigate("orders");$("rdTopSearch").value=g.name;rdSearchTerm=g.name.toLocaleLowerCase("ru");filterCards()});card.append(btn);list.append(card);
 }
 if(values.length>150)list.append(boxText("div","Показаны первые 150 клиентов. Уточните поиск.","rd-note"));
}
function filterCards(){
 if(!ready)return;
 for(const card of $("orders").querySelectorAll(".order-card")){
  card.hidden=Boolean(rdSearchTerm)&&!String(card.dataset.search||"").includes(rdSearchTerm);
 }
}
window.__rdAccess=()=>{
 if(currentRole==="master"){app.classList.add("rd-master");return}
 if(!["owner","manager"].includes(currentRole))return;
 build();
};
window.__rdRefresh=()=>{
 if(!ready)return;
 if(activePage==="home")drawHome();
 if(activePage==="calendar")drawCalendar();
 if(activePage==="clients")drawClients();
 if(activePage==="orders")filterCards();
};
})();
