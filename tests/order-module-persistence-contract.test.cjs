"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createOrdersModel}=require("../order-model.js");

function harness({orders=[],request=async()=>[{id:"saved"}],reload=async()=>{}}={}){
  const calls=[];
  const model=createOrdersModel({
    statuses:["Новый","Записан","В работе","Выполнен","Отменён"],
    dbRequest:async(...args)=>{calls.push(args);return request(...args);},
    reloadOrders:reload,getOrders:()=>orders,getCurrentUserId:()=>"owner-test",
    getFinanceOperations:()=>[],getFinanceCollections:()=>[]
  });
  return {model,calls};
}
const sample={id:"test-order",name:"Тест",phone:"",address:"",radiatorType:"",
  radiators:1,floorLoops:0,master:"Рауль",date:"2026-11-15",time:"13:00",
  price:10000,paid:false,status:"Записан",details:""};

test("order module rejects missing dependencies before registering any writes",()=>{
  assert.throws(()=>createOrdersModel({}),/Неверные зависимости/);
  assert.throws(()=>createOrdersModel(null),/Неверные зависимости/);
});
test("empty PATCH response is a failed update and never reloads the order list",async()=>{
  let reloads=0;
  const {model,calls}=harness({orders:[{id:"test-order"}],
    request:async()=>[],reload:async()=>{reloads++;}});
  await assert.rejects(model.persistOrder(sample),/Заказ не обновлён/);
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],"PATCH");
  assert.equal(reloads,0);
});
test("empty POST response is a failed create and never reloads the order list",async()=>{
  let reloads=0;
  const {model,calls}=harness({request:async()=>[],reload:async()=>{reloads++;}});
  await assert.rejects(model.persistOrder({...sample,id:null}),/Заказ не сохранён/);
  assert.equal(calls[0][1],"POST");
  assert.equal(reloads,0);
});
test("refresh failure propagates instead of reporting a complete save",async()=>{
  const {model,calls}=harness({request:async()=>[{id:"saved"}],
    reload:async()=>{throw new Error("refresh failed");}});
  await assert.rejects(model.persistOrder({...sample,id:null}),/refresh failed/);
  assert.equal(calls.length,1,"must not retry a successful POST");
});
test("persistOrder URL encodes an order identifier",async()=>{
  const id="test/id?x=1";
  const {model,calls}=harness({orders:[{id}]});
  await model.persistOrder({...sample,id});
  assert.equal(calls[0][0],"rabota_orders?id=eq."+encodeURIComponent(id));
  assert.equal(calls[0][1],"PATCH");
});
