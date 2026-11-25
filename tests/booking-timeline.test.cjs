/* No-write regression tests: estimated time range is not a guarantee. */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {estimate,forDay,findAt,format}=require("../booking-timeline.js");
const city=()=>30,far=()=>60;
const order=(o={})=>({id:"a",date:"2026-11-21",master:"Рауль",
  status:"Записан",time:"11:00",radiators:4,floorLoops:0,
  name:"Артур",...o});
test("four radiators plus city trip: 11:00–12:50 is an estimate",()=>{
  const b=estimate(order(),city);
  assert.equal(b.start,660);assert.equal(b.end,770);assert.equal(b.estimated,true);
  assert.equal(format(b.start),"11:00");assert.equal(format(b.end),"12:50");
});
test("floor circuits and out-of-town travel are included in approximate end",()=>{
  assert.equal(estimate(order({floorLoops:2}),far).end,660+80+20+60);
});
test("unknown scope shows start but never invents a finish",()=>{
  const b=estimate(order({radiators:null,floorLoops:null}),city);
  assert.equal(b.end,null);assert.equal(b.estimated,false);
  assert.equal(findAt([order({radiators:null,floorLoops:null})],"12:30",
    "2026-11-21","Рауль",null,city),null);
});
test("estimated busy starts at appointment and ends at estimate, not at 200min",()=>{
  const rows=[order()];
  assert.equal(findAt(rows,"10:00","2026-11-21","Рауль",null,city),null);
  assert.equal(findAt(rows,"11:00","2026-11-21","Рауль",null,city).name,"Артур");
  assert.equal(findAt(rows,"12:30","2026-11-21","Рауль",null,city).name,"Артур");
  assert.equal(findAt(rows,"12:50","2026-11-21","Рауль",null,city),null);
  assert.equal(findAt(rows,"15:00","2026-11-21","Рауль",null,city),null);
});
test("exclude editing record, cancelled, completed, wrong date and other masters",()=>{
  const rows=[order(),order({id:"b",status:"Выполнен",time:"14:00"}),
    order({id:"c",status:"Отменён",time:"16:00"}),order({id:"d",master:"Алан"})];
  assert.equal(forDay(rows,"2026-11-21","рауль",null,city).length,1);
  assert.equal(findAt(rows,"11:20","2026-11-21","рауль","a",city),null);
  assert.equal(findAt(rows,"11:20","2026-11-22","рауль",null,city),null);
});
test("start and end format handles midnight safely",()=>{
  assert.equal(format(1500),"01:00 (+1 дн.)");
  assert.equal(estimate(order({time:"23:00"}),city).end,1490);
});
test("a late active order remains busy on the following date until the estimated finish",()=>{
  const rows=[order({date:"2026-12-01",time:"23:00",radiators:10})];
  const next="2026-12-02";
  const overlap=findAt(rows,"00:30",next,"Рауль",null,city);
  assert.equal(overlap.date,"2026-12-01");
  assert.equal(format(overlap.start),"23:00");
  assert.equal(format(overlap.end),"02:50 (+1 дн.)");
  assert.equal(findAt(rows,"00:00",next,"Рауль",null,city)?.id,"a");
  assert.equal(findAt(rows,"02:49",next,"Рауль",null,city)?.id,"a");
  assert.equal(findAt(rows,"02:50",next,"Рауль",null,city),null);
  assert.deepEqual(forDay(rows,"2026-12-03","Рауль",null,city),[]);
  assert.equal(findAt(rows,"00:30",next,"Рауль","a",city),null);
  for(const status of ["Выполнен","Отменён"])
    assert.equal(findAt([{...rows[0],status}],"00:30",next,"Рауль",null,city),null);
});
test("availability compares Moscow appointment dates across month and year boundaries",()=>{
  const rows=[order({date:"2026-12-31",time:"23:00",radiators:10}),
    order({date:"2027-01-01",id:"next",time:"03:30"})];
  assert.deepEqual(forDay(rows,"2027-01-01","Рауль",null,city).map(block=>block.id),["a","next"]);
  assert.equal(findAt(rows,"00:30","2027-01-01","Рауль",null,city)?.id,"a");
  assert.deepEqual(forDay([order({date:"2026-12-31",time:"23:10",radiators:1})],
    "2027-01-01","Рауль",null,city),[],"an estimate ending at midnight does not occupy the next day");
});
