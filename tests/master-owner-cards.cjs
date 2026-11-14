/* Regression tests for Raul's compact owner-style cards and modal navigation.
 * Synthetic data only; no external requests or financial writes.
 */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createMasterUI}=require("../master-ui.js");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const masterCss=["master-dense.css","master-dense-enhancements.css"]
  .map(file=>fs.readFileSync(path.join(root,file),"utf8")).join("");
const ownerCss=fs.readFileSync(path.join(root,"orders-list.css"),"utf8");
class Node {
  constructor(tag,cls="",value=""){
    this.tagName=tag.toUpperCase();this.className=cls;this.textContent=value;
    this.children=[];this.dataset={};this.attributes={};this.listeners={};this.hidden=false;
  }
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(...nodes){this.children=[...nodes]}
  setAttribute(name,value){this.attributes[name]=String(value)}
  getAttribute(name){return this.attributes[name]}
  addEventListener(name,callback){this.listeners[name]=callback}
}
const make=(tag,cls,value)=>new Node(tag,cls,value);
const flat=node=>[node,...node.children.flatMap(flat)];
const dates={
  parse:s=>{const p=s.split("-").map(Number);return new Date(p[0],p[1]-1,p[2],12);},
  format:s=>s||"Без даты"
};
function fixture({tab="all",rows=[],collections={}}={}){
  const ordersNode=make("div","orders"),opened=[];
  const ui=createMasterUI({
    make,parseDate:dates.parse,formatDate:dates.format,
    getOrders:()=>rows,collectionForOrder:id=>collections[id]||null,
    getCurrentRole:()=>"master",getCurrentTab:()=>tab,
    doc:{getElementById:()=>make("div"),querySelectorAll:()=>[]},
    ordersNode,openMasterOrderDialog:order=>opened.push(order.id),
    STATUSES:["Новый","Записан","В работе","Выполнен","Отменён"]
  });
  return {ui,ordersNode,opened};
}
test("Raul card retains compact name, avatar, address, time, work, status and price",()=>{
  const f=fixture(),order={id:"booking-42",date:"2026-11-12",time:"18:00",name:"Давид",
    address:"Сунжа набережная 26",radiators:9,floorLoops:3,price:21000,status:"Записан"};
  const card=f.ui.makeMasterScheduleRow(order,true);
  const toggle=card.children[0],nodes=flat(toggle);
  assert.equal(card.dataset.orderId,"booking-42");
  assert.ok(card.className.includes("is-next"));
  for(const cls of ["master-schedule-avatar","master-schedule-name","master-schedule-address",
    "master-schedule-time","master-schedule-work","master-schedule-meta","master-schedule-price"]){
    assert.ok(nodes.some(node=>node.className.split(" ").includes(cls)),cls);
  }
  for(const label of ["Д","Давид","18:00"]){
    assert.ok(nodes.some(node=>node.textContent===label),label);
  }
  assert.ok(nodes.some(node=>node.textContent.replace(/\s/g," ").includes("21 000 ₽")));
  assert.ok(nodes.some(node=>node.textContent.includes("Радиаторы: 9")&&node.textContent.includes("3 конт.")));
  assert.match(toggle.getAttribute("aria-label"),/Открыть заказ Давид/);
  assert.equal(card.children.length,1,"interactive modal is not rendered while a card is closed");
  toggle.listeners.click();
  assert.deepEqual(f.opened,["booking-42"],"card opens existing master modal");
});
test("Unpaid completed card preserves its warning without owner controls",()=>{
  const f=fixture(),card=f.ui.makeMasterScheduleRow({
    id:"paid-2",time:"11:00",name:"Клиент",paid:false,
    status:"Выполнен",price:10000
  });
  const nodes=flat(card.children[0]);
  assert.ok(nodes.some(node=>node.className==="master-money-note"&&
    node.textContent==="Оплата ещё не отмечена"));
  assert.equal(card.children.length,1,"full details remain inside existing modal");
});
test("Master's compact CSS aligns with owner layout and stays role-scoped",()=>{
  assert.match(ownerCss,/padding:10px 12px;gap:5px 7px;min-height:0/);
  assert.match(masterCss,/Same mobile card rhythm as owner list/);
  assert.match(masterCss,/grid-template-areas:"person when arrow" "work work work" "state price price"/);
  assert.match(masterCss,/\.master-schedule-avatar\{[\s\S]*?width:32px;height:32px/);
  assert.match(masterCss,/\.master-schedule-name\{\s*font-size:14px/);
  assert.match(masterCss,/\.master-schedule-address\{[\s\S]*?font-size:11px/);
  assert.match(masterCss,/\.master-schedule-meta \.status-badge\{[\s\S]*?min-height:22px/);
  assert.match(html,/href="\/master-dense\.css\?v=[^"]+"/);
});
test("Raul's history displays compact rows grouped by booking dates",()=>{
  const viewStart=html.indexOf("    function render() {");
  const viewEnd=html.indexOf("    let formPaymentChoice=null;",viewStart);
  assert.ok(viewStart>=0&&viewEnd>viewStart,"main order-view renderer remains");
  const view=html.slice(viewStart,viewEnd);
  assert.match(view,/if \(currentTab === "history"\) \{\s*shown = getOrders\(\).filter\(o=>o.status==="Выполнен"\)/);
  assert.match(view,/if\(currentRole==="master"\) renderMasterSchedule\(shown\);/);
  const rows=[{id:"old-1",date:"2026-11-11",name:"Завершённый",status:"Выполнен",paid:true},
    {id:"old-2",date:"2026-11-10",name:"Оплаченный",status:"Выполнен",paid:true}];
  const x=fixture({tab:"history",rows});
  x.ui.renderMasterSchedule(rows);
  assert.equal(x.ordersNode.children.length,4);
  assert.equal(x.ordersNode.children.filter(n=>n.className==="master-day-heading").length,2);
  assert.equal(x.ordersNode.children.filter(n=>n.className==="master-schedule-card").length,2);
  assert.ok(!flat(x.ordersNode).some(n=>String(n.textContent).includes("Проверить дату")));
  const empty=fixture({tab:"history"});
  empty.ui.renderMasterSchedule([]);
  assert.equal(empty.ordersNode.children[0].textContent,"Выполненных заказов нет");
});
