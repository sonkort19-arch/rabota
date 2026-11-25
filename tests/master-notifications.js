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
const shellCss=fs.readFileSync(path.join(__dirname,"..","app-shell.css"),"utf8");
assert.doesNotThrow(()=>new Function(src));
assert(html.includes('id="pushUnreadCount"')&&html.includes('id="pushPopover"'));
assert(html.includes('id="pushToggle" type="checkbox" role="switch"'));
assert.match(html,/src="\/master-notifications\.js\?v=[\w-]+"/);
const headerStart=html.indexOf('<header id="rdScreenHeader"');
const headerEnd=html.indexOf('</header>',headerStart);
const appStart=html.indexOf('<main id="appScreen"');
const profile=html.indexOf('id="rdProfile"');
const menu=html.indexOf('id="rdProfileMenu"');
const panel=html.indexOf('id="masterPushPanel"');
assert(headerStart>=0&&profile>headerStart&&menu>profile&&panel>menu&&panel<headerEnd&&headerEnd<appStart,
  "notifications live in the shared header profile outside the scrolling workspace");
assert(panel<html.indexOf('id="logoutBtn"')&&html.indexOf('id="logoutBtn"')<html.indexOf('id="orderOverlay"'),
  "profile holds the notification panel and sign-out");
assert.equal((html.match(/id="masterPushPanel"/g)||[]).length,1);
assert(html.indexOf('id="pushToggle"')>html.indexOf('id="pushPopover"'),"push toggle inside popup");
assert(html.indexOf('id="pushToggle"')<html.indexOf('id="recentNotificationList"'),"switch precedes notification list");
assert(!html.includes('class="push-widget"'),"large dashboard notification card removed");
assert.match(shellCss,/#rdProfileMenu #pushBellBtn[\s\S]*?min-height:44px/,"notifications retain a touch target in the profile");
assert.match(shellCss,/#rdProfileMenu #pushPopover\s*\{\s*position:static/,"notifications expand inside the profile menu");
assert(css.includes('.push-setting-row'),"popup-only phone notifications setting");
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
  const ids=["appScreen","masterPushPanel","pushBellBtn","pushPopover","pushToggle","pushUnreadCount","recentNotificationList","testPushBtn","pushToggleText","pushStatus","closePushPopover","masterStatusReviewList"];
  const els=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const documentEvents={};
  const doc={getElementById:id=>els[id],addEventListener:(kind,fn)=>{(documentEvents[kind]??=[]).push(fn);}};
  let messages=[
    {id:1,client_name:"Клиент 1",visit_date:"2026-11-01",visit_time:"10:00:00"},
    {id:2,client_name:"Клиент 2",visit_date:"2026-11-02",visit_time:"16:00:00"},
    {id:3,client_name:"Клиент 3",visit_date:"2026-11-03",visit_time:"11:00:00"}
  ];
  let subscriptionActive=true,serverActive=true,deletes=0,subscribes=0,reads=0;
  let openedOrder=null;
  const profileClosures=[];
  let reviews=[
    {id:"past-a",name:"Просроченный A",date:"2026-11-01",time:"09:00",status:"Записан"},
    {id:"past-b",name:"Просроченный B",date:"2026-11-02",time:"11:00",status:"Записан"}
  ];
  const subscription={endpoint:"https://test.invalid/push",toJSON(){return {endpoint:this.endpoint}},async unsubscribe(){subscriptionActive=false;return true;}};
  const reg={pushManager:{
    getSubscription:async()=>subscriptionActive?subscription:null,
    subscribe:async()=>{subscribes++;subscriptionActive=true;return subscription;}
  }};
  const navigator={userAgent:"iPhone",standalone:true,serviceWorker:{getRegistration:async()=>reg,register:async()=>reg,ready:Promise.resolve(reg)}};
  const window={isSecureContext:true,matchMedia:()=>({matches:true}),PushManager:function(){},Notification:function(){}};
  let notificationReads=0;
  const dbRequest=async(request,method)=>{
    if(request.includes("rabota_order_notifications")&&method==="GET"){notificationReads++;return messages;}
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
  window.__rdMasterStatusReview=()=>reviews;
  window.__rdOpenMasterOrder=id=>{openedOrder=id;};
  window.__rdCloseProfile=focus=>profileClosures.push(focus);
  const vars={
    document:doc,window,navigator,currentRole:"master",currentUser:{id:"master1"},dbRequest,make,
    formatDate:value=>value,friendlyError:err=>String(err.message||err),
    Notification:{permission:"granted",requestPermission:async()=> "granted"},
    ensureSession:async()=>{},SUPABASE_URL:"https://test.invalid",SUPABASE_KEY:"public",PUSH_PUBLIC_KEY:"dGVzdA",
    session:{access_token:"synthetic"},fetch:async()=>({ok:true,json:async()=>({delivered:true})}),
    atob:base64=>Buffer.from(base64,"base64").toString("binary"),Uint8Array
  };
  new Function(...Object.keys(vars),src)(...Object.values(vars));
  window.__rdInitMasterPush();
  assert.equal(notificationReads,1,"Late script initialization and access hook share one initial fetch");
  await window.__rdRefreshMasterNotices();
  assert.equal(els.pushUnreadCount.textContent,"5","3 new + 2 overdue");
  assert.equal(els.masterStatusReviewList.hidden,false);
  assert.equal(els.masterStatusReviewList.children.length,3);
  await els.masterStatusReviewList.children[1].fire("click");
  assert.equal(openedOrder,"past-b");
  assert.deepEqual(profileClosures,[true],"opening an overdue order closes the parent profile");
  reviews=reviews.slice(0,1);
  await window.__rdRefreshMasterNotices();
  assert.equal(els.pushUnreadCount.textContent,"4");
  assert.equal(els.masterStatusReviewList.children.length,2);
  await els.pushBellBtn.fire("click");
  assert.equal(els.pushPopover.hidden,false);
  assert.equal(els.pushBellBtn.attrs["aria-expanded"],"true");
  assert.equal(els.recentNotificationList.children.length,3);
  const markRead=els.recentNotificationList.children[0].children[2];
  await markRead.fire("click");
  assert.equal(reads,1);
  assert.equal(els.pushUnreadCount.textContent,"3","2 new + 1 overdue");
  for(const handler of documentEvents.keydown)handler({key:"Escape"});
  assert.equal(els.pushPopover.hidden,true);
  assert.equal(els.pushBellBtn.attrs["aria-expanded"],"false");
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
