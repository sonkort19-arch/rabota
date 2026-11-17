/* Read-only estimates only: no database writes or booking restrictions. */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {estimateDay,travelMinutes,quantity,appointmentMinutes}=require("../calendar-load.js");
const date="2026-11-17";
const order=(overrides={})=>({
  date,status:"Записан",time:"10:00",radiators:5,floorLoops:0,
  address:"Владикавказ, Ардонская 196",...overrides
});
test("green only when no active orders; cancelled bookings never block",()=>{
  assert.equal(estimateDay([],date).level,"free");
  assert.equal(estimateDay([order({status:"Отменён"})],date).level,"free");
  assert.equal(estimateDay([order({date:"2026-11-18"})],date).level,"free");
});
test("one standard five-radiator city booking is yellow",()=>{
  const r=estimateDay([order()],date);
  assert.equal(r.level,"light");assert.equal(r.count,1);
  assert.equal(r.workMinutes,100);assert.equal(r.travelMinutes,30);
  assert.equal(r.minutes,130);
});
test("two small jobs can be orange, while a large job can be red",()=>{
  const two=estimateDay([order({radiators:4}),order({radiators:4,time:"13:00"})],date);
  assert.equal(two.minutes,220);
  assert.equal(two.level,"busy");
  const big=estimateDay([order({radiators:23})],date);
  assert.equal(big.minutes,490);
  assert.equal(big.level,"full");
});
test("floor contours count as ten minutes; explicit far trips count as an hour",()=>{
  const r=estimateDay([order({radiators:4,floorLoops:6,address:"с. Гизель"})],date);
  assert.equal(r.workMinutes,4*20+6*10);
  assert.equal(r.travelMinutes,60);
  assert.equal(r.minutes,200);
  assert.equal(r.level,"busy");
  assert.equal(travelMinutes("ул. Ардонская, 196, Владикавказ"),30);
  assert.equal(travelMinutes("СНТ Наука"),60);
  assert.equal(travelMinutes("Верхний Фиагдон"),60);
  assert.equal(travelMinutes("пос. Южный"),60);
});
test("fragmented 10-18 schedule can be full despite moderate nominal minutes",()=>{
  const r=estimateDay([
    order({time:"10:00"}),
    order({time:"13:00"}),
    order({time:"16:00"})
  ],date);
  assert.equal(r.minutes,390);
  assert.ok(r.longestFreeMinutes<130);
  assert.equal(r.level,"full");
});
test("08:00 and 19:00 remain valid flexible appointments",()=>{
  const early=estimateDay([order({time:"08:00"})],date);
  const late=estimateDay([order({time:"19:00"})],date);
  assert.equal(appointmentMinutes("08:00"),480);
  assert.equal(appointmentMinutes("19:00"),1140);
  assert.equal(early.count,1);assert.equal(late.count,1);
  assert.equal(early.level,"light");assert.equal(late.level,"light");
});
test("incomplete order data never masquerades as a free day",()=>{
  const r=estimateDay([order({radiators:null,floorLoops:null,time:""})],date);
  assert.equal(r.level,"light");
  assert.equal(r.incomplete,true);
  assert.match(r.label,/неполная/);
  assert.equal(quantity(""),null);
  assert.equal(quantity(-5),null);
});
