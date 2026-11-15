"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {candidateSlots,inspectDay,moscowClock}=require("../quick-slots.js");

test("Moscow clock controls near-midnight slot suggestions regardless of UTC day",()=>{
  const now=new Date("2026-11-15T20:50:00Z"); // Moscow: Nov 15, 23:50
  assert.deepEqual(moscowClock(now),{today:"2026-11-15",minutes:23*60+50});
  const checked=[];
  const slots=candidateSlots({masters:["Рауль"],now,horizon:2,limit:10,
    checkTime:(time,date,master)=>{checked.push([time,date,master]);return "available";}});
  assert.equal(slots.length,3);
  assert.ok(slots.every(s=>s.date==="2026-11-16"));
  assert.deepEqual(slots.map(s=>s.time),["10:00","15:00","18:00"]);
  assert.ok(checked.every(([,date])=>date==="2026-11-16"));
});

test("quick slots deduplicate master names case-insensitively without losing ordering",()=>{
  const slots=candidateSlots({masters:[" Рауль ","рауль","АЛАН","Алан",""],now:new Date("2026-11-15T05:00:00Z"),
    horizon:1,limit:20,checkTime:()=>"available"});
  assert.equal(slots.length,6);
  assert.equal(new Set(slots.map(s=>s.master)).size,2);
  assert.deepEqual([...new Set(slots.map(s=>s.master))],["Рауль","АЛАН"]);
});

test("selected-day inspection never queries expired slots and does not mark uncertain as bookable",()=>{
  const now=new Date("2026-11-15T11:45:00Z"); // Moscow: 14:45
  const checked=[];
  const slots=inspectDay({date:"2026-11-15",masters:["Рауль"],now,
    checkTime:(time)=>{checked.push(time);return "unknown";}});
  assert.deepEqual(checked,["18:00"]);
  assert.deepEqual(slots.map(s=>s.state),["past","past","unknown"]);
  assert.ok(slots.every(s=>s.selectable===false));
});
