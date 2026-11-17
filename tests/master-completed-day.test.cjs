/* Finished orders in Raul's day view. Read-only, synthetic data only. */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createMasterUI}=require("../master-ui.js");
class N{
  constructor(tag="",css="",text=""){
    this.tag=tag;this.className=css;this.textContent=String(text??"");
    this.children=[];this.attrs={};this.dataset={};this.listeners={};
    this.hidden=false;this.type="";this.id="";
    this.classList={
      add:x=>{this.className=(this.className+" "+x).trim();},
      toggle:(x,on)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));if(on)s.add(x);else s.delete(x);this.className=[...s].join(" ");},
    };
  }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(key,value){this.attrs[key]=String(value);}
  addEventListener(type,cb){this.listeners[type]=cb;}
  click(){this.listeners.click?.();}
}
const make=(tag,css,text)=>new N(tag,css,text);
function fixture(tab="calendar",role="master"){
  const ordersNode=new N("section"),summary=new N("section");
  const opened=[];
  let currentTab=tab,currentRole=role;
  const ui=createMasterUI({
    make,parseDate:date=>new Date(date+"T12:00:00"),
    formatDate:date=>date,
    getOrders:()=>[],collectionForOrder:()=>null,
    getCurrentRole:()=>currentRole,getCurrentTab:()=>currentTab,
    doc:{getElementById:id=>id==="masterTodaySummary"?summary:null},
    ordersNode,openMasterOrderDialog:order=>opened.push(order.id),
    STATUSES:["Записан","В работе","Выполнен","Отменён"]
  });
  return {ui,ordersNode,opened,setTab:v=>currentTab=v,setRole:v=>currentRole=v};
}
const row=(id,status="Выполнен",date="2026-11-16")=>({
  id,status,date,time:"10:00",name:"Проверочный клиент",
  price:10000,paid:true,phone:"",address:"Тестовый адрес",radiators:4
});
test("completed section shows only genuine finished orders for chosen day",()=>{
  const f=fixture(),rows=[row("done"),row("cancel","Отменён"),
    row("active","Записан"),row("tomorrow","Выполнен","2026-11-17")];
  f.ui.renderMasterCompletedDay(rows,"2026-11-16");
  assert.equal(f.ordersNode.children.length,1);
  const root=f.ordersNode.children[0],toggle=root.children[0],list=root.children[1];
  assert.equal(toggle.attrs["aria-expanded"],"false");
  assert.equal(toggle.children[0].textContent,"Выполненные");
  assert.equal(toggle.children[1].textContent,"1");
  assert.equal(list.hidden,true);
  assert.equal(list.children.length,0,"closed section does not construct hidden cards");
  toggle.click();
  assert.equal(toggle.attrs["aria-expanded"],"true");
  assert.equal(list.hidden,false);
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].dataset.orderId,"done");
  list.children[0].children[0].click();
  assert.deepEqual(f.opened,["done"],"uses existing order detail action");
  toggle.click();
  assert.equal(list.hidden,true);
});
test("open state survives background rerender of same day",()=>{
  const f=fixture(),rows=[row("done")];
  f.ui.renderMasterCompletedDay(rows,"2026-11-16");
  f.ordersNode.children[0].children[0].click();
  f.ordersNode.replaceChildren();
  f.ui.renderMasterCompletedDay(rows,"2026-11-16");
  assert.equal(f.ordersNode.children[0].children[1].hidden,false);
  assert.equal(f.ordersNode.children[0].children[1].children.length,1);
});
test("changing the selected day closes completed history",()=>{
  const f=fixture(),rows=[row("first","Выполнен","2026-11-16"),
    row("second","Выполнен","2026-11-17")];
  f.ui.renderMasterCompletedDay(rows,"2026-11-16");
  f.ordersNode.children[0].children[0].click();
  f.ordersNode.replaceChildren();
  f.ui.renderMasterCompletedDay(rows,"2026-11-17");
  assert.equal(f.ordersNode.children[0].children[0].attrs["aria-expanded"],"false");
  assert.equal(f.ordersNode.children[0].children[1].hidden,true);
});
test("owners, other tabs, and days without completed work have no block",()=>{
  for(const [role,tab] of [["owner","calendar"],["manager","calendar"],["master","all"],["master","history"]]){
    const f=fixture(tab,role);f.ui.renderMasterCompletedDay([row("done")],"2026-11-16");
    assert.equal(f.ordersNode.children.length,0,role+tab);
  }
  const f=fixture();
  f.ui.renderMasterCompletedDay([row("cancel","Отменён")],"2026-11-16");
  assert.equal(f.ordersNode.children.length,0);
});
test("days with only completed jobs use a compact active empty state",()=>{
  const f=fixture();f.ui.renderMasterSchedule([],{compactEmpty:true});
  assert.equal(f.ordersNode.children[0].className,"master-active-empty");
  assert.equal(f.ordersNode.children[0].textContent,"Активных заказов нет");
  const g=fixture();g.ui.renderMasterSchedule([]);
  assert.equal(g.ordersNode.children[0].className,"empty",
    "days with no completed jobs preserve previous empty-state UI");
});
test("integration restricts completed history to Raul's selected date and assigned jobs",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"..","master-completed-day.css"),"utf8");
  assert.match(html,/src="\/master-ui\.js\?v=20261117-completed-day-v1"/);
  assert.match(html,/masterUI\.renderMasterCompletedDay\(completedForDay,selectedDate\)/);
  assert.match(html,/o\.date===selectedDate&&o\.status==="Выполнен"/);
  assert.match(html,/o\.assignedUserId===currentUser\?\.id/);
  assert.match(html,/visibleDayCount=shown\.length\+completedForDay\.length/);
  assert.match(html,/compactEmpty:completedForDay\.length>0/);
  assert.match(css,/master-completed-toggle/);
  assert.match(css,/master-completed-list\[hidden\]/);
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
