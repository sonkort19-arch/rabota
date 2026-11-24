"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCalendarModule}=require("../calendar-model.js");

function node(){
  return {children:[],attrs:{},dataset:{},textContent:"",value:"",
    replaceChildren(){this.children=[];},
    append(...items){this.children.push(...items);},
    setAttribute(key,value){this.attrs[key]=value;},
    addEventListener(){},
  };
}
function calendar(orders,selectedDate="2026-11-13"){
  const elements={calendarDate:node(),weekDays:node(),ordersWeekDays:node(),ordersDayDateLabel:node()};
  const module=createCalendarModule({
    elements,make:(tag,className,text)=>Object.assign(node(),{tag,className,textContent:String(text??"")}),
    getOrders:()=>orders,getSelectedDate:()=>selectedDate,setSelectedDate:()=>{},
    getCurrentRole:()=>"owner",getCurrentTab:()=>"calendar",setCurrentTab:()=>{},render:()=>{}
  });
  module.renderCalendar();
  return elements;
}
test("both calendar strips agree on occupied dates with cancelled and duplicate orders",()=>{
  const orders=[
    {date:"2026-11-09",status:"Отменён"},
    {date:"2026-11-10",status:"Отменён"},
    {date:"2026-11-10",status:"Записан"},
    {date:"2026-11-10",status:"Отменён"},
    {date:"2026-11-12",status:"Выполнен"},
    {date:"2026-11-15",status:"Новый"},
    {date:"2026-11-16",status:"Записан"}
  ];
  const before=structuredClone(orders);
  const view=calendar(orders);
  const expected=[false,true,false,true,false,false,true];
  for(const strip of [view.weekDays,view.ordersWeekDays]){
    assert.equal(strip.children.length,7);
    assert.deepEqual(strip.children.map(button=>button.className.includes("has-orders")),expected);
  }
  assert.deepEqual(orders,before,"rendering must not change order data");
});
test("large unrelated order history cannot mark an empty visible week",()=>{
  const orders=Array.from({length:1500},(_,i)=>({
    date:i%2?"2026-11-02":"2026-11-23",status:"Записан"
  }));
  const view=calendar(orders);
  for(const strip of [view.weekDays,view.ordersWeekDays]){
    assert.equal(strip.children.length,7);
    assert.ok(strip.children.every(button=>!button.className.includes("has-orders")));
  }
});
