"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {rescheduleSlots,rescheduleTimeState}=require("../quick-slots.js");

const now=new Date("2026-11-25T05:00:00Z");
const move={id:"moving",date:"2026-11-25",time:"15:00",status:"Записан",
  master:"Рауль",assignedUserId:"raul",radiators:4,floorLoops:2,address:"Владикавказ"};
const booking=fields=>({...move,id:"other",...fields});
const times=slots=>slots.map(({date,time})=>date+" "+time);
const state=(date,time,orders=[],order=move)=>rescheduleTimeState({date,time,orders,order,now});

test("returns the next three free standard slots for this master and recommends only the first",()=>{
  const slots=rescheduleSlots({order:move,now,orders:[
    move,
    booking({time:"10:00"}),
    booking({time:"18:00",master:"Рауль",assignedUserId:"second-master"}),
    booking({time:"18:00",status:"Отменён"})
  ]});
  assert.deepEqual(times(slots),["2026-11-25 18:00","2026-11-26 10:00","2026-11-26 15:00"]);
  assert.deepEqual(slots.map(slot=>slot.recommended),[true,false,false]);
});

test("excludes the order being moved from occupancy without suggesting its unchanged time",()=>{
  assert.equal(state(move.date,"14:45",[move]),"available");
  assert.equal(state(move.date,move.time,[move]),"same");
  assert.equal(state(move.date,"15:15",[move]),"available");
});

test("checks the visit and its travel against orders on both sides of midnight",()=>{
  const yearEnd="2026-12-31",newYear="2027-01-01";
  const late=booking({date:yearEnd,time:"23:00",radiators:10,floorLoops:0});
  assert.equal(state(newYear,"02:49",[late]),"busy");
  assert.equal(state(newYear,"02:50",[late]),"available");
  const moved={...move,radiators:10,floorLoops:0};
  assert.equal(state(yearEnd,"23:00",[booking({date:newYear,time:"02:49"})],moved),"busy");
  assert.equal(state(yearEnd,"23:00",[booking({date:newYear,time:"02:50"})],moved),"available");
});

test("takes heating circuits and longer out-of-town travel into account",()=>{
  const outskirts={...move,address:"Беслан",radiators:2,floorLoops:3};
  const earlier=booking({time:"10:00",address:"Владикавказ",radiators:2,floorLoops:3});
  assert.equal(state(move.date,"11:39",[earlier],outskirts),"busy");
  assert.equal(state(move.date,"11:40",[earlier],outskirts),"available");
  assert.equal(state(move.date,"10:00",[booking({time:"12:09"})],outskirts),"busy");
  assert.equal(state(move.date,"10:00",[booking({time:"12:10"})],outskirts),"available");
});

test("unknown scope uses the standard visit while completed orders occupy only their exact start",()=>{
  const unknown=booking({time:"10:00",address:"село Фиагдон",radiators:null,floorLoops:0});
  assert.equal(state(move.date,"13:59",[unknown]),"busy");
  assert.equal(state(move.date,"14:00",[unknown]),"available");
  const completed={...unknown,status:"Выполнен"};
  assert.equal(state(move.date,"10:00",[completed]),"busy");
  assert.equal(state(move.date,"10:01",[completed]),"available");
});

test("legacy master names are matched without case or whitespace, while IDs win over names",()=>{
  assert.equal(state(move.date,"11:00",[booking({time:"10:00",master:" РаУЛь ",assignedUserId:null})]),"busy");
  assert.equal(state(move.date,"11:00",[booking({time:"10:00",master:"Р. Алиев"})]),"busy");
  assert.equal(state(move.date,"11:00",[booking({time:"10:00",assignedUserId:"somebody-else"})]),"available");
});

test("an assigned order can move even if its legacy master label is blank",()=>{
  const order={...move,master:""};
  const orders=[booking({time:"10:00",master:""})];
  assert.equal(state(move.date,"10:30",orders,order),"busy");
  assert.equal(rescheduleSlots({order,orders,now})[0].time,"18:00");
});

test("checks manual times in Moscow, including the twenty-minute lead across midnight",()=>{
  const late=new Date("2026-11-25T20:50:00Z"); // 23:50 Moscow
  const clockState=(date,time)=>rescheduleTimeState({date,time,now:late,order:move,orders:[]});
  assert.equal(clockState("2026-11-26","00:09"),"past");
  assert.equal(clockState("2026-11-26","00:11"),"available");
  assert.equal(clockState("2026-11-31","10:00"),"unknown");
  assert.equal(clockState("2026-11-26","00:11:10"),"unknown");
  assert.deepEqual(times(rescheduleSlots({order:move,orders:[],now:late})),
    ["2026-11-26 10:00","2026-11-26 15:00","2026-11-26 18:00"]);
});

test("selected date and a rejected slot return other available choices",()=>{
  const date="2026-12-30";
  const unavailable=[{date,time:"10:00"}];
  const slots=rescheduleSlots({order:move,orders:[],now,date,unavailable});
  assert.deepEqual(times(slots),["2026-12-30 15:00","2026-12-30 18:00"]);
  assert.equal(slots[0].recommended,true);
  assert.equal(rescheduleTimeState({order:move,orders:[],now,date,time:"10:00",unavailable}),"busy");
  assert.equal(rescheduleTimeState({order:move,orders:[],now,date,time:"12:25",unavailable}),"available");
});
