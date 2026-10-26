/* Работа: push-уведомления о новых назначениях, без кэширования заказов. */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
 let data={title:"Работа",body:"Вам назначена новая заявка",url:"/",tag:"rabota-new-order"};
 try{if(event.data)data={...data,...event.data.json()};}catch(_){if(event.data)data.body=event.data.text();}
 const url=new URL(typeof data.url==="string"?data.url:"/",self.location.origin);
 if(url.origin!==self.location.origin)url.pathname="/";
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
 const path=event.notification.data?.url||"/";
 const destination=new URL(path,self.location.origin).href;
 event.waitUntil((async()=>{
  const open=await clients.matchAll({type:"window",includeUncontrolled:true});
  for(const tab of open){
   if(new URL(tab.url).origin===self.location.origin){
    if("navigate" in tab)await tab.navigate(destination);
    await tab.focus();return;
   }
  }
  if(clients.openWindow)await clients.openWindow(destination);
 })());
});