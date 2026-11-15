"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCalendarModule}=require("../calendar-model.js");

function element(){
  return {children:[],attrs:{},textContent:"",value:"",
    replaceChildren(){this.children=[];},
    append(...items){this.children.push(...items);},
    setAttribute(key,value){this.attrs[key]=value;},
    addEventListener(){}
  };
}
test("cancelled-only dates stay unmarked in both calendar strips",()=>{
  const elements={calendarDate:element(),weekDays:element(),ordersWeekDays:element(),ordersDayDateLabel:element()};
  const orders=[
    {date:"2026-11-09",status:"Отменён"},
    {date:"2026-11-10",status:"Записан"},
    {date:"2026-11-11",status:"Отменён"},
    {date:"2026-11-11",status:"В работе"},
    {date:"2026-11-12",status:"Отменён"}
  ];
  const module=createCalendarModule({
    elements,make:(_,className,text)=>Object.assign(element(),{className,textContent:String(text??"")}),
    getOrders:()=>orders,getSelectedDate:()=>"2026-11-11",setSelectedDate:()=>{},
    getCurrentRole:()=>"owner",getCurrentTab:()=>"calendar",
    setCurrentTab:()=>{},render:()=>{}
  });
  module.renderCalendar();
  const expected=[false,true,true,false,false,false,false];
  for(const strip of [elements.weekDays,elements.ordersWeekDays]){
    assert.equal(strip.children.length,7);
    assert.deepEqual(strip.children.map(day=>day.className.includes("has-orders")),expected);
    assert.deepEqual(strip.children.map(day=>day.attrs["aria-pressed"]),["false","false","true","false","false","false","false"]);
    assert.ok(strip.children.every(day=>day.attrs["aria-label"]));
  }
});
