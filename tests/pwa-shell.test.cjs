"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto").webcrypto;
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const origin="https://fixture.invalid";
const shellUrl=origin+"/";
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const workerSource=read("sw.js");
const runtimeSource=read("pwa-runtime.js");
function shell(version){
 return `<form id="loginForm"></form><main id="appScreen">Release ${version}</main>
 <script src="/orders.js?v=${version}" defer></script><link rel="stylesheet" href="/shell.css">
 <script src="https://external.invalid/library.js"></script><script src="/api/data.js"></script>`;
}
function content(text,type,status=200,extra={}){
 return new Response(text,{status,headers:{"Content-Type":type,...extra}});
}
function worker(){
 const events=new Map(),storage=new Map(),requests=[],focuses=[],opened=[],notifications=[];
 let windows=[],claims=0;
 let network=()=>{throw new TypeError("No connection");};
 const caches={
  async open(name){
   if(!storage.has(name))storage.set(name,new Map());
   const cache=storage.get(name);
   return {
    match:async url=>cache.get(url)?.clone(),
    put:async(url,response)=>{
     const copy=new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});
     cache.set(url,copy);
    }
   };
  },
  async match(url,{cacheName}){return storage.get(cacheName)?.get(url)?.clone();},
  async delete(name){return storage.delete(name);}
 };
 const self={location:{origin},
  addEventListener:(kind,handler)=>events.set(kind,handler),
  skipWaiting(){throw new Error("Activation must wait for existing documents");},
  clients:{claim:async()=>{claims++;},matchAll:async()=>windows,
   openWindow:async url=>{opened.push(url);}},
  registration:{showNotification:async(title,options)=>{notifications.push({title,options});}}
 };
 vm.runInNewContext(workerSource,{self,caches,Response,URL,AbortController,TextEncoder,crypto,
  setTimeout:(callback,time)=>setTimeout(callback,time===1800?25:time===8000?100:time),clearTimeout,
  fetch:async(request,options={})=>{
   const url=new URL(request.url||request);
   requests.push({url:url.href,options});
   return network(url,options);
  }
 });
 function dispatch(kind,properties={}){
  let response;
  const wait=[];
  const event={...properties,waitUntil(work){wait.push(work);},respondWith(work){response=work;}};
  events.get(kind)?.(event);
  return {response,done:Promise.all(wait)};
 }
 function request(path,{mode="navigate",method="GET",destination="",headers={}}={}){
  return dispatch("fetch",{request:{url:new URL(path,origin).href,method,mode,destination,headers:new Headers(headers)}});
 }
 function online(version,{css="shell "+version,omitScript=false,status=200}={}){
  network=url=>{
   if(url.pathname==="/"||url.pathname==="/index.html")return content(shell(version),"text/html",status);
   if(url.pathname==="/orders.js"&&url.searchParams.get("v")===String(version)&&!omitScript)
    return content("orders "+version,"application/javascript");
   if(url.pathname==="/shell.css")return content(css,"text/css");
   return content("missing","text/plain",404);
  };
 }
 return {dispatch,request,online,requests,storage,focuses,opened,notifications,get claims(){return claims;},
  set network(callback){network=callback;},set windows(urls){windows=urls.map(url=>({url:new URL(url,origin).href,
   focus:async()=>focuses.push(url),navigate:async()=>{throw new Error("Notification caused an unsolicited document reload");}}));}};
}

test("a complete shell becomes the offline fallback and reuses exact versioned assets",async()=>{
 const env=worker();
 await env.dispatch("install").done;
 await env.dispatch("activate").done;
 assert.equal(env.claims,1);
 env.online(1);
 await Promise.all([env.dispatch("message",{data:{type:"RABOTA_WARM_SHELL"}}).done,
  env.dispatch("message",{data:{type:"RABOTA_WARM_SHELL"}}).done]);
 assert.deepEqual(env.requests.map(entry=>entry.url).sort(),
  [shellUrl,origin+"/orders.js?v=1",origin+"/shell.css"].sort());
 assert(env.requests.every(entry=>entry.options.credentials==="omit"));
 assert.equal(env.requests.find(entry=>entry.url.endsWith(".js?v=1")).options.cache,"force-cache");
 const cached=env.request("/orders.js?v=1",{mode:"same-origin",destination:"script"});
 assert.equal(await (await cached.response).text(),"orders 1");
 assert.equal(env.requests.length,3);
 env.network=(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));
 const stalled=env.request("/?view=expenses");
 assert.match(await (await stalled.response).text(),/Release 1/);
 await stalled.done;
 assert.equal(await (await env.request("/shell.css",{mode:"same-origin",destination:"style"}).response).text(),"shell 1");
});

test("new releases are live online and a partial release cannot replace a complete fallback",async()=>{
 const env=worker();
 env.online(1);
 const first=env.request("/");
 assert.match(await (await first.response).text(),/Release 1/);
 await first.done;
 env.online(2,{omitScript:true});
 const partial=env.request("/?view=orders");
 assert.match(await (await partial.response).text(),/Release 1/);
 await partial.done;
 assert.equal(env.storage.size,2,"metadata and only the last complete snapshot survive");
 env.network=()=>content("unavailable","text/plain",503);
 const fallback=env.request("/index.html?view=orders");
 assert.match(await (await fallback.response).text(),/Release 1/);
 env.online(2);
 const second=env.request("/?view=clients");
 assert.match(await (await second.response).text(),/Release 2/);
 await second.done;
 assert.equal(await (await env.request("/orders.js?v=1",{mode:"cors",destination:"script"}).response).text(),"orders 1");
 assert.equal(await (await env.request("/orders.js?v=2",{mode:"cors",destination:"script"}).response).text(),"orders 2");
 env.online(3);
 await env.request("/").done;
 assert.equal(env.storage.size,3,"metadata, current and previous complete snapshots are kept");
 env.network=()=>content("unavailable","text/plain",503);
 assert.match(await (await env.request("/?view=expenses").response).text(),/Release 3/);
});

test("a slow release is prepared for the next opening while the current opening uses its complete fallback",async()=>{
 const env=worker();
 env.online(1);
 await env.request("/").done;
 let finishDocument;
 env.network=url=>{
  if(url.pathname==="/")return new Promise(resolve=>{finishDocument=resolve;});
  if(url.pathname==="/orders.js")return content("orders 2","application/javascript");
  return content("shell 2","text/css");
 };
 const slow=env.request("/?view=calendar");
 assert.match(await (await slow.response).text(),/Release 1/);
 finishDocument(content(shell(2),"text/html"));
 await slow.done;
 env.network=()=>{throw new TypeError("Offline");};
 assert.match(await (await env.request("/").response).text(),/Release 2/);
});

test("the worker bypasses API, account data, protected requests and writes",async()=>{
 const env=worker();
 for(const [url,options] of [
  ["/api/orders",{}],["/api/code.js",{mode:"cors",destination:"script"}],
  ["https://supabase.invalid/rest/v1/rabota_orders",{mode:"cors"}],
  ["/",{method:"POST"}],["/",{headers:{Authorization:"Bearer fake"}}],
  ["/orders.js?v=1",{mode:"cors",destination:"script",headers:{Range:"bytes=0-100"}}],
  ["/orders.js?v=1",{mode:"cors"}],["/.rabota-shell-metadata",{mode:"cors"}]
 ]) assert.equal(env.request(url,options).response,undefined,url);
 assert.equal(env.requests.length,0);
 env.online(1);
 await env.request("/").done;
 env.network=()=>content("Protected","text/html",401);
 assert.equal((await env.request("/").response).status,401);
 env.network=()=>content(shell(9),"text/html",200,{"Cache-Control":"private, no-store"});
 const direct=env.request("/");
 assert.match(await (await direct.response).text(),/Release 9/);
 await direct.done;
 assert.equal(env.storage.size,2);
 env.network=()=>{throw new TypeError("Offline");};
 assert.match(await (await env.request("/").response).text(),/Release 1/);
});

test("first controlled offline navigation offers a retry if no complete shell was stored",async()=>{
 const env=worker();
 const response=await env.request("/?view=calendar").response;
 assert.equal(response.status,503);
 assert.match(await response.text(),/href="">Повторить загрузку/);
});

test("push focuses a matching open workspace without overwriting drafts or opening off-origin",async()=>{
 const env=worker();
 env.windows=["/ai.html","/?view=reports","/?view=orders"];
 const notification=url=>({close(){},data:{url}});
 await env.dispatch("notificationclick",{notification:notification("/")}).done;
 await env.dispatch("notificationclick",{notification:notification("https://external.invalid/")}).done;
 await env.dispatch("notificationclick",{notification:notification("/?view=orders")}).done;
 await env.dispatch("notificationclick",{notification:notification("/?view=expenses")}).done;
 assert.deepEqual(env.focuses,["/?view=reports","/?view=reports","/?view=orders"]);
 assert.deepEqual(env.opened,[origin+"/?view=expenses"]);
 await env.dispatch("push",{data:{json:()=>({body:"Новый заказ",url:"http://["})}}).done;
 assert.equal(env.notifications[0].options.data.url,"/");
});

test("runtime registers once, warms after load and never reloads on foreground or update",async()=>{
 const handlers={},documentHandlers={};
 const document={readyState:"loading",visibilityState:"visible",addEventListener:(type,handler)=>{documentHandlers[type]=handler;}};
 const messages=[],registered=[];
 let updates=0,idle;
 const registration={active:{postMessage:message=>messages.push(message.type)},async update(){updates++;}};
 const navigator={onLine:true,serviceWorker:{
  ready:Promise.resolve(registration),async register(url,options){registered.push({url,options});return registration;}
 }};
 const window={isSecureContext:true,requestIdleCallback:callback=>{idle=callback;},
  addEventListener:(kind,handler)=>{handlers[kind]=handler;},
  location:{reload(){throw new Error("Unsolicited update reload");}}};
 vm.runInNewContext(runtimeSource,{window,document,navigator,Date,setTimeout,clearTimeout});
 assert.deepEqual(Object.keys(handlers).sort(),["load","online","pageshow"]);
 assert.equal(registered.length,0,"registering does not block initial application load");
 handlers.load();
 assert.equal(registered.length,0,"registration is scheduled during idle time");
 idle();
 await Promise.all([window.__rdPwa.ready(),window.__rdPwa.ready()]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(registered.length,1);
 assert.equal(registered[0].options.updateViaCache,"none");
 assert.deepEqual(messages,["RABOTA_WARM_SHELL"]);
 handlers.pageshow({persisted:true});
 documentHandlers.visibilitychange();
 navigator.onLine=false;
 handlers.online();
 assert.equal(updates,0);
 navigator.onLine=true;
 handlers.online();
 handlers.online();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(updates,1);
 assert.equal(registered.length,1);
});

test("a browser that rejects worker registration can continue and retry after reconnecting",async()=>{
 const listeners={};
 let idle,attempts=0,warms=0;
 const registration={active:{postMessage(){warms++;}}};
 const navigator={onLine:true,serviceWorker:{ready:Promise.resolve(registration),async register(){
  if(++attempts===1)throw new Error("Service unavailable in this browser context");
  return registration;
 }}};
 const document={readyState:"complete",visibilityState:"visible",addEventListener(){}};
 const window={isSecureContext:true,requestIdleCallback:callback=>{idle=callback;},
  addEventListener:(kind,handler)=>{listeners[kind]=handler;}};
 vm.runInNewContext(runtimeSource,{window,document,navigator,Date,setTimeout,clearTimeout});
 idle();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(attempts,1);
 assert.equal(warms,0);
 listeners.online();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(attempts,2);
 assert.equal(warms,1);
});

test("manifest retains the installed standalone identity and scope",()=>{
 const manifest=JSON.parse(read("manifest.webmanifest"));
 assert.equal(manifest.id,manifest.start_url);
 assert.equal(manifest.scope,"/");
 assert.equal(manifest.display,"standalone");
 const html=read("index.html");
 assert.match(html,/<script\s+src="\/pwa-runtime\.js\?v=[\w-]+"\s+(?:defer|async)>/);
 const shellRefs=Array.from(html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(\/[^/"]+?\.(?:js|css)(?:\?[^"\s]+)?)"/g),match=>match[1]);
 assert(shellRefs.some(reference=>reference.startsWith("/app-services.js?")));
 for(const reference of shellRefs){
  assert(new URL(reference,origin).searchParams.get("v"),reference+" needs an exact cache version");
 }
});
