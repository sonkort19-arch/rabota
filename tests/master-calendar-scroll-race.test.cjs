"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCalendarModule}=require("../calendar-model.js");

function element(className="",text=""){
  return {className,textContent:String(text),children:[],attrs:{},listeners:{},dataset:{},
    append(...nodes){this.children.push(...nodes);},
    replaceChildren(){this.children=[];},
    setAttribute(name,value){this.attrs[name]=value;},
    addEventListener(name,handler){this.listeners[name]=handler;},
    click(){this.listeners.click();}
  };
}
function setup(){
  const elements={calendarDate:element(),weekDays:element(),ordersWeekDays:element(),ordersDayDateLabel:element()};
  let date="2026-11-13",role="master",tab="calendar",renders=0;
  const frames=[],restores=[];
  const module=createCalendarModule({
    elements,make:(_,cls,txt)=>element(cls,txt),getOrders:()=>[],
    getSelectedDate:()=>date,setSelectedDate:value=>{date=value;},
    getCurrentRole:()=>role,getCurrentTab:()=>tab,setCurrentTab:value=>{tab=value;},
    render:()=>{renders++;},verticalScrollPosition:()=>320,
    restoreVerticalScroll:value=>{restores.push(value);},
    requestAnimationFrame:fn=>{frames.push(fn);}
  });
  module.renderCalendar();
  return {elements,frames,restores,module,getDate:()=>date,getRenders:()=>renders,
    setRole:value=>{role=value;},setTab:value=>{tab=value;}};
}
test("rapid master day changes restore scroll only for the latest selected date",()=>{
  const app=setup();
  app.elements.weekDays.children.find(x=>x.dataset.date==="2026-11-10").click();
  app.elements.weekDays.children.find(x=>x.dataset.date==="2026-11-11").click();
  assert.equal(app.getDate(),"2026-11-11");
  assert.equal(app.frames.length,2);
  assert.deepEqual(app.restores,[320,320]);
  app.frames.shift()();
  assert.deepEqual(app.restores,[320,320],"stale animation must not restore scroll");
  app.frames.shift()();
  assert.deepEqual(app.restores,[320,320,320]);
  assert.equal(app.getRenders(),2);
});
test("master scroll callback does not restore after switching tabs",()=>{
  const app=setup();
  app.elements.weekDays.children.find(x=>x.dataset.date==="2026-11-13").click();
  app.setTab("finance");
  app.frames.shift()();
  assert.deepEqual(app.restores,[320]);
});
test("master scroll callback does not restore after role changes",()=>{
  const app=setup();
  app.elements.weekDays.children.find(x=>x.dataset.date==="2026-11-14").click();
  app.setRole("owner");
  app.frames.shift()();
  assert.deepEqual(app.restores,[320]);
});
