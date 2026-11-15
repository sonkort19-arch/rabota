"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {weekDates,addDays,canPrefillSlot}=require("../calendar-model.js");
test("calendar week is Monday-first across year and leap boundaries",()=>{
  for(const [selected,monday,sunday] of [
    ["2024-02-29","2024-02-26","2024-03-03"],
    ["2026-12-31","2026-12-28","2027-01-03"],
    ["2027-01-01","2026-12-28","2027-01-03"]
  ]){
    const week=weekDates(selected);
    assert.equal(week.monday,monday);
    assert.equal(week.sunday,sunday);
    assert.equal(week.days.length,7);
    assert.equal(new Set(week.days).size,7);
    assert.equal(week.days[0],monday);
    assert.equal(week.days[6],sunday);
    for(let i=1;i<7;i++)assert.equal(week.days[i],addDays(week.days[i-1],1));
  }
});
test("slot prefill requires valid time and checks availability exactly once",()=>{
  const slot={role:"owner",date:"2026-11-15",time:"09:30",master:"Рауль"};
  let calls=0;
  assert.equal(canPrefillSlot(slot,(time,date,master)=>{
    calls++;assert.deepEqual([time,date,master],["09:30","2026-11-15","Рауль"]);
    return "available";
  }),true);
  assert.equal(calls,1);
  for(const time of ["24:00","12:60","9:30","-1:00",""]){
    assert.equal(canPrefillSlot({...slot,time},()=>{throw Error("must not call");}),false);
  }
});
test("slot prefill never accepts busy or unknown availability",()=>{
  const slot={role:"manager",date:"2026-11-15",time:"13:00",master:"Рауль"};
  for(const status of ["busy","cancelled",null,undefined,false]){
    assert.equal(canPrefillSlot(slot,()=>status),false);
  }
  assert.equal(canPrefillSlot(slot,()=>"tight"),true);
});
