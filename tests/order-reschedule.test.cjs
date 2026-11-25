"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const {canMove,createRescheduleModel}=require("../order-reschedule.js");

const payload={
  p_order_id:"order",p_expected_updated_at:"2026-11-25T17:00:00.123456+00:00",
  p_appointment_date:"2026-12-01",p_appointment_time:"15:00"
};
const saved={state:"saved",event:{new_date:"2026-12-01",new_time:"15:00:00"}};

function fixture(request){
  const calls=[],finished=[];
  const model=createRescheduleModel({getActor:()=>"manager",request:(...args)=>{
    calls.push(args);
    return request(...args);
  },writeIntents:{
    get:async(actor,intent)=>{
      assert.equal(actor,"manager");
      assert.deepEqual(intent,payload);
      return {requestId:"persisted-id"};
    },
    finish:async(intent)=>finished.push(intent.requestId)
  }});
  return {model,calls,finished};
}

test("a saved move changes only the requested slot and acknowledges the durable operation",async()=>{
  const {model,calls,finished}=fixture(async()=>saved);
  assert.equal(await model.move(payload),saved);
  assert.deepEqual(calls,[["rpc/rabota_reschedule_order","POST",{...payload,p_request_id:"persisted-id"}]]);
  assert.deepEqual(finished,["persisted-id"]);
});

test("an ambiguous response leaves the intent intact and retries the same request UUID",async()=>{
  let requests=0;
  const {model,calls,finished}=fixture(async()=>{
    if(++requests===1)throw Error("lost response");
    return {...saved,replayed:true};
  });
  await assert.rejects(model.move(payload),{uncertain:true});
  assert.deepEqual(finished,[]);
  assert.equal((await model.move(payload)).replayed,true);
  assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(finished,["persisted-id"]);
});

test("a definitive occupied slot releases the intent",async()=>{
  const {model,finished}=fixture(async()=>({state:"occupied"}));
  assert.equal((await model.move(payload)).state,"occupied");
  assert.deepEqual(finished,["persisted-id"]);
});

test("an unavailable durable store or a changed session prevents the write",async()=>{
  let writes=0,scope=1;
  const request=async()=>{writes++;return saved;};
  for(const get of [async()=>{throw Error("No storage");},async()=>{scope++;return {requestId:"old"};}]){
    const model=createRescheduleModel({
      getActor:()=>"manager",getScope:()=>scope,request,writeIntents:{get}
    });
    await assert.rejects(model.move(payload));
  }
  assert.equal(writes,0);
});

test("quick move eligibility preserves existing payment protections",()=>{
  const order={id:"order",assignedUserId:"master",status:"Записан",travelAmount:1000};
  assert.equal(canMove(order),true);
  assert.equal(canMove({...order,status:"В работе"}),true);
  for(const overrides of [{status:"Выполнен"},{status:"Отменён"},{assignedUserId:null},
    {paid:true},{paymentAmount:11000},{paidAt:"2026-11-25"},{paymentMethod:"card"}]){
    assert.equal(canMove({...order,...overrides}),false);
  }
});
