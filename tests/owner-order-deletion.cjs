"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const migration=fs.readFileSync(path.join(__dirname,"..","sql","006-owner-safe-delete-order.sql"),"utf8");
const start=html.indexOf('    deleteOrderBtn.addEventListener("click",async()=>{');
const end=html.indexOf('    document.getElementById("newOrderBtn").addEventListener',start);
assert.ok(start>=0&&end>start,"deletion handler exists in main order UI");
const handlerSource=html.slice(start,end);

function setup({role="owner",paid=false,reply={ok:true},typed="УДАЛИТЬ",confirmed=true,refreshError=null}={}){
  const calls=[];
  const saveBtn={disabled:false};
  const deleteBtn={hidden:role!=="owner",disabled:paid,addEventListener(_,fn){this.run=fn}};
  const formStatus={textContent:"",classList:{add(){},remove(){}}};
  const order={id:"test-id",name:"Test Client",date:"2026-11-11",time:"18:00",
    paid,paymentAmount:null,paidAt:null};
  const context={
    currentRole:role,editingId:"test-id",orderSaving:false,
    deleteOrderBtn:deleteBtn,formStatus,form:{querySelector:()=>saveBtn},
    getOrders:()=>[order],confirm:()=>confirmed,prompt:()=>typed,
    dbRequest:async(path,method,payload)=>{
      calls.push({path,method,payload});
      if(reply instanceof Error)throw reply;
      return reply;
    },
    reloadOrders:async()=>{if(refreshError)throw refreshError;calls.push({event:"reloaded"})},
    closeForm:()=>calls.push({event:"closed"}),
    window:{__rdLeadsRefresh:async()=>calls.push({event:"leads"})},
    alert:msg=>calls.push({event:"alert",msg}),
    friendlyError:error=>error.message,console:{warn(){}}
  };
  vm.runInNewContext(handlerSource,context);
  return {run:deleteBtn.run,calls,formStatus,deleteBtn,context};
}

test("delete control is visible only for owner editing an existing order",()=>{
  assert.ok(html.includes('id="deleteOrderBtn" type="button" hidden'));
  assert.ok(html.includes('deleteOrderBtn.hidden=currentRole!=="owner"||!existing'));
  assert.ok(html.includes('deleteOrderBtn.disabled=Boolean(existing&&(existing.paid'));
  assert.ok(html.includes('dbRequest("rpc/rabota_delete_order","POST",{p_order_id:id})'));
  assert.ok(!html.includes('dbRequest("rabota_orders?id=eq." + encodeURIComponent(order.id),"DELETE"'));
});
test("only owner can request deletion; two confirmations required",async()=>{
  for(const role of ["manager","master"]){
    const h=setup({role});
    await h.run();
    assert.equal(h.calls.length,0);
  }
  const rejected=setup({typed:"wrong"});
  await rejected.run();
  assert.equal(rejected.calls.length,0);
  assert.ok(rejected.formStatus.textContent.includes("отменено"));
  const cancelled=setup({confirmed:false});
  await cancelled.run();
  assert.equal(cancelled.calls.length,0);
});
test("paid order can't trigger deletion",async()=>{
  const h=setup({paid:true});
  await h.run();
  assert.equal(h.calls.length,0);
});
test("successful deletion refreshes and closes only after RPC success",async()=>{
  const h=setup();
  await h.run();
  assert.equal(h.calls[0].path,"rpc/rabota_delete_order");
  assert.equal(h.calls[0].method,"POST");
  assert.equal(h.calls[0].payload.p_order_id,"test-id");
  assert.deepEqual(h.calls.slice(1).map(c=>c.event),["reloaded","closed","leads","alert"]);
});
test("server-side refusal keeps editor and shows error",async()=>{
  const h=setup({reply:new Error("Удаление запрещено: есть финансовые операции")});
  await h.run();
  assert.equal(h.calls.length,1);
  assert.equal(h.formStatus.textContent,"Удаление запрещено: есть финансовые операции");
  assert.equal(h.deleteBtn.disabled,false);
  assert.equal(h.context.orderSaving,false);
});
test("delete success is not misreported as failure if subsequent refresh fails",async()=>{
  const h=setup({refreshError:new Error("offline")});
  await h.run();
  assert.ok(h.calls.some(c=>c.event==="closed"));
  assert.ok(h.calls.some(c=>c.event==="alert"&&c.msg.includes("Заказ удалён")));
});
test("server guards owner, payment flags and related records, no table DELETE grant",()=>{
  for(const phrase of [
    "SECURITY DEFINER","SET search_path = ''","m.role = 'owner' AND m.active = true",
    "FOR UPDATE","v_order.paid IS TRUE","v_order.payment_amount IS NOT NULL",
    "public.rabota_finance_operations","public.rabota_cash_collections",
    "public.rabota_ai_order_drafts","REVOKE ALL ON FUNCTION",
    "GRANT EXECUTE ON FUNCTION public.rabota_delete_order(uuid) TO authenticated"
  ]) assert.ok(migration.includes(phrase),phrase);
  assert.ok(!migration.includes("GRANT DELETE ON public.rabota_orders"));
});
