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
const STATUSES=["Новый","Записан","В работе","Выполнен","Отменён"];
const newOrder=(id,overrides={})=>({
  id,date:"2099-11-15",time:"12:00",name:"Иван",address:"Ул. Мира",
  phone:"+79001234567",status:"Записан",radiators:5,floorLoops:2,
  price:10000,paid:false,...overrides
});
function setup({rows=[],role="master",tab="calendar",collections=[]}={}){
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
    collectionForOrder:id=>collections.find(x=>String(x.order_id)===String(id))||null,
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
test("settlements include unpaid completed or unconfirmed collections",()=>{
  const rows=[
    newOrder("a",{date:"2099-11-16",status:"Выполнен",paid:false}),
    newOrder("b",{date:"2099-11-17",status:"Выполнен",paid:true}),
    newOrder("c",{date:"2099-11-18",status:"Выполнен",paid:true}),
    newOrder("d",{status:"Записан",paid:false})
  ];
  const collections=[
    {order_id:"b",confirmed_at:null},
    {order_id:"c",confirmed_at:"2099-11-18T18:00:00Z"}
  ];
  const {ui}=setup({rows,collections});
  assert.deepEqual(ui.masterSettlementOrders().map(x=>x.id),["b","a"]);
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
test("paid completed card shows an unconfirmed money status",()=>{
  const order=newOrder("b",{status:"Выполнен",paid:true});
  const x=setup({rows:[order],collections:[{order_id:"b",company_amount:3500}]});
  const card=x.ui.makeMasterScheduleRow(order,false);
  assert.ok(card.children[0].children.some(n=>n.className==="master-money-note"&&n.textContent.includes("расчёт")));
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
  assert.ok(x.summary.children.some(n=>n.className==="master-next-jump"));
});
test("overview stays hidden for owner and when master is outside calendar",()=>{
  const rows=[newOrder("a")];
  for(const config of [{role:"owner",tab:"calendar"},{role:"master",tab:"all"}]){
    const x=setup({...config,rows});
    x.ui.renderMasterOverview(rows);
    assert.equal(x.summary.hidden,true);
  }
});
test("review overdue orders can expand and reset",()=>{
  const rows=[newOrder("a",{date:"2000-01-01",time:"09:00"})];
  const x=setup({rows});x.ui.renderMasterOverview(rows);
  const review=x.summary.children.find(n=>n.className.includes("master-review-jump"));
  assert.ok(review);
  assert.equal(review.attrs["aria-expanded"],"false");
  review.click();
  assert.ok(x.summary.children.some(n=>n.className==="master-review-list"));
  x.ui.resetReviewOpen();
  x.ui.renderMasterOverview(rows);
  assert.ok(!x.summary.children.some(n=>n.className==="master-review-list"));
});
test("finance refresh does not unnecessarily replace unchanged overview",()=>{
  const rows=[newOrder("a",{date:"2099-11-18"})],x=setup({rows});
  x.ui.renderMasterOverview(rows);
  const oldChildren=x.summary.children;
  x.ui.renderMasterOverview(rows);
  assert.equal(oldChildren,x.summary.children);
});
test("master module loaded before inline use, payment RPCs unchanged",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/master-ui\.js\?v=20261113-stage6"/);
  assert.ok(html.indexOf('src="/master-ui.js?v=20261113-stage6"')<
    html.indexOf("const masterUI=window.__rdCreateMasterUI"));
  assert.match(html,/masterUI\.resetReviewOpen\(\)/);
  for(const name of ["masterClock","makeMasterScheduleRow","renderMasterOverview","renderMasterSchedule"]){
    assert.match(html,new RegExp("masterUI\\."+name+"\\("));
  }
  for(const rpc of ["rabota_record_order_payment","rabota_cash_distribute","rabota_master_action","rabota_salary_payout_v2"]){
    assert.ok(html.includes("rpc/"+rpc),"missing RPC "+rpc);
  }
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
