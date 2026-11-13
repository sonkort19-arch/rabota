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
const collections={
 cash:{confirmed_at:null,submitted_at:"2026-11-11T16:00:00Z"},
 confirmed:{confirmed_at:"2026-11-11T17:00:00Z",submitted_at:"2026-11-11T16:00:00Z"}
};
const fixedDate=class extends Date{
 constructor(...a){super(...(a.length?a:["2026-11-12T13:36:00.000Z"]))}
};
function fixture(role="master",tab="all"){
 const summary=element("section");
 const document={getElementById:id=>id==="masterTodaySummary"?summary:null,querySelectorAll:()=>[]};
 const make=(tag,cls,txt)=>{const e=element(tag,txt||"");e.className=cls;return e};
 const api=createMasterUI({
  make,parseDate:date=>{
    const [year,month,day]=date.split("-").map(Number);
    return new Date(year,month-1,day,12);
  },formatDate:d=>d==="2026-11-12"?"12 ноя":d,
  getOrders:()=>records,collectionForOrder:id=>collections[id]||null,
  getCurrentRole:()=>role,getCurrentTab:()=>tab,
  doc:document,ordersNode:element("section"),STATUSES:["Новый","Записан","В работе","Выполнен","Отменён"],
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
test("unfinished financial settlements stay in a separate queue",()=>{
 const f=fixture();
 assert.deepEqual(f.masterSettlementOrders().map(x=>x.id),["cash","unpaid"]);
});
test("overview highlights next appointment and status needing review",()=>{
 const f=fixture();
 f.renderMasterOverview(f.masterWorkingOrders());
 const content=collectText(f.summary);
 assert.equal(f.summary.hidden,false);
 assert.match(content,/Сегодня · 12 ноя/);
 assert.match(content,/2 заказа/);
 assert.match(content,/18:00 · Следующий/);
 assert.match(content,/Проверить статус · 2 заказа/);
});
test("overview stays hidden outside master active schedule",()=>{
 const owner=fixture("owner","all"),history=fixture("master","history");
 owner.renderMasterOverview([]);history.renderMasterOverview([]);
 assert.equal(owner.summary.hidden,true);assert.equal(history.summary.hidden,true);
});
test("master presentation and role-scoped finance remain wired",()=>{
 assert.match(html,/id="masterTodaySummary"/);
 assert.match(html,/id="masterPendingSettlements"/);
 assert.match(html,/id="masterSettlementRows"/);
 assert.match(html,/masterPendingSettlements[\s\S]*?masterSettlementRows/);
 assert.match(html,/masterWorkingOrders\(\)/);
 assert.match(html,/renderMasterSettlements\(\)/);
 assert.match(html,/isOwner\?financeOperations:financeOperations\.filter\(o=>o\.master_user_id===financeMasterId&&o\.kind==="raul_payout"\)/);
 assert.match(html,/if\(isOwner\)\{[\s\S]*?financeMetric\("Доля компании"/);
 assert.match(html,/id="masterBalanceQuick"[\s\S]*?К выплате/);
 assert.match(html,/href="\/master-dashboard\.css\?v=[^"]+"/);
 assert.match(css,/#appScreen\.master-mode \.master-schedule-toggle/);
 assert.match(css,/white-space:nowrap;flex:0 0 auto/);
 assert.match(css,/min-height:48px;font:inherit;cursor:pointer/);
 assert.match(css,/max-width:390px/);
});

test("finance refresh failure only marks finance as unavailable, not stale orders",()=>{
 const start=main.indexOf("    function reportSync(error, source=");
 const end=main.indexOf("    async function reloadOrders(",start);
 assert.ok(start>=0&&end>start,"sync indicator function exists");
 const node=()=>({textContent:"",classList:{toggle(){}}});
 const nodes=new Map(["syncStatus","rdOrdersSynced","rdHomeSynced","rdCalendarSynced"]
   .map(id=>[id,node()]));
 const fn=new Function("document","Date",main.slice(start,end)+"\nreturn reportSync;")(
   {getElementById:id=>nodes.get(id)||null},Date);
 fn(new Error("financial timeout"),"finance");
 assert.match(nodes.get("syncStatus").textContent,/Заявки обновлены/);
 assert.match(nodes.get("syncStatus").textContent,/финансы недоступны/);
 assert.doesNotMatch(nodes.get("syncStatus").textContent,/Не удалось обновить заявки/);
 fn(new Error("orders timeout"));
 assert.match(nodes.get("syncStatus").textContent,/Не удалось обновить заявки/);
 fn(null);
 assert.match(nodes.get("syncStatus").textContent,/Обновлено/);
});
test("changed order data restores focus to the same master's order row",()=>{
 const start=main.indexOf("    async function reloadOrders(");
 const end=main.indexOf("    function getOrders()",start);
 assert.ok(start>=0&&end>start,"refresh function exists");
 const source=main.slice(start,end);
 assert.match(source,/focusedMasterOrderId=activeToggle\?\.closest/);
 assert.match(source,/row=>row\.dataset\.orderId===focusedMasterOrderId/);
 assert.match(source,/\.focus\(\{preventScroll:true\}\)/);
 assert.match(source,/reportSync\(syncError,"finance"\)/);
});

test("status review lists all past unfinished bookings",()=>{
 const f=fixture();
 f.renderMasterOverview(f.masterWorkingOrders());
 const review=f.summary.children.find(x=>String(x.className||"").includes("master-review-jump"));
 assert.ok(review);
 assert.equal(review.attrs["aria-expanded"],"false");
 review.events.click();
 const list=f.summary.children.find(x=>x.className==="master-review-list");
 assert.ok(list);
 assert.equal(list.children.length,2);
 const names=list.children.map(x=>x.textContent).join(" ");
 assert.match(names,/Уточнить/);
 assert.match(names,/Старый/);
 const toggler=f.summary.children.find(x=>String(x.className||"").includes("master-review-jump"));
 assert.equal(toggler.attrs["aria-expanded"],"true");
 toggler.events.click();
 assert.equal(f.summary.children.some(x=>x.className==="master-review-list"),false);
});
test("master brand uses inline vector, not an unloaded PNG",()=>{
 assert.match(html,/class="master-brand-icon"/);
 assert.match(html,/<linearGradient id="master-brand-gradient"/);
});
