"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../quick-slots.js");
const source=fs.readFileSync(path.join(__dirname,"../order-availability.js"),"utf8");

function availability(rows) {
  const window={};
  const elements=new Map();
  const document={
    getElementById(id){
      if(!elements.has(id))elements.set(id,{addEventListener(){}});
      return elements.get(id);
    }
  };
  vm.runInNewContext(source,{window,document,Date,Intl,console});
  const api=window.__rdOrderAvailability;
  assert.ok(api,"Existing editor availability module is available");
  api.refresh(rows);
  return api;
}
const slotTest=(api,masters,now,limit=14)=>core.candidateSlots({
  masters,now:new Date(now),limit,
  checkTime:(time,date,master)=>api.checkTime(time,date,master)
});
test("Moscow clock not device timezone; excludes already-started and imminent slots",()=>{
  const now=new Date("2026-11-09T06:50:00Z"); // 09:50 Moscow
  assert.deepEqual(core.moscowClock(now),{today:"2026-11-09",minutes:590});
  const result=slotTest(availability([]),["Рауль"],now.toISOString());
  assert.equal(result[0].date,"2026-11-09");
  assert.equal(result[0].time,"15:00");
  assert.ok(!result.some(s=>s.date==="2026-11-09"&&s.time==="10:00"));
  assert.equal(core.addDay("2026-12-31",1),"2027-01-01");
});
test("Existing 2 orders/day rule blocks entire day",()=>{
  const api=availability([
    {date:"2026-11-10",time:"10:00",master:"Рауль",status:"Записан"},
    {date:"2026-11-10",time:"15:00",master:"Рауль",status:"В работе"}
  ]);
  const found=slotTest(api,["Рауль"],"2026-11-10T05:00:00Z");
  assert.ok(!found.some(x=>x.date==="2026-11-10"));
  assert.equal(api.checkTime("18:00","2026-11-10","Рауль"),"full");
});
test("200-minute gap, exact collision, unknown time and canceled orders",()=>{
  const api=availability([
    {date:"2026-11-10",time:"15:00",master:"Рауль",status:"Записан"},
    {date:"2026-11-11",time:"",master:"Рауль",status:"Новый"},
    {date:"2026-11-12",time:"10:00",master:"Рауль",status:"Отменён"}
  ]);
  assert.equal(api.checkTime("15:00","2026-11-10","Рауль"),"busy");
  assert.equal(api.checkTime("18:00","2026-11-10","Рауль"),"tight");
  assert.equal(api.checkTime("10:00","2026-11-10","Рауль"),"available");
  assert.equal(api.checkTime("10:00","2026-11-11","Рауль"),"unknown");
  assert.equal(api.checkTime("10:00","2026-11-12","Рауль"),"available");
  const found=slotTest(api,["Рауль"],"2026-11-10T05:00:00Z");
  assert.ok(found.some(s=>s.date==="2026-11-10"&&s.time==="10:00"));
  assert.ok(!found.some(s=>s.date==="2026-11-10"&&s.time==="18:00"));
  assert.ok(!found.some(s=>s.date==="2026-11-11"));
});
test("Two different masters can book the same time; names deduplicate case-insensitively",()=>{
  const api=availability([
    {date:"2026-11-10",time:"10:00",master:"Рауль",status:"Записан"}
  ]);
  assert.equal(api.checkTime("10:00","2026-11-10","Рауль"),"busy");
  assert.equal(api.checkTime("10:00","2026-11-10","Олег"),"available");
  const found=slotTest(api,["Рауль","Олег","ОЛЕГ"],"2026-11-10T05:00:00Z");
  assert.equal(found.filter(s=>s.date==="2026-11-10"&&s.time==="10:00").length,1);
  assert.equal(found.find(s=>s.date==="2026-11-10"&&s.time==="10:00").master,"ОЛЕГ");
});
test("Quick selection fills unsaved order and refreshes before display/selection",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  const redesign=fs.readFileSync(path.join(__dirname,"../redesign.js"),"utf8");
  assert.ok(html.includes("await reloadOrders();"));
  assert.ok(html.includes("window.__rdQuickSlotsRead=async"));
  assert.ok(html.includes("window.__rdQuickSlotFill="));
  assert.ok(html.includes("window.__rdOrderAvailability?.checkTime(time,date,master)"));
  assert.ok(html.includes("openForm();"));
  assert.ok(html.includes('src="/quick-slots.js"'));
  assert.ok(redesign.includes("rd-quick-slot-hero"));
  assert.ok(redesign.includes("rd-cal-slots"));
  assert.ok(redesign.includes("rd-orders-quick-slots"));
});
