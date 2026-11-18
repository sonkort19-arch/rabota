"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createOrdersModel}=require("../order-model.js");
function model(orders){
  return createOrdersModel({
    statuses:["Новый","Записан","В работе","Выполнен","Отменён"],
    dbRequest:async()=>[],reloadOrders:async()=>{},
    getOrders:()=>orders,getCurrentUserId:()=>null,
    getFinanceOperations:()=>[],getFinanceCollections:()=>[]
  });
}
test("invalid clock values do not create false proximity warnings",()=>{
  const orders=[
    {id:"a",date:"2026-11-15",time:"12:60",master:"Рауль",status:"Записан"},
    {id:"b",date:"2026-11-15",time:"24:00",master:"Рауль",status:"Записан"},
    {id:"c",date:"2026-11-15",time:"13:00",master:"Рауль",status:"Записан"},
    {id:"d",date:"2026-11-15",time:"13:30",master:"Рауль",status:"Отменён"}
  ];
  const m=model(orders);
  assert.deepEqual(m.findTightBookings("2026-11-15","13:00","Рауль").map(o=>o.id),["c"]);
  for(const time of ["12:60","24:00","9:30","13:xx",""]){
    assert.deepEqual(m.findTightBookings("2026-11-15",time,"Рауль"),[],time);
  }
});
test("valid HH:MM and HH:MM:SS still respect strict 200-minute boundary",()=>{
  const orders=[
    {id:"near",date:"2026-11-15",time:"15:19:00",master:"Рауль",status:"Записан"},
    {id:"edge",date:"2026-11-15",time:"15:20",master:"Рауль",status:"Записан"},
    {id:"other",date:"2026-11-15",time:"12:00",master:"Олег",status:"Записан"}
  ];
  assert.deepEqual(model(orders).findTightBookings("2026-11-15","12:00","Рауль").map(o=>o.id),["near"]);
});
