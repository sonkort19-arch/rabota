"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createOrdersModel}=require("../order-model.js");

const STATUSES=["Новый","Записан","В работе","Выполнен","Отменён"];
const base={
 id:"111",name:"Иван",phone:"+7 900 000 00 00",address:"Владикавказ",
 radiator_type:"Биметаллические",radiators:5,floor_loops:2,
 master:"Рауль",appointment_date:"2026-11-15",appointment_time:"12:00:00",
 price:"12000",status:"Записан",paid:false,details:"Условие",
 created_at:"2026-11-13T09:00:00Z",assigned_user_id:"master1"
};
function setup({orders=[],operations=[],collections=[],onRequest=async()=>[{id:"saved"}]}={}){
 const calls=[];let reloads=0;
 const model=createOrdersModel({
   statuses:STATUSES,
   getCurrentUserId:()=>"owner1",
   getOrders:()=>orders,
   getFinanceOperations:()=>operations,
   getFinanceCollections:()=>collections,
   dbRequest:async(...args)=>{calls.push(args);return onRequest(...args);},
   reloadOrders:async()=>{reloads++;}
 });
 return {model,calls,reloads:()=>reloads};
}
test("database row maps to UI model with numeric price and HH:MM time",()=>{
 const {model}=setup();
 const value=model.readOrder(base);
 assert.equal(value.id,"111");
 assert.equal(value.time,"12:00");
 assert.equal(value.price,12000);
 assert.equal(value.radiators,5);
 assert.equal(value.floorLoops,2);
 assert.equal(value.paid,false);
 assert.equal(value.master,"Рауль");
});
test("paid order serializes payment fields without dropping client data",()=>{
 const {model}=setup();
 const record=model.serializeOrder({
   ...model.readOrder(base),paid:true,price:13000,status:"Выполнен",
   paymentMethod:"cash",paymentAmount:13000,paymentReceivedBy:"company",
   paidAt:"2026-11-13T09:10:00Z",paidBy:"owner1"
 });
 assert.equal(record.price,13000);
 assert.equal(record.paid,true);
 assert.equal(record.status,"Выполнен");
 assert.equal(record.payment_method,"cash");
 assert.equal(record.payment_amount,13000);
 assert.equal(record.payment_received_by,"company");
 assert.equal(record.phone,base.phone);
 assert.equal(record.updated_at.length,24);
});
test("unpaid order does not manufacture payment metadata",()=>{
 const {model}=setup();
 const record=model.serializeOrder({...model.readOrder(base),paid:false});
 assert.equal(record.paid,false);
 assert.ok(!Object.hasOwn(record,"payment_method"));
 assert.ok(!Object.hasOwn(record,"paid_at"));
});
test("unsupported status falls back to Новый",()=>{
 const {model}=setup();
 const record=model.serializeOrder({...model.readOrder(base),status:"неизвестный"});
 assert.equal(record.status,"Новый");
});
test("active slot conflict is found only for same master and time",()=>{
 const orders=[
  {id:"1",date:"2026-11-15",time:"12:00",master:"Рауль",status:"Записан"},
  {id:"2",date:"2026-11-15",time:"13:00",master:"Рауль",status:"Отменён"},
  {id:"3",date:"2026-11-15",time:"12:00",master:"Олег",status:"Записан"}
 ];
 const {model}=setup({orders});
 assert.equal(model.hasConflict("2026-11-15","12:00","рауль",null),true);
 assert.equal(model.hasConflict("2026-11-15","12:00","рауль","1"),false);
 assert.equal(model.hasConflict("2026-11-15","13:00","Рауль",null),false);
});
test("tight booking warning uses strict 200-minute window",()=>{
 const orders=[
  {id:"1",date:"2026-11-15",time:"12:00",master:"Рауль",status:"Записан"},
  {id:"2",date:"2026-11-15",time:"15:19",master:"Рауль",status:"Записан"},
  {id:"3",date:"2026-11-15",time:"15:20",master:"Рауль",status:"Записан"},
  {id:"4",date:"2026-11-15",time:"12:30",master:"Рауль",status:"Отменён"}
 ];
 const {model}=setup({orders});
 assert.deepEqual(model.findTightBookings("2026-11-15","12:00","Рауль",null).map(x=>x.id),["1","2"]);
});
test("finance flags include paid marker and ledger references",()=>{
 const order={id:"1",paid:false,price:10000};
 const {model}=setup({operations:[{order_id:"1"}],collections:[{order_id:"2"}]});
 assert.equal(model.orderHasFinancialHistory(order),true);
 assert.equal(model.orderHasFinancialHistory({id:"2",paid:false}),true);
 assert.equal(model.orderHasFinancialHistory({id:"3",paid:false}),false);
 assert.equal(model.orderHasFinancialHistory({id:"3",paid:true}),true);
});
test("editing an existing order sends PATCH then refreshes",async()=>{
 const original={...base,createdAt:base.created_at,date:"2026-11-15",time:"12:00"};
 const {model,calls,reloads}=setup({orders:[original]});
 await model.persistOrder({...model.readOrder(base),id:"111"});
 assert.equal(calls.length,1);
 assert.equal(calls[0][1],"PATCH");
 assert.match(calls[0][0],/^rabota_orders\?id=eq\.111$/);
 assert.equal(reloads(),1);
});
test("creating a new order sends POST then refreshes",async()=>{
 const {model,calls,reloads}=setup();
 await model.persistOrder({...model.readOrder(base),id:null});
 assert.equal(calls[0][0],"rabota_orders");
 assert.equal(calls[0][1],"POST");
 assert.equal(reloads(),1);
});
test("database failure preserves old behavior: no success refresh",async()=>{
 const {model,reloads}=setup({onRequest:async()=>{throw Error("DB unavailable");}});
 await assert.rejects(model.persistOrder({...model.readOrder(base),id:null}),/DB unavailable/);
 assert.equal(reloads(),0);
});
test("index references module before inline application and keeps adapters",()=>{
 const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
 assert.match(html,/src="\/order-model\.js\?v=20261113-stage3"/);
 assert.ok(html.indexOf('src="/order-model.js?v=20261113-stage3"')<
   html.indexOf("const orderModel=window.__rdCreateOrdersModel"));
 for (const method of ["readOrder","serializeOrder","persistOrder","hasConflict","findTightBookings","orderHasFinancialHistory"])
   assert.ok(html.includes("orderModel."+method+"("),method);
 const inline=html.split("<script>\n").at(-1).split("</script>")[0];
 assert.doesNotThrow(()=>new Function(inline));
});
