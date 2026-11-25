/* The header bell uses existing master notifications and Web Push delivery. */
"use strict";
(()=>{
  const root=document.getElementById("masterPushPanel");
  if(!root)return;
  const bell=document.getElementById("pushBellBtn");
  const popup=document.getElementById("pushPopover");
  const close=document.getElementById("closePushPopover");
  const masterContent=document.getElementById("pushMasterContent");
  const roleMessage=document.getElementById("pushRoleMessage");
  const toggle=document.getElementById("pushToggle");
  const counter=document.getElementById("pushUnreadCount");
  const list=document.getElementById("recentNotificationList");
  const reviewList=document.getElementById("masterStatusReviewList");
  const test=document.getElementById("testPushBtn");
  const toggleText=document.getElementById("pushToggleText");
  const status=document.getElementById("pushStatus");
  let busy=false,confirmed=false,initializedUser=null,accessVersion=0;
  let unread=null,unreadRequest=null,unreadVersion=0,reviewKey=null,unreadError="";
  const marking=new Set();
  const masterId=()=>currentRole==="master"?currentUser?.id||null:null;
  const ownsAccess=(version,account)=>version===accessVersion&&account===masterId()&&Boolean(account);

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
  function updateRole(){
    const master=Boolean(masterId());
    masterContent.hidden=!master;
    roleMessage.hidden=master;
  }
  function pop(open,restoreFocus=false){
    const show=typeof open==="boolean"?open:popup.hidden;
    if(show){
      window.__rdCloseProfile?.();
      updateRole();
    }
    popup.hidden=!show;
    bell.setAttribute("aria-expanded",String(show));
    if(restoreFocus)bell.focus({preventScroll:true});
    if(show)return loadUnread().catch(()=>{});
  }
  bell.addEventListener("click",event=>{
    const opening=popup.hidden;
    const pending=pop();
    if(opening&&event.detail===0)close.focus({preventScroll:true});
    return pending;
  });
  close.addEventListener("click",()=>pop(false,true));
  document.addEventListener("pointerdown",event=>{
    if(!popup.hidden&&!root.contains(event.target))pop(false);
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!popup.hidden)pop(false,true);
  });

  function refreshStatusReviews(){
    const reviews=window.__rdMasterStatusReview?.()||[];
    const key=JSON.stringify(reviews.map(({id,name,date,time,status})=>[id,name,date,time,status]));
    if(reviewKey===key)return;
    reviewKey=key;
    reviewList.replaceChildren();
    reviewList.hidden=reviews.length===0;
    if(!reviews.length)return;
    reviewList.append(make("div","push-list-heading push-review-heading",
      "Проверить статус · "+reviews.length));
    for(const order of [...reviews].sort((a,b)=>
      String(b.date||"").localeCompare(String(a.date||""))||
      String(b.time||"").localeCompare(String(a.time||""))).slice(0,30)){
      const action=make("button","push-review-order");
      action.type="button";
      action.append(make("strong","","Проверить: "+(order.name||"Клиент")),
        make("span","",(order.date?formatDate(order.date):"Без даты")+
          " · "+(order.time||"Без времени")+" · "+(order.status||"Записан")));
      action.addEventListener("click",()=>{
        pop(false);
        window.__rdOpenMasterOrder?.(order.id);
      });
      reviewList.append(action);
    }
    if(reviews.length>30)reviewList.append(make("div","push-empty","Показаны первые 30 заказов."));
  }
  function updateBadge(){
    const total=unread?.length||0;
    counter.textContent=total?(total>99?"99+":String(total)):"";
    counter.hidden=total===0;
    bell.setAttribute("aria-label","Открыть уведомления"+(total?". Непрочитанных: "+total:""));
  }
  function renderUnread(){
    const account=masterId(),version=accessVersion;
    list.replaceChildren();
    if(!unread){
      list.append(make("div","push-empty","Загружаем новые заявки…"));
      return;
    }
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
      read.disabled=marking.has(record.id);
      read.addEventListener("click",async()=>{
        if(!ownsAccess(version,account)||marking.has(record.id))return;
        marking.add(record.id);
        read.disabled=true;
        try{
          const updated=await dbRequest("rabota_order_notifications?id=eq."+encodeURIComponent(record.id)+"&read_at=is.null","PATCH",{read_at:new Date().toISOString()});
          if(!ownsAccess(version,account))return;
          if(!Array.isArray(updated)||updated.length!==1)throw new Error("Не удалось отметить заявку прочитанной.");
          unreadVersion++;
          if(unread)unread=unread.filter(item=>item.id!==record.id);
          updateBadge();
          renderUnread();
          await loadUnread();
        }catch(err){if(ownsAccess(version,account))feedback(friendlyError(err),true);}
        finally{
          if(ownsAccess(version,account)){
            marking.delete(record.id);
            read.disabled=false;
            if(!read.isConnected&&unread?.some(item=>item.id===record.id))renderUnread();
          }
        }
      });
      row.append(read);
      list.append(row);
    }
    if(unread.length>30)list.append(make("div","push-empty","Показаны первые 30. Отметьте просмотренные для остальных."));
  }
  async function loadUnread(){
    const account=masterId(),access=accessVersion,version=unreadVersion;
    if(!account)return;
    refreshStatusReviews();
    if(unreadRequest?.account===account&&unreadRequest.version===version)return unreadRequest.promise;
    const request={account,version};
    request.promise=(async()=>{
      const records=new Map();
      for(let offset=0;offset<100000;offset+=500){
        const rows=await dbRequest("rabota_order_notifications?select=id,client_name,visit_date,visit_time,created_at&read_at=is.null&order=created_at.desc,id.desc&limit=500&offset="+offset,"GET");
        if(!ownsAccess(access,account)||version!==unreadVersion)return;
        if(!Array.isArray(rows))throw new Error("Не удалось загрузить новые заявки.");
        for(const row of rows)records.set(row.id,row);
        if(rows.length<500)break;
      }
      const next=[...records.values()];
      if(!unread||JSON.stringify(unread)!==JSON.stringify(next)){
        unread=next;
        updateBadge();
        renderUnread();
      }
      if(unreadError&&status.textContent===unreadError)feedback("");
      unreadError="";
    })().catch(error=>{
      if(!ownsAccess(access,account)||version!==unreadVersion)return;
      if(error.status===401||error.status===403||error.code==="42501"){
        unread=null;updateBadge();
      }
      if(!unread){
        list.replaceChildren(make("div","push-empty","Не удалось загрузить новые заявки."));
      }
      unreadError="Не удалось обновить уведомления: "+friendlyError(error);
      feedback(unreadError,true);
      throw error;
    }).finally(()=>{if(unreadRequest===request)unreadRequest=null;});
    unreadRequest=request;
    return request.promise;
  }
  async function getSubscription(){
    if(!("serviceWorker" in navigator))return null;
    const registration=await navigator.serviceWorker.getRegistration("/");
    return registration?.pushManager?.getSubscription()||null;
  }
  async function syncToggle(){
    const account=masterId(),version=accessVersion;
    if(!account||busy)return;
    toggle.disabled=true;
    try{
      if(!window.isSecureContext||!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)){
        state(false);
        feedback("На этом устройстве push не поддерживаются.",true);
        return;
      }
      const sub=await getSubscription();
      if(!ownsAccess(version,account))return;
      let enabled=false;
      if(sub&&Notification.permission==="granted"){
        const registrations=await dbRequest("rabota_push_subscriptions?select=active&endpoint=eq."+encodeURIComponent(sub.endpoint)+"&limit=1","GET");
        enabled=Array.isArray(registrations)&&registrations.some(x=>x.active);
      }
      if(ownsAccess(version,account))state(enabled);
    }catch(err){if(ownsAccess(version,account))feedback("Ошибка проверки уведомлений: "+friendlyError(err),true);}
    finally{if(ownsAccess(version,account))toggle.disabled=false;}
  }
  function vapidBytes(encoded){
    const base64=(encoded+"=".repeat((4-encoded.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");
    return Uint8Array.from(atob(base64),x=>x.charCodeAt(0));
  }
  async function enablePush(version,account){
    if(!window.isSecureContext||!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))
      throw new Error("Для уведомлений нужен поддерживаемый браузер и установленное приложение.");
    const isIOS=/iPad|iPhone|iPod/i.test(navigator.userAgent);
    const installed=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
    if(isIOS&&!installed)throw new Error("На iPhone откройте Safari → Поделиться → На экран «Домой», затем включите уведомления в установленном приложении.");
    // Permission prompt is deliberately the first async operation after a user's switch action.
    const permission=await Notification.requestPermission();
    if(permission!=="granted")throw new Error("Разрешите уведомления в настройках телефона.");
    if(!ownsAccess(version,account))return;
    await navigator.serviceWorker.register("/sw.js",{scope:"/"});
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!ownsAccess(version,account))return;
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(PUSH_PUBLIC_KEY)});
    if(!ownsAccess(version,account))return;
    await dbRequest("rpc/rabota_register_push_subscription","POST",{p_subscription:sub.toJSON()});
  }
  async function disablePush(version=accessVersion,account=masterId()){
    if(!account)return;
    const sub=await getSubscription();
    if(!sub||!ownsAccess(version,account))return;
    await dbRequest("rabota_push_subscriptions?endpoint=eq."+encodeURIComponent(sub.endpoint),"DELETE");
    if(!ownsAccess(version,account))return;
    if(!await sub.unsubscribe())throw new Error("Не удалось отключить уведомления в браузере.");
  }
  toggle.addEventListener("change",async()=>{
    const account=masterId(),version=accessVersion;
    if(!account||busy)return;
    const wanted=toggle.checked;
    busy=true;toggle.disabled=true;
    try{
      if(wanted)await enablePush(version,account);
      else await disablePush(version,account);
      if(!ownsAccess(version,account))return;
      state(wanted);
      feedback(wanted?"Уведомления на этот телефон включены. Звук зависит от настроек телефона.":"Уведомления на этот телефон выключены.");
    }catch(err){
      if(ownsAccess(version,account)){state(confirmed);feedback("Не удалось "+(wanted?"включить":"отключить")+": "+friendlyError(err),true);}
    }finally{if(ownsAccess(version,account)){busy=false;toggle.disabled=false;}}
  });
  test.addEventListener("click",async()=>{
    const account=masterId(),version=accessVersion;
    if(!account||test.disabled)return;
    test.disabled=true;
    try{
      await ensureSession();
      if(!ownsAccess(version,account))return;
      const res=await fetch(SUPABASE_URL+"/functions/v1/rabota-push",{
        method:"POST",
        headers:{"Content-Type":"application/json",apikey:SUPABASE_KEY,Authorization:"Bearer "+session.access_token},
        body:JSON.stringify({action:"test"})
      });
      const data=await res.json().catch(()=>({}));
      if(!ownsAccess(version,account))return;
      if(!res.ok||!data.delivered)throw new Error("Проверочное уведомление не доставлено.");
      feedback("Проверочное уведомление отправлено на телефон.");
    }catch(err){if(ownsAccess(version,account))feedback(friendlyError(err),true);}
    finally{if(ownsAccess(version,account))test.disabled=false;}
  });
  function reset(){
    accessVersion++;unreadVersion++;
    unread=null;unreadRequest=null;unreadError="";reviewKey=null;initializedUser=null;
    busy=false;marking.clear();state(false);toggle.disabled=true;test.disabled=false;
    reviewList.replaceChildren();reviewList.hidden=true;
    feedback("");pop(false);updateRole();updateBadge();renderUnread();
  }
  window.__rdRefreshMasterNotices=loadUnread;
  window.__rdClosePushPopover=()=>pop(false);
  window.__rdDisableMasterPush=disablePush;
  window.__rdRemovePushOnLogout=async(erase,isCurrent)=>{
    const subscription=await getSubscription();
    if(!subscription||!isCurrent())return;
    await erase(subscription.endpoint);
    if(isCurrent())await subscription.unsubscribe();
  };
  window.__rdResetMasterNotices=reset;
  window.__rdInitMasterPush=()=>{
    const account=masterId();
    updateRole();
    if(!account||initializedUser===account)return;
    initializedUser=account;
    syncToggle();
    loadUnread().catch(()=>{});
  };
  // In case login completed before this external script loaded.
  if(document.getElementById("appScreen")?.hidden===false)window.__rdInitMasterPush();
})();
