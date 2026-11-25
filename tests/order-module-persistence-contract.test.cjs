"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {webcrypto}=require("node:crypto");
const {createOrdersModel}=require("../order-model.js");
const {createWriteIntents}=require("../app-services.js");

const actor="owner-test";
const version="2026-11-15T09:00:00.321098+00:00";
function testStorage(){
  const keys=new Map();
  return {getItem:key=>keys.get(key),setItem:(key,value)=>keys.set(key,value),removeItem:key=>keys.delete(key)};
}
function harness({orders=[],storage=testStorage(),request=async(path,method,data)=>
  [{...data,id:method==="PATCH"?new URL(path,"https://crm.test").searchParams.get("id").slice(3):data.id,created_by:actor}],
  reload=async()=>{}}={}){
  const calls=[];
  const model=createOrdersModel({
    statuses:["Записан","В работе","Выполнен","Отменён"],
    dbRequest:async(...args)=>{calls.push(args);return request(...args);},
    reloadOrders:reload,getOrders:()=>orders,getCurrentUserId:()=>actor,
    getFinanceOperations:()=>[],
    writeIntents:createWriteIntents("test-order",{getStorage:()=>storage,crypto:webcrypto}),
    refundIntents:createWriteIntents("test-refund",{getStorage:()=>storage,crypto:webcrypto})
  });
  return {model,calls};
}
const sample={id:"test-order",name:"Тест",phone:"",address:"",radiatorType:"",
  radiators:1,floorLoops:0,master:"Рауль",date:"2026-11-15",time:"13:00",
  price:10000,paid:false,status:"Записан",details:"",updatedAt:version};

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
  await assert.rejects(model.persistOrder({...sample,id:null}),/Сохранение заказа не подтверждено/);
  assert.equal(calls[0][1],"POST");
  assert.equal(reloads,0);
});
test("unavailable storage prevents all data requests before and after reopening",async()=>{
  const storage=testStorage();
  storage.setItem=()=>{throw new DOMException("Synthetic quota exceeded","QuotaExceededError");};
  for(let i=0;i<2;i++){
    const {model,calls}=harness({storage});
    await assert.rejects(model.persistOrder({...sample,id:null,status:"Отменён"}),{code:"WRITE_INTENT_STORAGE"});
    assert.deepEqual(calls,[]);
  }
});
test("declining a new booking check releases only the unsent operation",async()=>{
  const entries=new Map();
  const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  const {model,calls}=harness({storage,request:async()=>{throw new Error("Connection lost");}});
  const order={...sample,id:null};
  assert.equal(await model.persistOrder(order,{beforeWrite:()=>false}),null);
  assert.equal(entries.size,0);
  assert.deepEqual(calls,[]);

  const attempt={};
  await assert.rejects(model.persistOrder(order,{attempt}),/Сохранение заказа не подтверждено/);
  const pending=[...entries];
  assert.equal(pending.length,1);
  assert.equal(await model.persistOrder(order,{attempt,beforeWrite:()=>false}),null);
  assert.deepEqual([...entries],pending,"a cancellation cannot discard a prior uncertain write");
});
test("confirmed creation and refund remain successful when storage cleanup fails",async t=>{
  t.mock.method(console,"warn",()=>{});
  const storage=testStorage();
  storage.removeItem=()=>{throw new DOMException("Synthetic storage failure","SecurityError");};
  const creation=harness({storage});
  const saved=await creation.model.persistOrder({...sample,id:null});
  assert.equal(saved.orderId,creation.calls[0][2].id);

  const receipt={order_id:sample.id,amount:10000,refunded_at:"2026-11-25T12:00:00Z",replayed:false};
  const refund=harness({storage,request:async()=>receipt});
  const paid={...sample,status:"Выполнен",paid:true,paymentAmount:10000};
  const note="Проверка подтверждённого возврата";
  assert.deepEqual(await refund.model.recordFullRefund(paid,note),receipt);
  assert.deepEqual(await refund.model.recordFullRefund(paid,note),receipt);
  assert.equal(refund.calls.length,1);
});
test("a confirmed write stays successful when the subsequent read fails",async()=>{
  const networkError=new Error("refresh failed");
  const {model,calls}=harness({reload:async()=>{throw networkError;}});
  const result=await model.persistOrder({...sample,id:null});
  assert.deepEqual(result,{orderId:calls[0][2].id,refreshError:networkError});
  assert.equal(calls.length,1,"must not retry a successful POST");
});

test("acknowledged save exposes the persisted id for a separate payment RPC",async()=>{
  let reloads=0;
  const {model,calls}=harness({reload:async()=>{reloads++;}});
  const result=await model.persistOrder({...sample,id:null},{refresh:false});
  assert.deepEqual(result,{orderId:calls[0][2].id,refreshError:null});
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
test("a refund after a lost response reuses its audit request after reopening CRM",async()=>{
  const entries=new Map();
  const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  const order={...sample,assignedUserId:null,status:"Выполнен",paid:true,paymentAmount:10000};
  const note="Согласованный возврат заказа без мастера";
  const first=harness({storage,request:async()=>{
    throw Object.assign(new Error("Response timed out"),{status:408});
  }});
  await assert.rejects(first.model.recordFullRefund(order,note),/Response timed out/);
  assert.equal(entries.size,1);
  const reopened=harness({storage,request:async()=>({
    order_id:order.id,amount:10000,refunded_at:"2026-11-25T12:00:00Z",replayed:true
  })});
  assert.equal((await reopened.model.recordFullRefund(order,note)).replayed,true);
  assert.deepEqual(reopened.calls[0],first.calls[0]);
  assert.equal(entries.size,0);
});
test("persistOrder URL encodes an order identifier",async()=>{
  const id="test/id?x=1";
  const {model,calls}=harness({orders:[{id}],request:async()=>[{id}]});
  await model.persistOrder({...sample,id});
  assert.equal(calls[0][0],"rabota_orders?id=eq."+encodeURIComponent(id)+"&updated_at=eq."+encodeURIComponent(version));
  assert.equal(calls[0][1],"PATCH");
});

test("edit uses the open-time version even after the cached order changes or disappears",async()=>{
  const {model,calls}=harness({orders:[{...sample,updatedAt:"2026-11-16T08:00:00Z"}],request:async()=>[]});
  await assert.rejects(model.persistOrder({...sample,name:"Черновик"}),/изменился на другом устройстве/);
  assert.equal(calls[0][0],"rabota_orders?id=eq.test-order&updated_at=eq."+encodeURIComponent(version));
  const absent=harness({request:async()=>[]});
  await assert.rejects(absent.model.persistOrder(sample),/Заказ не обновлён/);
  assert.equal(absent.calls[0][1],"PATCH");
  await assert.rejects(absent.model.persistOrder({...sample,updatedAt:undefined}),/Нет версии/);
  assert.equal(absent.calls.length,1);
});

test("status changes compare the exact version and do not rewrite the order fields",async()=>{
  const {model,calls}=harness({request:async()=>[{id:sample.id}]});
  await model.persistOrder({...sample,updatedAt:null,status:"В работе"},{statusOnly:true});
  assert.deepEqual(calls,[["rabota_orders?id=eq.test-order&updated_at=is.null","PATCH",{
    status:"В работе",completed_at:null
  }]]);
});

test("disjoint concurrent edits retry only the local delta against the fresh server version",async()=>{
  const latestVersion="2026-11-15T09:00:00.654321+00:00";
  const {model,calls}=harness({request:async(path,method,data)=>{
    if(method==="GET")return [{...model.serializeOrder(sample),id:sample.id,updated_at:latestVersion,phone:"+79991112233"}];
    return path.includes(encodeURIComponent(latestVersion))?[{id:sample.id}]:[];
  }});
  assert.equal((await model.persistOrder({...sample,price:17000},{base:sample})).orderId,sample.id);
  assert.deepEqual(calls,[["rabota_orders?id=eq.test-order&updated_at=eq."+encodeURIComponent(version),"PATCH",{price:17000}],
    ["rabota_orders?id=eq.test-order&select=*&limit=1","GET"],
    ["rabota_orders?id=eq.test-order&updated_at=eq."+encodeURIComponent(latestVersion),"PATCH",{price:17000}]]);
});

test("a reviewed overlap can retain server fields and still save the remaining draft",async()=>{
  let latestVersion="2026-11-15T09:00:00.654321+00:00";
  const {model,calls}=harness({request:async(path,method,data)=>{
    if(method==="GET")return [{...model.serializeOrder(sample),id:sample.id,updated_at:latestVersion,price:12500}];
    return path.includes(encodeURIComponent(latestVersion))?[{id:sample.id}]:[];
  }});
  const order={...sample,price:17000,address:"Новый адрес"};
  let resolution;
  await assert.rejects(model.persistOrder(order,{base:sample}),error=>{
    assert.equal(error.code,"ORDER_EDIT_CONFLICT");
    assert.deepEqual(error.fields,["price"]);
    assert.equal(error.current.price,12500);
    assert.equal(error.canResolve,true);
    resolution={version:error.version,fields:error.fields,keepCurrent:true};
    return true;
  });
  latestVersion="2026-11-15T09:00:00.654322+00:00";
  await assert.rejects(model.persistOrder(order,{base:sample,resolution}),/изменился на другом устройстве/);
  resolution.version=latestVersion;
  await model.persistOrder(order,{base:sample,resolution});
  assert.deepEqual(calls.at(-1),["rabota_orders?id=eq.test-order&updated_at=eq."+encodeURIComponent(latestVersion),"PATCH",{
    address:"Новый адрес"
  }]);
});

test("a lost create response is reconciled after reopening by the saved id and actor",async()=>{
  const entries=new Map();
  const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  const changed={...sample,id:null,phone:"+79990001122",details:"Только синтетический комментарий"};
  const attempt={};
  let saved;
  const first=harness({storage,request:async(path,method,data)=>{
    if(method==="POST")saved={...data,appointment_time:data.appointment_time+":00",created_by:actor};
    throw new Error("Connection lost");
  }});
  await assert.rejects(first.model.persistOrder(changed,{attempt}),/Сохранение заказа не подтверждено/);
  assert.match(saved.id,/^[0-9a-f-]{36}$/i);
  assert.equal(entries.size,1);
  assert.deepEqual([...entries.values()].map(value=>JSON.parse(value)),[[saved.id]]);
  assert.doesNotMatch(JSON.stringify([...entries]),/79990001122|синтетический комментарий/);
  await assert.rejects(first.model.persistOrder({...changed,price:13000},{attempt}),/Проверьте предыдущую операцию/);
  assert.deepEqual(first.calls.map(call=>call[1]),["POST","GET"]);

  const second=harness({storage,request:async()=>[saved]});
  let previous;
  await assert.rejects(second.model.persistOrder(changed),error=>{
    assert.equal(error.code,"ORDER_CREATE_PENDING");
    assert.equal(error.pending.length,1);
    previous=error.pending[0];
    return true;
  });
  assert.deepEqual(second.calls,[],"a fresh form waits for an explicit choice");
  assert.equal((await second.model.persistOrder(changed,{createChoice:{previous},beforeWrite:()=>assert.fail("already committed")})).orderId,saved.id);
  assert.deepEqual(second.calls,[["rabota_orders?select=*&id=eq."+saved.id+"&limit=1","GET"]]);
  assert.equal(entries.size,0);
});

test("retry after the write never arrived reuses its UUID, and another actor cannot be claimed",async()=>{
  const fresh={...sample,id:null},attempt={};
  let sent,tries=0;
  const {model,calls}=harness({request:async(path,method,data)=>{
    if(method==="GET")return [];
    if(++tries===1){sent=data.id;throw new Error("Connection lost");}
    return [{...data,created_by:actor}];
  }});
  await assert.rejects(model.persistOrder(fresh,{attempt}),/Сохранение заказа не подтверждено/);
  assert.equal((await model.persistOrder(fresh,{attempt})).orderId,sent);
  assert.deepEqual(calls.map(call=>call[1]),["POST","GET","GET","POST"]);
  assert.equal(calls[3][2].id,sent);

  let foreignReceipt;
  const collision=harness({request:async(path,method,data)=>{
    if(method==="POST"){
      foreignReceipt={...data,created_by:"another-owner"};
      throw new Error("Connection lost");
    }
    return [foreignReceipt];
  }});
  await assert.rejects(collision.model.persistOrder(fresh),/уже сохранён или изменился/);
  assert.deepEqual(collision.calls.map(call=>call[1]),["POST","GET"]);
});
