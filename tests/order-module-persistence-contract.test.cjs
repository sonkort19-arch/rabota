"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createOrdersModel}=require("../order-model.js");

function harness({orders=[],request=async()=>[{id:"saved"}],reload=async()=>{}}={}){
  const calls=[];
  const model=createOrdersModel({
    statuses:["Записан","В работе","Выполнен","Отменён"],
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
test("a confirmed write stays successful when the subsequent read fails",async()=>{
  const networkError=new Error("refresh failed");
  const {model,calls}=harness({request:async()=>[{id:"saved"}],
    reload:async()=>{throw networkError;}});
  assert.deepEqual(await model.persistOrder({...sample,id:null}),{orderId:"saved",refreshError:networkError});
  assert.equal(calls.length,1,"must not retry a successful POST");
});

test("acknowledged save exposes the persisted id for a separate payment RPC",async()=>{
  let reloads=0;
  const {model,calls}=harness({reload:async()=>{reloads++;}});
  assert.deepEqual(await model.persistOrder({...sample,id:null},{refresh:false}),
    {orderId:"saved",refreshError:null});
  assert.equal(calls.length,1);
  assert.equal(calls[0][2].paid,false);
  assert.equal(reloads,0);
});

const fullPayment={amount:10000,method:"card"};
const receipt={id:sample.id,status:"Выполнен",price:10000,paid:true,payment_amount:10000,
  payment_method:"card",payment_received_by:"company",paid_by:"owner-test"};

test("partial payment, changed amount and a cancelled order never write",()=>{
  const {model,calls}=harness();
  assert.throws(()=>model.recordFullPayment(sample,{...fullPayment,amount:9999},"company"),/полную/);
  assert.throws(()=>model.recordFullPayment({...sample,price:10001},fullPayment,"company"),/полную/);
  assert.throws(()=>model.recordFullPayment({...sample,status:"Отменён"},fullPayment,"company"),/Отменённый/);
  assert.equal(calls.length,0);
});

test("concurrent confirms and a stale order view reuse one acknowledged write",async()=>{
  const {model,calls}=harness({request:async()=>({ok:true})});
  const first=model.recordFullPayment(sample,fullPayment,"company");
  assert.equal(model.recordFullPayment(sample,fullPayment,"company"),first);
  await first;
  await model.recordFullPayment(sample,fullPayment,"company");
  assert.deepEqual(calls,[["rpc/rabota_record_order_payment","POST",{
    p_order_id:sample.id,p_amount:10000,p_method:"card"
  }]]);
});

test("an interrupted payment is checked against the exact server receipt before another write",async()=>{
  let requests=0;
  const {model,calls}=harness({request:async()=>{
    if(++requests<=2)throw new Error("Network interrupted");
    return [receipt];
  }});
  await assert.rejects(model.recordFullPayment(sample,fullPayment,"company"),/Network interrupted/);
  await model.recordFullPayment(sample,fullPayment,"company");
  assert.deepEqual(calls.map(call=>call[1]),["POST","GET","GET"]);
});

test("an ambiguous response cannot claim another actor or a different payment amount",async()=>{
  const {model,calls}=harness({request:async(path,method)=>{
    if(method==="POST")throw new Error("Network interrupted");
    return [{...receipt,paid_by:"another-owner",payment_amount:9500}];
  }});
  await assert.rejects(model.recordFullPayment(sample,fullPayment,"company"),/другими реквизитами/);
  assert.deepEqual(calls.map(call=>call[1]),["POST","GET"]);
});

test("only a completed order with its full recorded payment can be refunded",()=>{
  const {model,calls}=harness();
  const order={...sample,status:"Выполнен",paid:true,paymentAmount:10000,paymentReceivedBy:"company"};
  assert.throws(()=>model.recordFullRefund({...order,paymentAmount:9999},"Причина"),/полный возврат/);
  assert.throws(()=>model.recordFullRefund({...order,status:"В работе"},"Причина"),/полный возврат/);
  assert.throws(()=>model.recordFullRefund(order," " ),/причину/);
  assert.equal(calls.length,0);
});

test("a refund of a payment received by the master retries only the same audit request",async()=>{
  let requests=0;
  const {model,calls}=harness({request:async()=>{
    if(++requests===1)throw new Error("Connection closed");
    return {order_id:sample.id,amount:10000,refunded_at:"2026-11-24T12:00:00Z",replayed:true};
  }});
  const order={...sample,status:"Выполнен",paid:true,paymentAmount:10000,paymentReceivedBy:"master"};
  await assert.rejects(model.recordFullRefund(order,"Согласованный возврат"),/Connection closed/);
  assert.throws(()=>model.recordFullRefund(order,"Другая причина"),/теми же реквизитами/);
  assert.equal((await model.recordFullRefund(order,"Согласованный возврат")).replayed,true);
  await model.recordFullRefund(order,"Согласованный возврат");
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);
  assert.match(calls[0][2].p_request_id,/^[0-9a-f-]{36}$/i);
});
test("persistOrder URL encodes an order identifier",async()=>{
  const id="test/id?x=1";
  const {model,calls}=harness({orders:[{id}]});
  await model.persistOrder({...sample,id});
  assert.equal(calls[0][0],"rabota_orders?id=eq."+encodeURIComponent(id));
  assert.equal(calls[0][1],"PATCH");
});
