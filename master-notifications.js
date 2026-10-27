/* Compact master-only notifications. Existing Supabase RLS and Web Push delivery remain unchanged. */
"use strict";
(()=>{
  const root=document.getElementById("masterPushPanel");
  if(!root)return;
  const bell=document.getElementById("pushBellBtn");
  const popup=document.getElementById("pushPopover");
  const toggle=document.getElementById("pushToggle");
  const counter=document.getElementById("pushUnreadCount");
  const list=document.getElementById("recentNotificationList");
  const test=document.getElementById("testPushBtn");
  const toggleText=document.getElementById("pushToggleText");
  const status=document.getElementById("pushStatus");
  let busy=false, confirmed=false;

  function feedback(message,error=false){
    status.textContent=message||"";
    status.classList.toggle("is-error",!!error);
  }
  function state(on){
    confirmed=!!on;
    toggle.checked=confirmed;
    toggleText.textContent=confirmed?"Вкл":"Выкл";
    test.hidden=!confirmed;
  }
  function pop(open){
    const show=typeof open==="boolean"?open:popup.hidden;
    popup.hidden=!show;
    bell.setAttribute("aria-expanded",String(show));
    if(show)loadUnread().catch(err=>feedback(friendlyError(err),true));
  }
  bell.addEventListener("click",()=>pop());
  document.getElementById("closePushPopover").addEventListener("click",()=>pop(false));
  document.addEventListener("click",event=>{
    if(!popup.hidden&&!root.contains(event.target))pop(false);
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!popup.hidden){pop(false);bell.focus();}
  });

  async function loadUnread(){
    if(currentRole!=="master"||!currentUser)return;
    const unread=[];
    // Server-side unread filter, pagination: badge is not limited by 15 recent rows.
    for(let offset=0;offset<100000;offset+=500){
      const rows=await dbRequest("rabota_order_notifications?select=id,client_name,visit_date,visit_time,created_at&read_at=is.null&order=created_at.desc&limit=500&offset="+offset,"GET");
      if(!Array.isArray(rows))throw new Error("Не удалось загрузить новые заявки.");
      unread.push(...rows);
      if(rows.length<500)break;
    }
    counter.textContent=unread.length>99?"99+":String(unread.length);
    counter.hidden=unread.length===0;
    bell.setAttribute("aria-label",unread.length?"Новых заявок: "+unread.length+". Открыть список":"Новых заявок нет. Открыть уведомления");
    list.replaceChildren();
    if(unread.length===0){
      list.append(make("div","push-empty","Новых заявок нет"));
      return;
    }
    for(const record of unread.slice(0,30)){
      const row=make("div","push-notice");
      row.append(make("strong","","Новая заявка: "+(record.client_name||"Клиент")));
      row.append(make("span","",(record.visit_date?formatDate(record.visit_date):"Дата уточняется")+" в "+(record.visit_time?String(record.visit_time).slice(0,5):"время уточняется")));
      const read=make("button","secondary","Прочитано");
      read.type="button";
      read.addEventListener("click",async()=>{
        read.disabled=true;
        try{
          const updated=await dbRequest("rabota_order_notifications?id=eq."+encodeURIComponent(record.id)+"&read_at=is.null","PATCH",{read_at:new Date().toISOString()});
          if(!Array.isArray(updated)||updated.length!==1)throw new Error("Не удалось отметить заявку прочитанной.");
          await loadUnread();
        }catch(err){read.disabled=false;feedback(friendlyError(err),true);}
      });
      row.append(read);
      list.append(row);
    }
    if(unread.length>30)list.append(make("div","push-empty","Показаны первые 30. Отметьте просмотренные для остальных."));
  }
  async function getSubscription(){
    if(!("serviceWorker" in navigator))return null;
    const registration=await navigator.serviceWorker.getRegistration("/");
    return registration?.pushManager?.getSubscription()||null;
  }
  async function syncToggle(){
    if(currentRole!=="master"||busy)return;
    toggle.disabled=true;
    try{
      if(!window.isSecureContext||!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)){
        state(false);
        feedback("На этом устройстве push не поддерживаются.",true);
        return;
      }
      const sub=await getSubscription();
      let enabled=false;
      if(sub&&Notification.permission==="granted"){
        const registrations=await dbRequest("rabota_push_subscriptions?select=active&endpoint=eq."+encodeURIComponent(sub.endpoint)+"&limit=1","GET");
        enabled=Array.isArray(registrations)&&registrations.some(x=>x.active);
      }
      state(enabled);
    }catch(err){feedback("Ошибка проверки уведомлений: "+friendlyError(err),true);}
    finally{toggle.disabled=false;}
  }
  function vapidBytes(encoded){
    const base64=(encoded+"=".repeat((4-encoded.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");
    return Uint8Array.from(atob(base64),x=>x.charCodeAt(0));
  }
  async function enablePush(){
    if(!window.isSecureContext||!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))
      throw new Error("Для уведомлений нужен поддерживаемый браузер и установленное приложение.");
    const isIOS=/iPad|iPhone|iPod/i.test(navigator.userAgent);
    const installed=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
    if(isIOS&&!installed)throw new Error("На iPhone откройте Safari → Поделиться → На экран «Домой», затем включите уведомления в установленном приложении.");
    // Permission prompt is deliberately the first async operation after a user's switch action.
    const permission=await Notification.requestPermission();
    if(permission!=="granted")throw new Error("Разрешите уведомления в настройках телефона.");
    await navigator.serviceWorker.register("/sw.js",{scope:"/"});
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(PUSH_PUBLIC_KEY)});
    await dbRequest("rpc/rabota_register_push_subscription","POST",{p_subscription:sub.toJSON()});
  }
  async function disablePush(){
    const sub=await getSubscription();
    if(!sub)return;
    await dbRequest("rabota_push_subscriptions?endpoint=eq."+encodeURIComponent(sub.endpoint),"DELETE");
    if(!await sub.unsubscribe())throw new Error("Не удалось отключить уведомления в браузере.");
  }
  toggle.addEventListener("change",async()=>{
    if(busy)return;
    const wanted=toggle.checked;
    busy=true;toggle.disabled=true;
    try{
      if(wanted)await enablePush();
      else await disablePush();
      state(wanted);
      feedback(wanted?"Уведомления на этот телефон включены. Звук зависит от настроек телефона.":"Уведомления на этот телефон выключены.");
    }catch(err){state(confirmed);feedback("Не удалось "+(wanted?"включить":"отключить")+": "+friendlyError(err),true);}
    finally{busy=false;toggle.disabled=false;}
  });
  test.addEventListener("click",async()=>{
    test.disabled=true;
    try{
      await ensureSession();
      const res=await fetch(SUPABASE_URL+"/functions/v1/rabota-push",{
        method:"POST",
        headers:{"Content-Type":"application/json",apikey:SUPABASE_KEY,Authorization:"Bearer "+session.access_token},
        body:JSON.stringify({action:"test"})
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.delivered)throw new Error("Проверочное уведомление не доставлено.");
      feedback("Проверочное уведомление отправлено на телефон.");
    }catch(err){feedback(friendlyError(err),true);}
    finally{test.disabled=false;}
  });
  window.__rdRefreshMasterNotices=loadUnread;
  window.__rdDisableMasterPush=disablePush;
  window.__rdInitMasterPush=()=>{
    if(currentRole!=="master")return;
    syncToggle();
    loadUnread().catch(err=>feedback(friendlyError(err),true));
  };
  // In case login completed before this external script loaded.
  if(currentRole==="master"&&currentUser)window.__rdInitMasterPush();
})();
