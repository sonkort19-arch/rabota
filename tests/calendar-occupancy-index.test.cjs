"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCalendarModule}=require("../calendar-model.js");
function node(){
  return {children:[],attrs:{},value:"",textContent:"",
    replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},
    setAttribute(key,value){this.attrs[key]=value;},addEventListener(){}};
}
test("occupied days are indexed in one pass even with a large order history",()=>{
  let dateReads=0;
  const orders=Array.from({length:1000},(_,i)=>({
    status:i%3===0?"Отменён":"Записан",
    get date(){dateReads++;return i%2?"2026-11-10":"2026-11-12";}
  }));
  const elements={calendarDate:node(),weekDays:node(),ordersWeekDays:node(),ordersDayDateLabel:node()};
  const model=createCalendarModule({
    elements,make:(tag,className,text)=>Object.assign(node(),{tag,className,textContent:String(text??"")}),
    getOrders:()=>orders,getSelectedDate:()=>"2026-11-13",setSelectedDate:()=>{},
    getCurrentRole:()=>"owner",getCurrentTab:()=>"calendar",setCurrentTab:()=>{},render:()=>{}
  });
  model.renderCalendar();
  assert.equal(dateReads,orders.filter(o=>o.status!=="Отменён").length);
  const expected=[false,true,false,true,false,false,false];
  for(const strip of [elements.weekDays,elements.ordersWeekDays]){
    assert.deepEqual(strip.children.map(day=>day.className.includes("has-orders")),expected);
  }
});
