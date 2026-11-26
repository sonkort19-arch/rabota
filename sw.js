/* Static application shell and Web Push. Account data always uses the network. */
"use strict";
const origin=self.location.origin;
const shellUrl=origin+"/";
const metadataName="rabota-shell-v1";
const snapshotPrefix=metadataName+"-";
const metadataUrl=origin+"/.rabota-shell-metadata";
const navigationWait=1800;
const firstLoadWait=8000;
const releaseWait=1400;
let snapshotState;
let snapshotWork=Promise.resolve();
let warming;

function readSnapshotState(){
 if(!snapshotState){
  snapshotState=(async()=>{
   const metadata=await caches.open(metadataName);
   const response=await metadata.match(metadataUrl);
   return response?response.json():{};
  })().catch(()=>{snapshotState=undefined;return {};});
 }
 return snapshotState;
}
async function matchSnapshot(url,allowPrevious=false){
 const lookup=(async()=>{
  const {current,previous}=await readSnapshotState();
  if(current){
   const response=await caches.match(url,{cacheName:current});
   if(response)return response;
  }
  if(allowPrevious&&previous)return await caches.match(url,{cacheName:previous});
 })().catch(()=>undefined);
 return within(lookup,350);
}
function appDocument(url){
 return url.origin===origin&&(url.pathname==="/"||url.pathname==="/index.html");
}
function appAsset(url){
 return url.origin===origin&&/^\/[a-z0-9_-]+\.(?:js|css)$/i.test(url.pathname);
}
function shellAssets(html){
 const references=[];
 for(const tag of html.match(/<(?:script|link)\b[^>]*>/gi)||[]){
  const script=/^<script\b/i.test(tag);
  if(!script&&!/\brel=["']stylesheet["']/i.test(tag))continue;
  const reference=(script?/\bsrc=["']([^"']+)["']/:/\bhref=["']([^"']+)["']/).exec(tag)?.[1];
  if(!reference)continue;
  const url=new URL(reference,shellUrl);
  if(appAsset(url))references.push(url.href);
 }
 return [...new Set(references)];
}
function publicResponse(response){
 return response.status===200&&!response.redirected&&
  !/(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("cache-control")||"");
}
function within(work,timeout){
 let timer;
 const limit=new Promise(resolve=>{timer=setTimeout(resolve,timeout);});
 return Promise.race([work,limit]).finally(()=>clearTimeout(timer));
}
async function snapshotName(html){
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(html));
 return snapshotPrefix+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
}
async function fetchWithDeadline(request,options,timeout,consume=false){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(request,{...options,signal:controller.signal});
  if(consume&&publicResponse(response))await response.clone().arrayBuffer();
  return response;
 }finally{clearTimeout(timer);}
}
async function buildSnapshot(response){
 if(!publicResponse(response)||!response.headers.get("content-type")?.includes("text/html"))return "other";
 const html=await response.clone().text();
 if(!html.includes('id="loginForm"')||!html.includes('id="appScreen"'))return "other";
 const assets=shellAssets(html);
 if(!assets.length)return;
 const name=await snapshotName(html);
 const {current,previous}=await readSnapshotState();
 if(current===name&&await caches.match(shellUrl,{cacheName:name}))return "ready";
 const snapshot=await caches.open(name);
 try{
  if(!await snapshot.match(shellUrl)){
   // Publish the new snapshot only after all linked CSS and JS are safely in storage.
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),12000);
   try{
    const results=await Promise.allSettled(assets.map(async asset=>{
     const url=new URL(asset);
     const resource=await fetch(asset,{
      credentials:"omit",cache:url.searchParams.has("v")?"force-cache":"no-cache",
      redirect:"error",signal:controller.signal
     });
     const type=resource.headers.get("content-type")||"";
     if(!publicResponse(resource)||!(url.pathname.endsWith(".css")?type.includes("text/css"):
       /(?:java|ecma)script/i.test(type)))throw new Error("Unavailable shell asset: "+url.pathname);
     await snapshot.put(asset,resource);
    }));
    if(results.some(result=>result.status==="rejected"))throw new Error("Incomplete application shell");
    await snapshot.put(shellUrl,response);
   }finally{clearTimeout(timer);}
  }
  const metadata=await caches.open(metadataName);
  const next={current:name,previous:current!==name?current:previous};
  await metadata.put(metadataUrl,new Response(JSON.stringify(next)));
  snapshotState=Promise.resolve(next);
  if(previous&&previous!==name&&previous!==current)await caches.delete(previous).catch(()=>{});
  return "ready";
 }catch(error){
  if(name!==current&&name!==previous)await caches.delete(name);
  throw error;
 }
}
function cacheSnapshot(response){
 snapshotWork=snapshotWork.then(()=>buildSnapshot(response)).catch(()=>{});
 return snapshotWork;
}
function warmShell(){
 if(!warming)warming=(async()=>{
  if(await matchSnapshot(shellUrl))return;
  const response=await fetchWithDeadline(shellUrl,{credentials:"omit",cache:"no-cache",redirect:"error"},firstLoadWait,true);
  await cacheSnapshot(response);
 })().finally(()=>{warming=null;});
 return warming;
}
function unavailableShell(){
 return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
 <title>Работа</title><style>body{font:16px system-ui;color:#172033;background:#fbfcff;margin:0;padding:28px}main{max-width:30rem;margin:12vh auto}a{color:#174cc8}</style>
 <main><h1>Не удалось открыть CRM</h1><p>Проверьте подключение к интернету.</p><a href="">Повторить загрузку</a></main></html>`,{
  status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}
 });
}
function navigate(event){
 const fallback=matchSnapshot(shellUrl);
 const latest=fetchWithDeadline(event.request,{cache:"no-cache"},firstLoadWait,true).then(async response=>{
  const cached=await fallback;
  if(response.status>=500)return {response:cached||unavailableShell()};
  const etag=response.headers.get("etag");
  const unchanged=etag&&!etag.startsWith("W/")&&etag===cached?.headers.get("etag");
  const snapshot=publicResponse(response)&&!unchanged?cacheSnapshot(response.clone()):null;
  return {response,snapshot};
 }).catch(()=>null);
 event.respondWith((async()=>{
  const cached=await fallback;
  const candidate=await (cached?within(latest,navigationWait):latest);
  if(!candidate)return cached||unavailableShell();
  if(!cached||!candidate.snapshot)return candidate.response;
  const status=await within(candidate.snapshot,releaseWait);
  return status==="ready"||status==="other"?candidate.response:cached;
 })());
 // The next opening can use a healthy release even if the current connection is too slow for it.
 event.waitUntil(latest.then(candidate=>candidate?.snapshot));
}
async function loadAsset(request,url){
 const versioned=url.searchParams.has("v");
 const cached=await matchSnapshot(url.href,versioned);
 if(cached&&versioned)return cached;
 if(!cached)return fetch(request);
 try{
  const response=await fetchWithDeadline(request,{cache:"no-cache"},navigationWait,true);
  return response.status>=500?cached:response;
 }catch(_){return cached;}
}
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("message",event=>{
 if(event.data?.type==="RABOTA_WARM_SHELL")event.waitUntil(warmShell().catch(()=>{}));
});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET"||request.headers.has("authorization")||request.headers.has("range"))return;
 const url=new URL(request.url);
 if(request.mode==="navigate"&&appDocument(url)){
  navigate(event);
 }else if(["script","style"].includes(request.destination)&&appAsset(url)){
  event.respondWith(loadAsset(request,url));
 }
});

function notificationUrl(path){
 try{
  const url=new URL(typeof path==="string"?path:"/",origin);
  if(url.origin===origin)return url;
 }catch(_){/* Invalid payload links fall back to the CRM. */}
 return new URL(shellUrl);
}
self.addEventListener("push",event=>{
 let data={title:"Работа",body:"Вам назначена новая заявка",url:"/",tag:"rabota-new-order"};
 try{if(event.data)data={...data,...event.data.json()};}catch(_){if(event.data)data.body=event.data.text();}
 const url=notificationUrl(data.url);
 event.waitUntil(self.registration.showNotification(String(data.title||"Работа"),{
  body:String(data.body||"Новая заявка"),
  tag:String(data.tag||"rabota-new-order"),
  renotify:true,
  data:{url:url.pathname+url.search},
  vibrate:[200,100,200]
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const destination=notificationUrl(event.notification.data?.url);
 event.waitUntil((async()=>{
  const open=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  const existing=open.find(tab=>{
   const current=new URL(tab.url);
   return current.href===destination.href||
    (appDocument(destination)&&!destination.search&&!destination.hash&&appDocument(current));
  });
  if(existing){await existing.focus();return;}
  if(self.clients.openWindow)await self.clients.openWindow(destination.href);
 })());
});
