/* Registration and background updates never block session recovery or reload a working page. */
"use strict";
(()=>{
 const worker=navigator.serviceWorker;
 if(!window.isSecureContext||!worker)return;
 const workerOptions={scope:"/",updateViaCache:"none"};
 const updateInterval=30*60*1000;
 const requestLimit=8000;
 let pendingRegistration=null,registration=null,pendingCheck=null,lastCheck=-Infinity;

 function bounded(work){
  let timer;
  const limit=new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(new Error("Не удалось запустить службу приложения. Попробуйте ещё раз.")),requestLimit);
  });
  return Promise.race([work,limit]).finally(()=>clearTimeout(timer));
 }
 function register(){
  if(registration)return Promise.resolve(registration);
  if(!pendingRegistration){
   pendingRegistration=bounded(worker.register("/sw.js",workerOptions)).then(value=>{
    registration=value;
    return value;
   }).finally(()=>{pendingRegistration=null;});
  }
  return pendingRegistration;
 }
 async function ready(){
  await register();
  return bounded(worker.ready);
 }
 function check(force=false){
  if(pendingCheck||document.visibilityState==="hidden"||navigator.onLine===false)return;
  if(!force&&Date.now()-lastCheck<updateInterval)return;
  lastCheck=Date.now();
  pendingCheck=(async()=>{
   const alreadyRegistered=Boolean(registration);
   const active=await ready();
   active.active?.postMessage({type:"RABOTA_WARM_SHELL"});
   if(alreadyRegistered)await bounded(active.update());
  })().catch(()=>{
   // A failed start can be retried from the foreground without a burst of update checks.
   lastCheck=Date.now()-updateInterval+30000;
  }).finally(()=>{pendingCheck=null;});
 }
 function schedule(){
  if(window.requestIdleCallback)window.requestIdleCallback(()=>void check(),{timeout:2500});
  else setTimeout(()=>void check(),700);
 }
 window.__rdPwa={ready};
 if(document.readyState==="complete")schedule();
 else window.addEventListener("load",schedule,{once:true});
 window.addEventListener("pageshow",event=>{if(event.persisted)void check();});
 window.addEventListener("online",()=>void check(true));
 document.addEventListener("visibilitychange",()=>void check());
})();
