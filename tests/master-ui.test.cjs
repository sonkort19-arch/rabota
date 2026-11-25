"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createMasterUI}=require("../master-ui.js");

class FakeNode {
  constructor(tag="",css="",content=null){
    this.tag=tag;this.className=css;this.textContent=content==null?"":String(content);
    this.hidden=false;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.type="";
    this.scrolled=false;
  }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){this.listeners[k]=fn;}
  click(){this.listeners.click?.();}
  querySelector(){return null;}
  scrollIntoView(){this.scrolled=true;}
}
const make=(tag,css,content)=>new FakeNode(tag,css,content);
const parseDate=s=>{const p=s.split("-").map(Number);return new Date(p[0],p[1]-1,p[2],12);};
const formatDate=s=>!s||!/^\d{4}-\d{2}-\d{2}$/.test(s)?"Дата не указана":
  parseDate(s).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
const STATUSES=["Записан","В работе","Выполнен","Отменён"];
const newOrder=(id,overrides={})=>({
  id,date:"2099-11-15",time:"12:00",name:"Иван",address:"Ул. Мира",
  phone:"+79001234567",status:"Записан",radiators:5,floorLoops:2,
  price:10000,paid:false,...overrides
});
function setup({rows=[],role="master",tab="calendar"}={}){
  const summary=new FakeNode("section"),ordersNode=new FakeNode("section");
  const doc={
    getElementById:id=>{
      if(id==="masterTodaySummary")return summary;
      throw Error("Unknown node "+id);
    },
    querySelectorAll:()=>[]
  };
  let currentRole=role,currentTab=tab;
  const opened=[];
  const ui=createMasterUI({
    make,parseDate,formatDate,STATUSES,ordersNode,doc,
    getOrders:()=>rows,
    getCurrentRole:()=>currentRole,getCurrentTab:()=>currentTab,
    openMasterOrderDialog:order=>opened.push(order.id)
  });
  return {ui,summary,ordersNode,opened,doc,setTab:x=>{currentTab=x;},setRole:x=>{currentRole=x;}};
}
const deepTree=node=>({
  tag:node.tag,css:node.className,text:node.textContent,
  attrs:node.attrs,dataset:node.dataset,hidden:node.hidden,
  children:node.children.map(deepTree)
});
test("Moscow clock returns YYYY-MM-DD and minute-of-day",()=>{
  const {ui}=setup(),now=ui.masterClock();
  assert.match(now.date,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(now.minutes>=0&&now.minutes<1440);
});
test("time parser refuses invalid values and reads HH:MM",()=>{
  const {ui}=setup();
  assert.equal(ui.masterTimeMinutes("12:30:00"),750);
  assert.equal(ui.masterTimeMinutes("23:59"),1439);
  assert.equal(ui.masterTimeMinutes("25:00"),-1);
  assert.equal(ui.masterTimeMinutes(""),-1);
});
test("day labels and Russian order endings keep existing text",()=>{
  const {ui}=setup();
  assert.equal(ui.masterDayLabel(""),"Без даты");
  assert.equal(ui.masterOrderCount(0),"0 заказов");
  assert.equal(ui.masterOrderCount(1),"1 заказ");
  assert.equal(ui.masterOrderCount(2),"2 заказа");
  assert.equal(ui.masterOrderCount(5),"5 заказов");
  assert.equal(ui.masterOrderCount(11),"11 заказов");
  assert.equal(ui.masterOrderCount(21),"21 заказ");
});
test("working orders exclude only completed and cancelled",()=>{
  const rows=[newOrder("a"),newOrder("b",{status:"В работе"}),
    newOrder("c",{status:"Выполнен"}),newOrder("d",{status:"Отменён"})];
  const {ui}=setup({rows});
  assert.deepEqual(ui.masterWorkingOrders().map(x=>x.id),["a","b"]);
});
test("paid and unpaid completed orders remain in history outside the working queue",()=>{
  const rows=[
    newOrder("a",{date:"2099-11-16",status:"Выполнен",paid:false}),
    newOrder("b",{date:"2099-11-17",status:"Выполнен",paid:true}),
    newOrder("c",{date:"2099-11-18",status:"Выполнен",paid:true}),
    newOrder("d",{status:"Записан",paid:false})
  ];
  const {ui,ordersNode}=setup({rows,tab:"history"});
  assert.deepEqual(ui.masterWorkingOrders().map(x=>x.id),["d"]);
  ui.renderMasterSchedule(rows.filter(order=>order.status==="Выполнен"));
  assert.deepEqual(ordersNode.children.filter(node=>node.dataset.orderId).map(node=>node.dataset.orderId),["a","b","c"]);
});
test("schedule sorts future first, old orders last",()=>{
  const {ui}=setup();
  const rows=[
    newOrder("future",{date:"2099-11-20"}),
    newOrder("old",{date:"2001-01-01"}),
    newOrder("soon",{date:"2099-11-19"}),
    newOrder("none",{date:""})
  ];
  const sorted=rows.slice().sort((a,b)=>ui.masterScheduleSort(a,b,"2099-11-18"));
  assert.deepEqual(sorted.map(x=>x.id),["soon","future","old","none"]);
});
test("Raul list shows the next appointment before older orders and closed history",()=>{
  const {ui}=setup();
  const rows=[
    newOrder("tomorrow",{date:"2026-11-17",time:"10:00"}),
    newOrder("past-today",{date:"2026-11-16",time:"09:00"}),
    newOrder("later-today",{date:"2026-11-16",time:"15:00"}),
    newOrder("earliest-today",{date:"2026-11-16",time:"12:00"}),
    newOrder("older",{date:"2026-11-15",time:"18:00"}),
    newOrder("done",{date:"2026-11-16",time:"16:00",status:"Выполнен"}),
    newOrder("cancelled",{date:"2026-11-18",time:"08:00",status:"Отменён"}),
    newOrder("undated",{date:""}),
  ];
  const sorted=rows.slice().sort((a,b)=>ui.masterScheduleSort(a,b,"2026-11-16",11*60));
  assert.deepEqual(sorted.map(o=>o.id),[
    "earliest-today","later-today","tomorrow","past-today","older",
    "cancelled","done","undated"
  ]);
});
test("Raul main list passes Moscow clock to the schedule comparator",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const allStart=html.indexOf('} else if (currentTab==="all") {');
  const masterStart=html.indexOf('if(currentRole==="master") {',allStart);
  const masterEnd=html.indexOf('} else {',masterStart);
  assert.ok(allStart>=0&&masterStart>allStart&&masterEnd>masterStart,"master all-orders branch exists");
  const masterBlock=html.slice(masterStart,masterEnd);
  assert.match(masterBlock,/shown=sourceOrders\.filter\(o=>o\.assignedUserId===currentUser\?\.id\);/);
  assert.match(masterBlock,/const now=masterClock\(\);/);
  assert.match(masterBlock,/shown\.sort\(\(a,b\)=>masterScheduleSort\(a,b,now\.date,now\.minutes\)\);/);
});
test("master card preserves compact layout, dataset and action",()=>{
  const order=newOrder("a",{radiators:3,floorLoops:1,price:12500});
  const x=setup({rows:[order]}),card=x.ui.makeMasterScheduleRow(order,true);
  assert.equal(card.className,"master-schedule-card is-next");
  assert.equal(card.dataset.orderId,"a");
  assert.ok(card.dataset.search.includes("иван"));
  const toggle=card.children[0];
  assert.equal(toggle.className,"master-schedule-toggle");
  assert.equal(toggle.attrs["aria-label"],"Открыть заказ Иван, 12:00");
  assert.ok(toggle.children.some(n=>n.className==="master-schedule-work"&&n.textContent.includes("Радиаторы: 3")));
  toggle.click();assert.deepEqual(x.opened,["a"]);
});
test("completed card reports an unpaid order and keeps paid history openable",()=>{
  const x=setup();
  const card=paid=>x.ui.makeMasterScheduleRow(newOrder("b",{status:"Выполнен",paid}),false).children[0];
  const paidCard=card(true);
  assert.equal(paidCard.children.some(n=>n.className==="master-money-note"),false);
  assert.ok(card(false).children.some(n=>n.className==="master-money-note"&&n.textContent==="Оплата ещё не отмечена"));
  paidCard.click();
  assert.deepEqual(x.opened,["b"]);
});
test("schedule creates same group headings and rows for all orders",()=>{
  const rows=[
    newOrder("a",{date:"2099-11-15"}),
    newOrder("b",{date:"2099-11-15"}),
    newOrder("c",{date:"2099-11-16"})
  ];
  const {ui,ordersNode}=setup({rows,tab:"all"});
  ui.renderMasterSchedule(rows);
  assert.equal(ordersNode.children.filter(x=>x.className==="master-day-heading").length,2);
  assert.equal(ordersNode.children.filter(x=>x.className.startsWith("master-schedule-card")).length,3);
});
test("daily calendar does not insert group headers",()=>{
  const row=newOrder("a"),x=setup({rows:[row],tab:"calendar"});
  x.ui.renderMasterSchedule([row]);
  assert.equal(x.ordersNode.children.length,1);
  assert.ok(x.ordersNode.children[0].className.startsWith("master-schedule-card"));
});
test("empty history shows correct message",()=>{
  const x=setup({tab:"history"});
  x.ui.renderMasterSchedule([]);
  assert.equal(x.ordersNode.children[0].textContent,"Выполненных заказов нет");
});
test("overview shows summary and next future order",()=>{
  const rows=[newOrder("a",{date:"2099-11-16",name:"Мария"})];
  const x=setup({rows});
  x.ui.renderMasterOverview(rows);
  assert.equal(x.summary.hidden,false);
  const jump=x.summary.children.find(n=>n.className.split(/\s+/).includes("master-next-jump"));
  assert.ok(jump,"compact overview keeps the next-appointment action");
  assert.match(jump.attrs["aria-label"],/Мария/);
  jump.click();assert.deepEqual(x.opened,["a"]);
});
test("overview stays hidden for owner and when master is outside calendar",()=>{
  const rows=[newOrder("a")];
  for(const config of [{role:"owner",tab:"calendar"},{role:"master",tab:"all"}]){
    const x=setup({...config,rows});
    x.ui.renderMasterOverview(rows);
    assert.equal(x.summary.hidden,true);
  }
});
test("overdue status reviews remain available through notifications",()=>{
  const rows=[
    newOrder("overdue",{date:"2000-01-01",time:"09:00"}),
    newOrder("future",{date:"2099-11-15"}),
    newOrder("done",{date:"2000-01-01",status:"Выполнен"}),
    newOrder("progress",{date:"2000-01-01",status:"В работе"})
  ];
  const x=setup({rows});
  assert.deepEqual(x.ui.masterOrdersToReview().map(order=>order.id),["overdue"]);
  x.ui.renderMasterOverview(rows);
  assert.ok(!x.summary.children.some(n=>n.className==="master-review-list"));
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const notices=fs.readFileSync(path.join(__dirname,"..","master-notifications.js"),"utf8");
  assert.match(html,/window\.__rdMasterStatusReview=\(\)=>\{[\s\S]*?masterUI\.masterOrdersToReview\(masterWorkingOrders\(\)\.filter\([\s\S]*?order=>order\.assignedUserId===currentUser\.id/);
  assert.match(notices,/const reviews=window\.__rdMasterStatusReview\?\.\(\)\|\|\[\];/);
  assert.match(notices,/window\.__rdOpenMasterOrder\?\.\(order\.id\);/);
});
test("finance refresh does not unnecessarily replace unchanged overview",()=>{
  const rows=[newOrder("a",{date:"2099-11-18"})],x=setup({rows});
  x.ui.renderMasterOverview(rows);
  const oldChildren=x.summary.children;
  x.ui.renderMasterOverview(rows);
  assert.equal(oldChildren,x.summary.children);
});
test("master module loads before inline use and completion delegates to server payment",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const script=html.match(/src="\/master-ui\.js\?v=[^"]+"/);
  assert.ok(script&&script.index<html.indexOf("const masterUI=window.__rdCreateMasterUI"));
  assert.match(html,/masterUI\.resetReviewOpen\(\)/);
  for(const name of ["masterClock","makeMasterScheduleRow","renderMasterOverview","renderMasterSchedule"]){
    assert.match(html,new RegExp("masterUI\\."+name+"\\("));
  }
  assert.match(html,/await orderModel\.recordFullPayment\(order,decision,receiver\)/);
  assert.match(html,/await dbRequest\("rpc\/rabota_master_action","POST"/);
  assert.doesNotMatch(html,/rpc\/rabota_cash_(?:distribute|submit|confirm)/);
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
