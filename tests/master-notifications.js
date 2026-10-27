/* Read-only, synthetic master-notification regression tests.
   Run: node tests/master-notifications.js
   No live network, authentication, production clients or Supabase writes. */
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const src=fs.readFileSync(path.join(__dirname,"..","master-notifications.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"..","master-notifications.css"),"utf8");
assert.doesNotThrow(()=>new Function(src));
assert(html.includes('id="pushUnreadCount"')&&html.includes('id="pushPopover"'));
assert(html.includes('id="pushToggle" type="checkbox" role="switch"'));
assert(html.includes('src="/master-notifications.js"'));
assert(css.includes("position: absolute;"));
class Element{
  constructor(id=""){this.id=id;this.hidden=["pushPopover","pushUnreadCount","testPushBtn"].includes(id);this.checked=false;this.disabled=false;this.children=[];this.attrs={};this.events={};this.textContent="";this.classList={toggle(){}};}
  addEventListener(kind,fn){(this.events[kind]??=[]).push(fn);}
  fire(kind){return Promise.all((this.events[kind]||[]).map(fn=>fn({target:this,key:kind})));}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this.attrs[name]=value;}
  focus(){}
  contains(){return true;}
}
async function run(){
  const ids=["masterPushPanel","pushBellBtn","pushPopover","pushToggle","pushUnreadCount","recentNotificationList","testPushBtn","pushToggleText","pushStatus","closePushPopover"];
  const els=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const doc={getElementById:id=>els[id],addEventListener(){}};
  let messages=[
    {id:1,client_name:"Клиент 1",visit_date:"2026-11-01",visit_time:"10:00:00"},
    {id:2,client_name:"Клиент 2",visit_date:"2026-11-02",visit_time:"16:00:00"},
    {id:3,client_name:"Клиент 3",visit_date:"2026-11-03",visit_time:"11:00:00"}
  ];
  let subscriptionActive=true,serverActive=true,deletes=0,subscribes=0,reads=0;
  const subscription={endpoint:"https://test.invalid/push",toJSON(){return {endpoint:this.endpoint}},async unsubscribe(){subscriptionActive=false;return true;}};
  const reg={pushManager:{
    getSubscription:async()=>subscriptionActive?subscription:null,
    subscribe:async()=>{subscribes++;subscriptionActive=true;return subscription;}
  }};
  const navigator={userAgent:"iPhone",standalone:true,serviceWorker:{getRegistration:async()=>reg,register:async()=>reg,ready:Promise.resolve(reg)}};
  const window={isSecureContext:true,matchMedia:()=>({matches:true}),PushManager:function(){},Notification:function(){}};
  const dbRequest=async(request,method)=>{
    if(request.includes("rabota_order_notifications")&&method==="GET")return messages;
    if(request.includes("rabota_order_notifications")&&method==="PATCH"){
      const message=messages.find(m=>request.includes("id=eq."+m.id));
      if(!message)return [];
      reads++;messages=messages.filter(m=>m!==message);return [{id:message.id}];
    }
    if(request.includes("rabota_push_subscriptions")&&method==="GET")return serverActive?[{active:true}]:[];
    if(request.includes("rabota_push_subscriptions")&&method==="DELETE"){deletes++;serverActive=false;return [];}
    if(request.includes("rabota_register_push_subscription")){serverActive=true;return [];}
    throw new Error("Unexpected fake DB request "+request);
  };
  const make=(_,className,text)=>{const node=new Element();node.className=className;node.textContent=text;return node;};
  const vars={
    document:doc,window,navigator,currentRole:"master",currentUser:{id:"master1"},dbRequest,make,
    formatDate:value=>value,friendlyError:err=>String(err.message||err),
    Notification:{permission:"granted",requestPermission:async()=> "granted"},
    ensureSession:async()=>{},SUPABASE_URL:"https://test.invalid",SUPABASE_KEY:"public",PUSH_PUBLIC_KEY:"dGVzdA",
    session:{access_token:"synthetic"},fetch:async()=>({ok:true,json:async()=>({delivered:true})}),
    atob:base64=>Buffer.from(base64,"base64").toString("binary"),Uint8Array
  };
  new Function(...Object.keys(vars),src)(...Object.values(vars));
  await window.__rdRefreshMasterNotices();
  assert.equal(els.pushUnreadCount.textContent,"3");
  await els.pushBellBtn.fire("click");
  assert.equal(els.pushPopover.hidden,false);
  assert.equal(els.recentNotificationList.children.length,3);
  const markRead=els.recentNotificationList.children[0].children[2];
  await markRead.fire("click");
  assert.equal(reads,1);
  assert.equal(els.pushUnreadCount.textContent,"2");
  // Allow the initial asynchronous subscription state lookup to finish.
  await Promise.resolve();await Promise.resolve();
  assert.equal(els.pushToggle.checked,true);
  els.pushToggle.checked=false;
  await els.pushToggle.fire("change");
  assert.equal(deletes,1);
  assert.equal(subscriptionActive,false);
  assert.equal(els.pushToggle.checked,false);
  els.pushToggle.checked=true;
  await els.pushToggle.fire("change");
  assert.equal(subscribes,1);
  assert.equal(subscriptionActive,true);
  assert.equal(serverActive,true);
  assert.equal(els.pushToggle.checked,true);
  console.log("Master bell + push switch regression: PASS");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
