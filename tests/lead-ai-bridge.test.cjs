"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createLeadAIBridge}=require("../lead-ai-bridge.js");

function fixture({role="owner",hostname="rabota.example.com",page="calendar"}={}){
  const form={
    dataset:{},handlers:[],
    addEventListener(type,fn,capture){this.handlers.push({type,fn,capture});}
  };
  const formStatus={textContent:""};
  const controls=Object.fromEntries(["name","phone","address","type",
    "radiators","loops","price","details","date","time"].map(key=>[key,{value:"old"}]));
  const orders=[{id:"1",date:"2026-11-15",time:"10:00",master:"Рауль",status:"Записан",phone:"secret"}];
  const link={href:"/ai.html"};
  let opens=0,refreshes=0;
  const bridge=createLeadAIBridge({
    getRole:()=>role,getUserId:()=>"user1",getOrders:()=>orders,
    openForm:()=>{opens++;form.dataset={};},
    refreshAvailability:items=>{assert.equal(items,orders);refreshes++;},
    getCurrentPage:()=>page,form,formStatus,controls,aiChatLink:link,hostname:()=>hostname
  });
  return {bridge,form,formStatus,controls,orders,link,
    get opens(){return opens;},get refreshes(){return refreshes;}};
}
const lead={id:"12345678-1234-1234-1234-123456789abc",name:"Мария",
  phone:"+7 999",address:"Владикавказ",material:"Биметаллические",
  radiators:5,loops:2,price:16000,notes:"Вызвать после 14"};

test("owner gets lead context with only scheduling fields",()=>{
  const x=fixture();
  assert.deepEqual(x.bridge.context(),{
    role:"owner",userId:"user1",
    orders:[{date:"2026-11-15",time:"10:00",master:"Рауль",status:"Записан"}]
  });
});
test("owner can populate unsaved booking from lead",()=>{
  const x=fixture();x.bridge.openLeadOrder(lead);
  assert.equal(x.opens,1);assert.equal(x.refreshes,1);
  assert.equal(x.form.dataset.leadId,lead.id);
  assert.equal(x.controls.name.value,"Мария");
  assert.equal(x.controls.type.value,"Биметаллические");
  assert.equal(x.controls.radiators.value,5);
  assert.equal(x.controls.loops.value,2);
  assert.equal(x.controls.price.value,16000);
  assert.equal(x.controls.details.value,"Вызвать после 14");
  assert.equal(x.controls.date.value,"");
  assert.equal(x.controls.time.value,"");
});
test("manager is allowed to prefill, master is blocked",()=>{
  const manager=fixture({role:"manager"}),master=fixture({role:"master"});
  manager.bridge.openLeadOrder(lead);master.bridge.openLeadOrder(lead);
  assert.equal(manager.opens,1);assert.equal(master.opens,0);
  assert.equal(master.refreshes,0);
});
test("empty lead and absent lead do not create saved order",()=>{
  const x=fixture();x.bridge.openLeadOrder(null);
  assert.equal(x.opens,0);assert.equal(x.refreshes,0);
});
test("invalid linked lead id is discarded, no arbitrary ID injection",()=>{
  const x=fixture();x.bridge.openLeadOrder({...lead,id:"not-a-uuid"});
  assert.equal(x.form.dataset.leadId,undefined);
});
test("unknown radiator material falls back to Другие",()=>{
  const x=fixture();x.bridge.openLeadOrder({...lead,material:"custom"});
  assert.equal(x.controls.type.value,"Другие");
});
test("notes are limited to 1000 characters",()=>{
  const x=fixture();x.bridge.openLeadOrder({...lead,notes:"a".repeat(1800)});
  assert.equal(x.controls.details.value.length,1000);
});
test("preview host sets explicit no-save marker",()=>{
  const x=fixture({hostname:"rabota-test123456-sonkort19-6069s-projects.vercel.app"});
  x.bridge.openLeadOrder(lead);
  assert.equal(x.form.dataset.leadPreview,"1");
  assert.match(x.formStatus.textContent,/Preview запись заказа отключена/);
});
test("preview submission is blocked before ordinary submit handlers",()=>{
  const x=fixture();x.form.dataset.leadPreview="1";
  let prevented=false,stopped=false;
  x.bridge.preventPreviewSubmit({
    preventDefault:()=>{prevented=true},
    stopImmediatePropagation:()=>{stopped=true}
  });
  assert.equal(prevented,true);assert.equal(stopped,true);
  assert.match(x.formStatus.textContent,/сохранять заказ в общей базе нельзя/);
});
test("production submission is not blocked by preview guard",()=>{
  const x=fixture();
  x.bridge.openLeadOrder(lead);
  assert.equal(x.form.dataset.leadPreview,undefined);
  x.bridge.preventPreviewSubmit({
    preventDefault:()=>{throw Error("blocked normal form")},
    stopImmediatePropagation:()=>{throw Error("blocked normal form")}
  });
});
test("AI chat link preserves only internal approved section names",()=>{
  for(const page of ["home","orders","calendar","leads","clients","finance"]){
    const x=fixture({page});x.bridge.prepareChatLink({currentTarget:x.link});
    assert.equal(x.link.href,"/ai.html?from="+page);
  }
  for(const page of ["http://bad.site","javascript:alert(1)","unknown",null]){
    const x=fixture({page});x.bridge.prepareChatLink({currentTarget:x.link});
    assert.equal(x.link.href,"/ai.html?from=home");
  }
});
test("module is loaded before app code and preserves original integrations",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/lead-ai-bridge\.js\?v=20261113-stage7"/);
  assert.ok(html.indexOf('src="/lead-ai-bridge.js?v=20261113-stage7"')<
    html.indexOf("const leadAIBridge=window.__rdCreateLeadAIBridge"));
  assert.match(html,/window\.__rdLeadContext=\(\)=>leadAIBridge\.context\(\)/);
  assert.match(html,/window\.__rdLeadOpenOrder=lead=>leadAIBridge\.openLeadOrder\(lead\)/);
  assert.match(html,/preventPreviewSubmit\(event\),true/);
  assert.match(html,/leadAIBridge\.prepareChatLink\(event\)/);
  assert.match(html,/src="\/lead-assistant\.js"/);
  assert.match(html,/href="\/ai\.html"/);
  const main=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(main));
});
