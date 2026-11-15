"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCalendarModule}=require("../calendar-model.js");

function element(){
  const listeners={};
  return {
    value:"",listeners,children:[],
    addEventListener(type,handler){listeners[type]=handler;},
    click(){assert.equal(typeof listeners.click,"function");listeners.click();},
    change(value){this.value=value;assert.equal(typeof listeners.change,"function");listeners.change();},
    replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},
    setAttribute(){}
  };
}
function fixture(role="owner"){
  const ids=Object.fromEntries([
    "prevWeek","nextWeek","goToday","rdOrdersPrevWeek","rdOrdersNextWeek",
    "rdOrdersToday"
  ].map(id=>[id,element()]));
  const elements={calendarDate:element(),weekDays:element(),ordersWeekDays:element(),
    ordersDayDateLabel:element()};
  let date="2026-12-31",tab="orders",renders=0;
  const app=createCalendarModule({
    elements,getElement:id=>ids[id],masterClock:()=>({date:"2027-01-04"}),
    make:()=>element(),getOrders:()=>[],getSelectedDate:()=>date,
    setSelectedDate:value=>{date=value;},getCurrentRole:()=>role,
    getCurrentTab:()=>tab,setCurrentTab:value=>{tab=value;},render:()=>{renders++;}
  });
  app.bindNavigation();
  return {ids,elements,getDate:()=>date,getTab:()=>tab,getRenders:()=>renders};
}
test("both week navigation strips cross the year boundary without changing day of week",()=>{
  const app=fixture();
  app.ids.nextWeek.click();
  assert.equal(app.getDate(),"2027-01-07");
  app.ids.rdOrdersPrevWeek.click();
  assert.equal(app.getDate(),"2026-12-31");
  app.ids.prevWeek.click();
  assert.equal(app.getDate(),"2026-12-24");
  app.ids.rdOrdersNextWeek.click();
  assert.equal(app.getDate(),"2026-12-31");
  assert.equal(app.getRenders(),4);
  assert.equal(app.getTab(),"calendar");
});
test("master today shortcut uses Moscow master clock on both navigation strips",()=>{
  const app=fixture("master");
  app.ids.goToday.click();
  assert.equal(app.getDate(),"2027-01-04");
  app.ids.prevWeek.click();
  app.ids.rdOrdersToday.click();
  assert.equal(app.getDate(),"2027-01-04");
  assert.equal(app.getRenders(),3);
});
test("native date input change updates selection and renders once",()=>{
  const app=fixture();
  app.elements.calendarDate.change("2027-02-01");
  assert.equal(app.getDate(),"2027-02-01");
  assert.equal(app.getRenders(),1);
  app.elements.calendarDate.change("");
  assert.equal(app.getDate(),"2027-02-01");
  assert.equal(app.getRenders(),1);
});
