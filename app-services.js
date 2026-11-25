/* CRM «Работа» — общие сервисы, этап 9.
 * Supabase transport, write retry keys and display/error helpers.
 * Session lifecycle, token refresh and business decisions live in the callers.
 */
"use strict";
(function(root){
  function phoneForDisplay(phone){return String(phone||"").trim();}
  function normalizePhone(phone){
    let number=String(phone||"").replace(/\D/g,"");
    if(number.length===11&&number[0]==="8")number="7"+number.slice(1);
    if(number.length===10)number="7"+number;
    return number.length>=10&&number.length<=15?number:"";
  }
  function friendlyError(error){
    if(error&&error.code==="23505")return "В это время у выбранного мастера уже есть заказ либо запись дублируется.";
    return error instanceof Error?error.message:String(error);
  }
  function sameAuthSession(previous,next){
    const oldToken=previous?.access_token,newToken=next?.access_token;
    if(!oldToken||!newToken)return false;
    if(oldToken===newToken)return true;
    // Claims identify a token rotation here. Permission checks use server responses.
    function identity(token){
      const payload=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      const {sub,session_id}=JSON.parse(atob(payload));
      return typeof sub==="string"&&sub&&typeof session_id==="string"&&session_id
        ?JSON.stringify([sub,session_id]):null;
    }
    try{
      const previousIdentity=identity(oldToken);
      return Boolean(previousIdentity&&previousIdentity===identity(newToken));
    }catch(error){return false;}
  }
  function createWriteIntents(namespace,{getStorage=()=>root?.sessionStorage,crypto=root?.crypto}={}){
    const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    async function storageKey(actor,payload){
      if(!actor||!crypto?.subtle||typeof crypto.randomUUID!=="function")
        throw new Error("Не удалось создать номер операции.");
      const bytes=new TextEncoder().encode(JSON.stringify([actor,payload]));
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      return "rabota-write-intent-v2."+namespace+"."+fingerprint;
    }
    function withStorage(work){
      try{return work(getStorage());}
      catch(cause){
        const error=new Error("Запись не отправлена. Не удалось сохранить номер операции в этой вкладке. Освободите место и повторите.",{cause});
        error.code="WRITE_INTENT_STORAGE";
        throw error;
      }
    }
    function readIds(storage,key){
      const saved=storage.getItem(key);
      if(saved===null||saved===undefined)return [];
      const ids=JSON.parse(saved);
      if(!Array.isArray(ids)||ids.some(id=>typeof id!=="string"||!uuid.test(id)))
        throw Error("Invalid write intent record");
      return ids;
    }
    function add(storage,key,ids){
      const requestId=crypto.randomUUID();
      const saved=JSON.stringify([...ids,requestId]);
      storage.setItem(key,saved);
      if(storage.getItem(key)!==saved)throw Error("Write intent was not persisted");
      return {key,requestId,reused:false};
    }
    async function find(actor,payload){
      const key=await storageKey(actor,payload);
      return withStorage(storage=>readIds(storage,key).map(requestId=>({key,requestId,reused:true})));
    }
    async function begin(actor,payload){
      const key=await storageKey(actor,payload);
      return withStorage(storage=>add(storage,key,readIds(storage,key)));
    }
    async function get(actor,payload,{expectedKey}={}){
      const key=await storageKey(actor,payload);
      if(expectedKey&&expectedKey!==key)
        throw new Error("Проверьте предыдущую операцию перед изменением реквизитов.");
      return withStorage(storage=>{
        const ids=readIds(storage,key);
        if(ids.length)return {key,requestId:ids[0],reused:true};
        return add(storage,key,ids);
      });
    }
    async function finish({key,requestId}){
      const storage=getStorage();
      const ids=readIds(storage,key);
      const remaining=ids.filter(id=>id!==requestId);
      if(remaining.length===ids.length)return;
      if(remaining.length)storage.setItem(key,JSON.stringify(remaining));
      else storage.removeItem(key);
    }
    return {get,find,begin,finish};
  }
  function focusModal(overlay,dialog,onCancel,{opener=dialog.ownerDocument.activeElement,initial=dialog}={}){
    const doc=dialog.ownerDocument;
    const backdrop=Array.from(doc.body.children).filter(node=>
      node!==overlay&&!node.inert&&node.getClientRects().length);
    for(const node of backdrop)node.inert=true;

    function onKey(event){
      if(event.key!=="Escape"&&event.key!=="Tab")return;
      const focused=doc.activeElement;
      // The order form can open a separate payment dialog above it.
      if(!dialog.contains(focused)&&focused?.closest('[aria-modal="true"],dialog[open]'))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(event.key==="Escape"){onCancel();return;}

      const controls=Array.from(dialog.querySelectorAll("button,a[href],input,select,textarea,summary,[tabindex]"))
        .filter(node=>node.tabIndex>=0&&!node.matches(":disabled")&&node.getClientRects().length&&
          doc.defaultView.getComputedStyle(node).visibility==="visible");
      const stops=controls.filter(node=>{
        if(node.type!=="radio"||!node.name)return true;
        const group=controls.filter(control=>control.type==="radio"&&control.name===node.name&&control.form===node.form);
        return node===(group.find(radio=>radio.checked)||group[0]);
      });
      const index=stops.indexOf(focused);
      const next=event.shiftKey?(index<=0?stops.length-1:index-1):(index+1)%stops.length;
      (stops[next]||dialog).focus();
    }

    doc.addEventListener("keydown",onKey,true);
    initial.focus({preventScroll:true});
    return (restoreFocus=true)=>{
      doc.removeEventListener("keydown",onKey,true);
      for(const node of backdrop)node.inert=false;
      if(restoreFocus&&opener?.isConnected&&opener.getClientRects().length)
        opener.focus({preventScroll:true});
    };
  }
  async function withRequestDeadline(work, milliseconds, message){
    const controller=new AbortController();
    let timer;
    try{
      const deadline=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          const error=new Error(message);
          error.code="REQUEST_TIMEOUT";
          reject(error);
          controller.abort();
        },milliseconds);
      });
      return await Promise.race([deadline,work(controller.signal)]);
    }finally{clearTimeout(timer);}
  }
  function createSharedServices(deps){
    if(!deps||typeof deps.url!=="string"||!deps.url.startsWith("https://")||
      typeof deps.key!=="string"||
      typeof deps.getSession!=="function"||
      typeof deps.ensureSession!=="function"||
      typeof deps.fetch!=="function")
      throw new TypeError("Неверные зависимости сетевого сервиса");
    const SUPABASE_URL=deps.url;
    const SUPABASE_KEY=deps.key;
    const requestFetch=deps.fetch;
    const getSession=deps.getSession;
    const ensureSession=deps.ensureSession;
    const getScope=deps.getScope||(()=>null);

    async function authRequest(path,method,payload,authenticated,{session=getSession(),signal}={}){
      const headers={apikey:SUPABASE_KEY,"Content-Type":"application/json"};
      if(authenticated&&session&&session.access_token)
        headers.Authorization="Bearer "+session.access_token;
      const response=await requestFetch(SUPABASE_URL+"/auth/v1/"+path,{
        method:method||"GET",headers,body:payload?JSON.stringify(payload):undefined,
        ...(signal?{signal}:{})
      });
      const value=await response.json().catch(()=>({}));
      if(!response.ok){
        const error=new Error(value?.msg||value?.error_description||value?.message||value?.error||"Ошибка авторизации");
        error.status=response.status;
        throw error;
      }
      return value;
    }
    async function dbRequest(path,method,payload,{signal}={}){
      const scope=getScope();
      signal?.throwIfAborted();
      await ensureSession();
      signal?.throwIfAborted();
      const session=getSession();
      if(scope!==getScope()||!session?.access_token)
        throw new Error("Сеанс изменился. Повторите действие.");
      const headers={apikey:SUPABASE_KEY,Authorization:"Bearer "+session.access_token,Accept:"application/json"};
      if(payload!==undefined)headers["Content-Type"]="application/json";
      if(method!=="GET")headers.Prefer="return=representation";
      const response=await requestFetch(SUPABASE_URL+"/rest/v1/"+path,{
        method,headers,body:payload===undefined?undefined:JSON.stringify(payload),
        ...(signal?{signal}:{})
      });
      const value=await response.json().catch(()=>null);
      if(scope!==getScope())throw new Error("Сеанс изменился. Повторите действие.");
      if(!response.ok){
        const err=new Error(value&&(value.message||value.error)||"Ошибка базы данных ("+response.status+")");
        err.code=value&&value.code;
        err.status=response.status;
        throw err;
      }
      return value;
    }
    async function removePushSubscription(session,endpoint,signal){
      const response=await requestFetch(SUPABASE_URL+"/rest/v1/rabota_push_subscriptions?endpoint=eq."+encodeURIComponent(endpoint),{
        method:"DELETE",signal,headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+session.access_token}
      });
      if(!response.ok)throw new Error("Не удалось отключить подписку на уведомления.");
    }
    return {authRequest,dbRequest,removePushSubscription,withRequestDeadline,phoneForDisplay,normalizePhone,friendlyError,sameAuthSession};
  }
  if(root){
    root.__rdCreateSharedServices=createSharedServices;
    root.__rdCreateWriteIntents=createWriteIntents;
    root.__rdFocusModal=focusModal;
  }
  if(typeof module!=="undefined"&&module.exports)
    module.exports={createSharedServices,createWriteIntents,withRequestDeadline,phoneForDisplay,normalizePhone,friendlyError,sameAuthSession};
})(typeof window!=="undefined"?window:null);
