/* Master cards reuse the owner's compact visual geometry; synthetic data only. */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const masterCss=fs.readFileSync(path.join(root,"master-dense.css"),"utf8");
const ownerCss=fs.readFileSync(path.join(root,"orders-list.css"),"utf8");
const begin=html.indexOf("    function makeMasterScheduleRow(order,isNext=false) {");
const end=html.indexOf("    function renderMasterSchedule(rows) {",begin);
assert.ok(begin>0&&end>begin,"master renderer remains available");
class Node {
 constructor(tag,cls="",value=""){
  this.tagName=tag.toUpperCase();this.className=cls;this.textContent=value;
  this.children=[];this.dataset={};this.attributes={};this.listeners={};this.hidden=false;
  const that=this;
  this.classList={toggle(name,on){
   const parts=new Set(that.className.split(" ").filter(Boolean));
   if(on)parts.add(name);else parts.delete(name);that.className=[...parts].join(" ");
  }};
 }
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=[...nodes]}
 setAttribute(name,value){this.attributes[name]=String(value)}
 getAttribute(name){return this.attributes[name]}
 addEventListener(name,callback){this.listeners[name]=callback}
}
const make=(tag,cls,value)=>new Node(tag,cls,value);
const expandedMasterOrders=new Set();
let detailBuilt=0;
const makeCard=()=>{detailBuilt++;return make("article","order-card")};
const factory=new Function("expandedMasterOrders","make","makeCard","STATUSES",
 "collectionForOrder",html.slice(begin,end)+"\nreturn makeMasterScheduleRow;");
const render=factory(expandedMasterOrders,make,makeCard,
 ["Новый","Записан","В работе","Выполнен","Отменён"],()=>null);
const flat=(node)=>[node,...node.children.flatMap(flat)];
test("Raul card has the owner-style name, avatar, address, time, work, badge and price",()=>{
 const card=render({id:"booking-42",date:"2026-11-12",time:"18:00",name:"Давид",
  address:"Сунжа набережная 26",radiators:9,floorLoops:3,price:21000,status:"Записан"},true);
 const toggle=card.children[0],nodes=flat(toggle);
 assert.equal(card.dataset.orderId,"booking-42");
 assert.ok(card.className.includes("is-next"));
 for(const cls of ["master-schedule-avatar","master-schedule-name","master-schedule-address",
  "master-schedule-time","master-schedule-work","master-schedule-meta","master-schedule-price"]){
   assert.ok(nodes.some(node=>node.className.split(" ").includes(cls)),cls);
 }
 assert.ok(nodes.some(node=>node.textContent==="Д"));
 assert.ok(nodes.some(node=>node.textContent==="Давид"));
 assert.ok(nodes.some(node=>node.textContent==="18:00"));
 assert.ok(nodes.some(node=>node.textContent.replace(/\s/g," ").includes("21 000 ₽")));
 assert.ok(nodes.some(node=>node.textContent.includes("Радиаторы: 9")&&node.textContent.includes("3 конт.")));
 assert.equal(toggle.getAttribute("aria-expanded"),"false");
 assert.equal(detailBuilt,0,"closed cards do not eagerly render interactive finance controls");
 toggle.listeners.click();
 assert.equal(toggle.getAttribute("aria-expanded"),"true");
 assert.equal(card.children[1].hidden,false);
 assert.equal(detailBuilt,1);
 toggle.listeners.click();
 assert.equal(card.children[1].hidden,true);
 assert.equal(toggle.getAttribute("aria-expanded"),"false");
 expandedMasterOrders.clear();
});
test("Master's settlement cards keep their finance warning and do not expose owner controls",()=>{
 const card=render({id:"paid-2",time:"11:00",name:"Клиент",paid:false,
  status:"Выполнен",price:10000});
 const nodes=flat(card.children[0]);
 assert.ok(nodes.some(node=>node.className==="master-money-note"&&
   node.textContent==="Оплата ещё не отмечена"));
 assert.equal(card.children[1].hidden,true);
});
test("Master overrides match owner's mobile sizes and remain role-scoped",()=>{
 assert.match(ownerCss,/padding:10px 12px;gap:5px 7px;min-height:0/);
 assert.match(masterCss,/Same mobile card rhythm as owner list/);
 assert.match(masterCss,/grid-template-areas:"person when arrow" "work work work" "state price price"/);
 assert.match(masterCss,/\.master-schedule-avatar\{[\s\S]*?width:32px;height:32px/);
 assert.match(masterCss,/\.master-schedule-name\{\s*font-size:14px/);
 assert.match(masterCss,/\.master-schedule-address\{[\s\S]*?font-size:11px/);
 assert.match(masterCss,/\.master-schedule-meta \.status-badge\{[\s\S]*?min-height:22px/);
 assert.match(html,/href="\/master-dense\.css\?v=20261112-compact-approved-v3"/);
});

test("Raul history reuses compact expandable cards, sorted as history",()=>{
 const viewStart=html.indexOf("    function render() {");
 const viewEnd=html.indexOf("    let formPaymentChoice=null;",viewStart);
 assert.ok(viewStart>=0&&viewEnd>viewStart,"main render function exists");
 const view=html.slice(viewStart,viewEnd);
 assert.match(view,/if \(currentTab === "history"\) \{\s*shown = getOrders\(\).filter\(o=>o.status==="Выполнен"\)/);
 assert.match(view,/if\(currentRole==="master"\) renderMasterSchedule\(shown\);/);
 assert.doesNotMatch(view,/currentRole==="master" && currentTab!=="history"/);
 const start=html.indexOf("    function renderMasterSchedule(rows) {");
 const end=html.indexOf("    let masterSettlementsSignature=",start);
 assert.ok(start>=0&&end>start,"master schedule renderer exists");
 const source=html.slice(start,end);
 assert.match(source,/currentTab==="history"\?masterDayLabel\(date\)/);
 assert.match(source,/currentTab==="history"\?"Выполненных заказов нет":"Рабочих заказов нет"/);
 const root=make("div","orders");
 const fn=new Function("make","ordersNode","currentTab","masterClock","masterTimeMinutes",
   "masterScheduleSort","masterDayLabel","formatDate","masterOrderCount","makeMasterScheduleRow",
   source+"\nreturn renderMasterSchedule;");
 const renderHistory=fn(make,root,"history",()=>({date:"2026-11-12",minutes:1000}),()=>0,
   ()=>0,date=>date,date=>date,n=>n+" заказов",o=>make("article","master-schedule-card",o.name));
 renderHistory([{id:"old-1",date:"2026-11-11",name:"Завершённый"},
                {id:"old-2",date:"2026-11-10",name:"Оплаченный"}]);
 assert.equal(root.children.length,4,"each history date has its heading and one compact row");
 assert.ok(root.children.filter(n=>n.className==="master-day-heading").length===2);
 assert.equal(root.children.filter(n=>n.className==="master-schedule-card").length,2);
 assert.ok(!flat(root).some(n=>String(n.textContent).includes("Проверить дату")),
   "completed jobs are not marked overdue");
 const emptyRoot=make("div","orders");
 const renderEmpty=fn(make,emptyRoot,"history",()=>({date:"2026-11-12",minutes:1000}),()=>0,
   ()=>0,date=>date,date=>date,n=>n+" заказов",o=>make("article","master-schedule-card",o.name));
 renderEmpty([]);
 assert.equal(emptyRoot.children[0].textContent,"Выполненных заказов нет");
});
