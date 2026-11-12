/* Read-only regression tests for Raul master dashboard.
 * Synthetic data only: no network calls, no Supabase writes.
 * Run: node tests/master-dashboard.cjs
 */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
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
 const start=main.indexOf("    function masterClock() {");
 const end=main.indexOf("    function makeMasterScheduleRow(",start);
 assert.ok(start>=0&&end>start,"master dashboard helpers must be present");
 const factory=new Function("getOrders","collectionForOrder","currentRole","currentTab",
  "document","make","formatDate","Date","Intl",
  main.slice(start,end)+"\nreturn {masterClock,masterTimeMinutes,masterWorkingOrders,masterSettlementOrders,masterScheduleSort,masterOrderCount,renderMasterOverview};");
 const api=factory(()=>records,id=>collections[id]||null,role,tab,document,make,
  d=>d==="2026-11-12"?"12 ноя":d, fixedDate,Intl);
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
 assert.match(content,/Проверьте статус 2 заказов/);
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
 assert.match(html,/id="masterBalanceQuick"[\s\S]*?Осталось выплатить/);
 assert.match(html,/href="\/master-dashboard\.css\?v=20261112"/);
 assert.match(css,/#appScreen\.master-mode \.master-schedule-toggle/);
 assert.match(css,/max-width:390px/);
});
