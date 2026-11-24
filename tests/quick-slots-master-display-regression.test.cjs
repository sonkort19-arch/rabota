"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {candidateSlots}=require("../quick-slots.js");

test("quick-slot master deduplication keeps the first canonical display name",()=>{
  const seen=[];
  const slots=candidateSlots({
    masters:[" Рауль ","рауль","РАУЛЬ"," Алан ","алан"],
    now:new Date("2026-11-15T05:00:00Z"),horizon:1,limit:10,
    checkTime:(time,date,master)=>{seen.push(master);return "available";}
  });
  assert.deepEqual([...new Set(seen)],["Рауль","Алан"]);
  assert.equal(slots.length,6);
  assert.deepEqual([...new Set(slots.map(slot=>slot.master))],["Рауль","Алан"]);
});
