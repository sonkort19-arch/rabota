/* Read-only regression tests for Raul master dashboard.
 * Synthetic data only: no network calls, no Supabase writes.
 * Run: node tests/master-dashboard.cjs
 */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createMasterUI}=require("../master-ui.js");
const {test}=require("node:test");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"master-dashboard.css"),"utf8");
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const main=scripts.find(s=>s.includes("function renderMasterSchedule("));
assert.ok(main,"inline application script must exist");
assert.doesNotThrow(()=>new Function(main),"application JavaScript must parse");
function element(tag,text="") {
 return {
  tagName:tag.toUpperCase(),children:[],textContent:text,hidden:true,attrs:{},events:{},
  append(...nodes){this.children.push(...nodes)},
  replaceChildren(...nodes){this.children=[...nodes]},
  addEventListener(name,fn){this.events[name]=fn},
  setAttribute(name,value){this.attrs[name]=String(value)},
  getAttribute(name){return this.attrs[name]},
  querySelector(){return null},
  scrollIntoView(){}
 };
}
function collectText(e){return e.textContent+" "+e.children.map(collectText).join(" ")}
const today="2026-11-12";
const records=[
 {id:"future",date:"2026-11-20",time:"10:00",status:"Записан",paid:false,name:"Андрей"},
 {id:"next",date:today,time:"18:00",status:"Записан",paid:false,name:"Следующий"},
 {id:"early",date:today,time:"15:00",status:"Записан",paid:false,name:"Уточнить"},
 {id:"tomorrow",date:"2026-11-13",time:"10:00",status:"Записан",paid:false,name:"Завтра"},
 {id:"old",date:"2026-11-11",time:"13:00",status:"Записан",paid:false,name:"Старый"},
 {id:"unpaid",date:"2026-11-10",time:"10:00",status:"Выполнен",paid:false,name:"Неоплачен"},
 {id:"cash",date:"2026-11-11",time:"15:40",status:"Выполнен",paid:true,name:"На подтверждение"},
 {id:"confirmed",date:"2026-11-09",time:"10:00",status:"Выполнен",paid:true,name:"Закрыт"},
 {id:"cancelled",date:today,time:"16:00",status:"Отменён",paid:false,name:"Отменён"}
];
const fixedDate=class extends Date{
 constructor(...a){super(...(a.length?a:["2026-11-12T13:36:00.000Z"]))}
};
function fixture(role="master",tab="calendar"){
 const summary=element("section");
 const document={getElementById:id=>id==="masterTodaySummary"?summary:null,querySelectorAll:()=>[]};
 const make=(tag,cls,txt)=>{const e=element(tag,txt||"");e.className=cls;return e};
 const api=createMasterUI({
  make,parseDate:date=>{
    const [year,month,day]=date.split("-").map(Number);
    return new Date(year,month-1,day,12);
  },formatDate:d=>d==="2026-11-12"?"12 ноя":d,
  getOrders:()=>records,
  getCurrentRole:()=>role,getCurrentTab:()=>tab,
  doc:document,ordersNode:element("section"),STATUSES:["Записан","В работе","Выполнен","Отменён"],
  openMasterOrderDialog:()=>{},DateImpl:fixedDate
 });
 return {...api,summary};
}
test("time is determined in Europe/Moscow, independent of browser timezone",()=>{
 const f=fixture();
 assert.deepEqual(f.masterClock(),{date:today,minutes:16*60+36});
 assert.equal(f.masterTimeMinutes("15:00"),900);
 assert.equal(f.masterTimeMinutes("18:00"),1080);
 assert.equal(f.masterTimeMinutes("invalid"),-1);
});
test("work queue excludes completed and cancelled orders; today comes first",()=>{
 const f=fixture();
 const orders=f.masterWorkingOrders().sort((a,b)=>f.masterScheduleSort(a,b,today));
 assert.deepEqual(orders.map(x=>x.id),["early","next","tomorrow","future","old"]);
 assert.equal(f.masterOrderCount(1),"1 заказ");
 assert.equal(f.masterOrderCount(2),"2 заказа");
 assert.equal(f.masterOrderCount(11),"11 заказов");
});
test("overview highlights next appointment and status needing review",()=>{
 const f=fixture();
 f.renderMasterOverview(f.masterWorkingOrders());
 const content=collectText(f.summary);
 assert.equal(f.summary.hidden,false);
 assert.doesNotMatch(content,/Сегодня · 12 ноя/);
 assert.doesNotMatch(content,/Проверить статус/);
 assert.match(content,/Ближайший/);
 assert.match(content,/18:00 · Следующий/);
 assert.equal(f.summary.children.length,1);
 assert.equal(f.summary.children[0].className,"master-next-jump master-next-compact");
});
test("overview stays hidden outside master active schedule",()=>{
 const owner=fixture("owner","all"),history=fixture("master","history");
 owner.renderMasterOverview([]);history.renderMasterOverview([]);
 assert.equal(owner.summary.hidden,true);assert.equal(history.summary.hidden,true);
});
test("master presentation and role-scoped finance remain wired",()=>{
 assert.match(html,/id="masterTodaySummary"/);
 assert.doesNotMatch(html,/masterPendingSettlements|masterSettlementRows|renderMasterSettlements\(/);
 assert.match(html,/masterWorkingOrders\(\)/);
 assert.match(html,/masterPayments\(\)\{\s*if\(currentRole!=="master"\)throw Error/);
 assert.match(html,/receipts\s*:\s*receipts\.map\(describe\)/);
 assert.match(html,/ownerSnapshot\(\)\{\s*if\(currentRole!=="owner"\)throw Error/);
 assert.match(html,/financeModel\.calculateRecordedCashFlow\(/);
 assert.match(html,/href="\/master-dashboard\.css\?v=[^"]+"/);
 assert.match(css,/#appScreen\.master-mode \.master-schedule-toggle/);
 assert.match(css,/grid-template-columns:70px minmax\(0,1fr\) 18px/);
 assert.match(css,/min-height:48px;font:inherit;cursor:pointer/);
 assert.match(css,/max-width:390px/);
});

test("finance refresh failure only marks finance as unavailable, not stale orders",()=>{
 const start=main.indexOf("    function reportSync(error, source=");
 const end=main.indexOf("    async function reloadOrders(",start);
 assert.ok(start>=0&&end>start,"sync indicator function exists");
 const status={dataset:{},hidden:true,classList:{toggle(){}}};
 const message={textContent:""};
 const retry={textContent:"",hidden:true};
 const elements={syncStatus:status,syncStatusMessage:message,retryOrderSync:retry};
 const fn=new Function("document","Date",main.slice(start,end)+"\nreturn reportSync;")(
   {getElementById:id=>elements[id]},Date);
 fn(new Error("financial timeout"),"finance");
 assert.equal(status.hidden,false);
 assert.match(message.textContent,/Заявки обновлены/);
 assert.match(message.textContent,/финансы недоступны/);
 assert.doesNotMatch(message.textContent,/Не удалось обновить заявки/);
 assert.equal(retry.hidden,true);
 fn(new Error("orders timeout"));
 assert.match(message.textContent,/Не удалось обновить заявки/);
 assert.equal(retry.hidden,false);
 fn(new Error("initial orders timeout"),"initial-orders");
 fn(new Error("financial timeout"),"finance");
 assert.match(message.textContent,/Расписание пока не загрузилось/);
 assert.equal(retry.hidden,false,"Finance failure must not remove the schedule retry");
 fn(null);
 assert.equal(status.hidden,true);
 assert.equal(message.textContent,"");
 assert.equal(retry.hidden,true);
});
test("changed order data restores focus to the same master's order row",()=>{
 const start=main.indexOf("    function loadOrderData(");
 const end=main.indexOf("    async function reloadOrders(",start);
 assert.ok(start>=0&&end>start,"order data refresh function exists");
 const source=main.slice(start,end);
 assert.match(source,/focusedMasterOrderId=activeToggle\?\.closest/);
 assert.match(source,/row=>row\.dataset\.orderId===focusedMasterOrderId/);
 assert.match(source,/\.focus\(\{preventScroll:true\}\)/);
 const reload=main.slice(end,main.indexOf("    function getOrders()",end));
 assert.match(reload,/await loadOrderData\(background\)/);
 assert.match(reload,/markFinanceStale\(\);\s*await loadOrderData\(background\)/);
 assert.match(reload,/await loadOrderData\(background\)[\s\S]*?await refreshFinance\(\)/);
 const financeStart=main.indexOf("    const financeReader=");
 const financeEnd=main.indexOf("    function updateFinanceViews(",financeStart);
 assert.ok(financeStart>=0&&financeEnd>financeStart,"independent finance refresh function exists");
 assert.match(main.slice(financeStart,financeEnd),/state\.refreshError\)reportSync\(state\.refreshError,"finance"\)/);
});

test("overdue booked orders are exposed for the bell, not the daily strip",()=>{
  const f=fixture();
  const review=f.masterOrdersToReview(f.masterWorkingOrders());
  assert.deepEqual(review.map(o=>o.id),["early","old"]);
  f.renderMasterOverview(f.masterWorkingOrders());
  assert.equal(f.summary.children.some(x=>String(x.className||"").includes("master-review")),false);
});
test("compact next visit has an accessible click action",()=>{
  const f=fixture();
  f.renderMasterOverview(f.masterWorkingOrders());
  assert.match(f.summary.children[0].attrs["aria-label"],/Ближайший выезд:/);
  assert.equal(typeof f.summary.children[0].events.click,"function");
});
test("Raul status filters use five compact accessible icons without changing status values",()=>{
 const script=fs.readFileSync(path.join(root,"money-workspace.js"),"utf8");
 const styles=fs.readFileSync(path.join(root,"money-workspace.css"),"utf8");
 assert.match(script,/\["all","Все"\],\["Записан","Записаны"\]/);
 assert.match(script,/\["В работе","В работе"\],\["Выполнен","Выполнены"\],\["Отменён","Отменены"\]/);
 for(const status of ["all","Записан","В работе","Выполнен","Отменён"])
   assert.ok(script.includes(status+":" )||script.includes('"'+status+'"'+":"),status+" icon available");
 assert.match(script,/chip\.append\(statusIcon\(value\)\)/);
 assert.match(script,/chip\.setAttribute\("aria-label","Фильтр: "\+label\)/);
 assert.match(script,/chip\.dataset\.status=value;filters\.append\(chip\)/);
 assert.match(script,/chip\.classList\.toggle\("active",active\);chip\.setAttribute\("aria-pressed",String\(active\)\)/);
 assert.match(script,/const statusMatch=orderStatus==="all"\|\|element\.dataset\.status===orderStatus/);
 assert.match(styles,/\.mw-status-filters \.mw-filter-chip\{/);
 assert.match(styles,/height:48px;min-height:48px/);
 assert.match(styles,/\.mw-filter-chip:focus-visible/);
 assert.match(styles,/flex:1 1 0;width:0;min-width:0/);
 assert.match(styles,/@media\(max-width:360px\)/);
 assert.doesNotMatch(script,/chip\.append\(statusIcon\(value\),el\("span","mw-filter-caption",label\)\)/);
 assert.doesNotMatch(styles,/\.mw-status-filters \.mw-filter-caption/);
});
test("Master navigation identifies the current section and report back stays in context",()=>{
 const script=fs.readFileSync(path.join(root,"money-workspace.js"),"utf8");
 const styles=fs.readFileSync(path.join(root,"money-workspace.css"),"utf8");
 assert.match(script,/\["reports","Отчёты","reports"\]/);
 assert.match(script,/\["payments","Платежи","payments"\]/);
 assert.match(script,/\["settings","Настройки","settings"\]/);
 assert.match(script,/window\.__rdSetActiveNavItem\(nav,/);
 assert.match(script,/window\.__rdSetScreenHeader\(title,step==="menu"\?null:closeMasterReport/);
 assert.match(script,/\$\("rdScreenBack"\)/);
 assert.match(script,/window\.__rdCloseHeaderMenus\?\.\(\)/);
 assert.doesNotMatch(script,/mw-orders-minimal-header|mw-payments-header|mw-settings-title/);
 assert.doesNotMatch(styles,/mw-orders-minimal-header|mw-payments-header|--master-brand-height/);
 assert.match(html,/href="\/money-workspace\.css\?v=[^"]+"/);
 assert.match(html,/src="\/money-workspace\.js\?v=[^"]+"/);
});
test("the accessible workspace follows the shared title, back, notifications and profile header",()=>{
 const header=html.match(/<header id="rdScreenHeader" hidden>[\s\S]*?<\/header>/)?.[0];
 assert.ok(header,"shared header is present");
 assert.match(header,/id="rdScreenBack"[^>]*aria-label="Назад" hidden[\s\S]*<h1 id="appTitle" tabindex="-1">Заказы<\/h1>/);
 assert.match(header,/id="pushBellBtn"[^>]*aria-controls="pushPopover"/);
 assert.match(header,/id="rdProfileTrigger"[^>]*aria-controls="rdProfileMenu"/);
 assert.match(html,/<main id="appScreen" aria-label="CRM «Работа»" hidden>/);
 assert.ok(html.indexOf(header)<html.indexOf('<main id="appScreen"'));
 assert.equal((html.match(/id="rdScreenHeader"/g)||[]).length,1);
 assert.equal((html.match(/id="rdProfile"/g)||[]).length,1);
 assert.doesNotMatch(html,/id="masterBrand"|class="master-header-info"/);
});

test("the shared profile retains Raul's photo and accessible account control",()=>{
 const start=html.indexOf('<div class="rd-profile" id="rdProfile"');
 const end=html.indexOf('<div class="rd-profile-menu"',start);
 assert.ok(start>=0&&end>start,"profile trigger is present");
 const profile=html.slice(start,end);
 assert.ok(profile.includes('id="rdProfileTrigger"'),"original trigger ID kept");
 assert.ok(profile.includes('aria-controls="rdProfileMenu"'),"dropdown remains wired");
 assert.match(profile,/class="rd-profile-photo" hidden src="\/icons\/raul-profile-avatar-20261114\.jpg"/);
 assert.ok(profile.includes('<svg viewBox="0 0 24 24"'),"original SVG fallback kept");
 const avatar=fs.readFileSync(path.join(root,"icons/raul-profile-avatar-20261114.jpg"));
 assert.ok(avatar.length>1000&&avatar.length<10000,"small local image exists");
 assert.deepEqual([...avatar.subarray(0,3)],[0xff,0xd8,0xff],"valid JPEG signature");
 assert.match(html,/querySelector\("#rdProfileTrigger \.rd-profile-photo"\)\.hidden=!\(currentRole==="master"/);
 assert.ok(html.includes('const profileTrigger=document.getElementById("rdProfileTrigger")'),
  "original profile click handler stays available");
});
