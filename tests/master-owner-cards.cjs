/* Regression tests for the compact master order cards and unified history. */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const masterCss=fs.readFileSync(path.join(root,"master-dense.css"),"utf8");
const unifiedCss=fs.readFileSync(path.join(root,"master-unified.css"),"utf8");
const ownerCss=fs.readFileSync(path.join(root,"orders-list.css"),"utf8");
const dialogJs=fs.readFileSync(path.join(root,"master-order-dialog.js"),"utf8");
const start=html.indexOf("    function makeMasterScheduleRow(order,isNext=false) {");
const end=html.indexOf("    function renderMasterSchedule(rows) {",start);
assert.ok(start>0&&end>start,"master renderer must remain available");
class Node{
 constructor(tag,cls="",text=""){
   this.tagName=tag.toUpperCase();this.className=cls;this.textContent=text;
   this.children=[];this.dataset={};this.attributes={};this.listeners={};
 }
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=[...nodes]}
 setAttribute(name,value){this.attributes[name]=String(value)}
 getAttribute(name){return this.attributes[name]}
 addEventListener(name,fn){this.listeners[name]=fn}
}
const make=(tag,cls,text)=>new Node(tag,cls,text);
const flat=n=>[n,...n.children.flatMap(flat)];
function cardFixture(){
 const calls=[];
 const win={__rdOpenMasterDialog:(id,trigger)=>calls.push({id,trigger})};
 const factory=new Function("make","collectionForOrder","window","STATUSES",
   html.slice(start,end)+"\nreturn makeMasterScheduleRow;");
 return {render:factory(make,()=>null,win,
   ["Новый","Записан","В работе","Выполнен","Отменён"]),calls};
}
test("master order displays compact content and opens an isolated dialog",()=>{
 const {render,calls}=cardFixture();
 const row=render({id:"booking-42",date:"2026-11-12",time:"18:00",name:"Давид",
   address:"Сунжа набережная 26",radiators:9,floorLoops:3,price:21000,status:"Записан"},true);
 const toggle=row.children[0],nodes=flat(toggle);
 assert.equal(row.dataset.orderId,"booking-42");
 assert.ok(row.className.includes("is-next"));
 for(const cls of ["master-schedule-avatar","master-schedule-name","master-schedule-address",
   "master-schedule-time","master-schedule-work","master-schedule-meta","master-schedule-price"])
   assert.ok(nodes.some(node=>node.className.split(" ").includes(cls)),cls);
 for(const value of ["Д","Давид","18:00"])
   assert.ok(nodes.some(node=>node.textContent===value));
 assert.ok(nodes.some(node=>node.textContent.replace(/\s/g," ").includes("21 000 ₽")));
 assert.ok(nodes.some(node=>node.textContent.includes("Радиаторы: 9")&&node.textContent.includes("3 конт.")));
 assert.equal(toggle.getAttribute("aria-haspopup"),"dialog");
 assert.equal(row.children.length,1,"no long inline detail panel");
 toggle.listeners.click();
 assert.equal(calls.length,1);
 assert.equal(calls[0].id,"booking-42");
 assert.equal(calls[0].trigger,toggle);
});
test("completed unpaid orders keep payment warning without owner controls",()=>{
 const {render}=cardFixture();
 const row=render({id:"paid-2",time:"11:00",name:"Клиент",paid:false,status:"Выполнен",price:10000});
 assert.ok(flat(row).some(n=>n.className==="master-money-note"&&n.textContent==="Оплата ещё не отмечена"));
 assert.equal(row.children.length,1);
 assert.doesNotMatch(html.slice(start,end),/makeCard\(order\)/);
});
test("master styling remains role-scoped and owner cards retain their geometry",()=>{
 assert.match(ownerCss,/padding:10px 12px;gap:5px 7px;min-height:0/);
 assert.match(masterCss,/Same mobile card rhythm as owner list/);
 assert.match(masterCss,/grid-template-areas:"person when arrow" "work work work" "state price price"/);
 assert.match(masterCss,/\.master-schedule-avatar\{[\s\S]*?width:32px;height:32px/);
 assert.match(unifiedCss,/body\.rd #appScreen\.rd-master\.master-mode #ordersArea > \.tabs/);
 assert.match(unifiedCss,/\.rd-master-order-modal/);
 assert.match(html,/href="\/master-dense\.css\?v=/);
 assert.doesNotThrow(()=>new Function(dialogJs));
});
test("master all-orders view includes history and supports filtering",()=>{
 const view=html.slice(html.indexOf("    function render() {"),
   html.indexOf("    let formPaymentChoice=null;"));
 assert.match(view,/if\(window\.__rdMasterOrdersMode==="day"\)/);
 assert.match(view,/shown=getOrders\(\)/);
 assert.match(view,/window\.__rdMasterApplyOrderFilters\?\.\(shown\)/);
 assert.match(view,/if\(currentRole==="master"\) renderMasterSchedule\(shown\)/);
 assert.match(unifiedCss,/#ordersArea > \.tabs\{\s*display:none!important/);
 assert.doesNotMatch(html,/expandedMasterOrders/);
});
test("unified list groups completed/cancelled jobs by date, not as overdue",()=>{
 const a=html.indexOf("    function renderMasterSchedule(rows) {"),
   b=html.indexOf("    let masterSettlementsSignature=",a);
 assert.ok(a>=0&&b>a);
 const source=html.slice(a,b);
 const root=make("div","orders");
 const factory=new Function("make","ordersNode","currentTab","masterClock","masterTimeMinutes",
   "masterScheduleSort","masterDayLabel","formatDate","masterOrderCount","makeMasterScheduleRow","window",
   source+"\nreturn renderMasterSchedule;");
 const fn=factory(make,root,"all",()=>({date:"2026-11-12",minutes:1000}),
   ()=>0,()=>0,day=>day,day=>day,n=>n+" заказов",
   o=>make("article","master-schedule-card",o.name),{__rdMasterOrdersMode:"orders"});
 fn([{id:"old-1",date:"2026-11-11",name:"Завершённый",status:"Выполнен"},
     {id:"old-2",date:"2026-11-10",name:"Отменённый",status:"Отменён"}]);
 assert.equal(root.children.filter(x=>x.className==="master-day-heading").length,2);
 assert.equal(root.children.filter(x=>x.className==="master-schedule-card").length,2);
 assert.ok(!flat(root).some(x=>String(x.textContent).includes("Проверить дату")));
 const empty=make("div","orders");
 const noOrders=factory(make,empty,"all",()=>({date:"2026-11-12",minutes:1000}),
   ()=>0,()=>0,day=>day,day=>day,n=>n+" заказов",
   o=>make("article","master-schedule-card",o.name),{__rdMasterOrdersMode:"orders"});
 noOrders([]);
 assert.equal(empty.children[0].textContent,"Заказов по выбранному фильтру нет");
});
