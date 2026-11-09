/* Работа · Лиды: shared Supabase queue with protected editor and local preview import. */
"use strict";
(()=>{
  const $=id=>document.getElementById(id);
  const node=(tag,cls="",value)=>{const n=document.createElement(tag);n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
  const group=(cls,...children)=>{const n=node("div",cls);n.append(...children);return n};
  const btn=(label,cls,action)=>{const n=node("button",cls,label);n.type="button";n.addEventListener("click",action);return n};
  const text=(v)=>String(v??"").trim(),cap=(s,max=500)=>text(s).slice(0,max);
  const money=value=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(value)||0)+" ₽";
  const today=(date=new Date())=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  const shifted=(iso,days)=>{const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
  const nextMonth=iso=>{const d=new Date(iso.slice(0,7)+"-01T12:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10)};
  const weekday=(iso,target)=>{const d=new Date(iso+"T12:00:00Z").getUTCDay();return shifted(iso,((target-d+7)%7)||7)};
  const nowClock=()=>new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Moscow",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
  const humanDate=iso=>iso?new Date(iso+"T12:00:00Z").toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}):"не назначена";
  const number=x=>x===null||x===undefined||x===""?null:Number(x);
  const calc=(r,c)=>{const a=number(r),b=number(c);return (a===null||Number.isInteger(a)&&a>=0)&&(b===null||Number.isInteger(b)&&b>=0)&&((a??0)+(b??0)>0)?Math.max(10000,(a??0)*2000+(b??0)*1000):null};
  const priceLabel=(r,c)=>{const amount=calc(r,c);return amount===null?null:(r===""||r==null||c===""||c==null?"от ":"")+money(amount)};
  const statuses={new:"Новый",hot:"Горячий",waiting:"Думает / ждём",callback:"Перезвонить",ready:"Согласился",booked:"Записан",lost:"Отказался"};
  const reasons={none:"Не выбрано",salary:"После зарплаты",price:"Дорого",time:"Нет времени",family:"Посоветуется",other:"Другая причина"};
  const blank=()=>({id:null,name:"",phone:"",address:"",radiators:"",material:"",loops:"",notes:"",status:"new",reason:"none",followUpDate:"",followUpTime:"18:00",dateApprox:false,clientWillCall:false,consent:false,priceAgreed:false,updatedAt:"",history:[]});
  const phoneKey=s=>{let digits=String(s||"").replace(/\D/g,"");if(digits.length===11&&digits[0]==="8")digits="7"+digits.slice(1);if(digits.length===10)digits="7"+digits;return digits.length===11&&digits[0]==="7"?digits:""};
  function dueFromText(value,base=today()){
    const s=text(value).toLocaleLowerCase("ru");
    const after=s.match(/через\s+(\d{1,3})\s*(день|дня|дней|сут)/);
    if(after)return {date:shifted(base,Number(after[1])),approx:false,source:"через "+after[1]+" дней"};
    if(/послезавтра/.test(s))return {date:shifted(base,2),approx:false,source:"послезавтра"};
    if(/завтра/.test(s))return {date:shifted(base,1),approx:false,source:"завтра"};
    const dayMap={"понедельник":1,"вторник":2,"среду":3,"среда":3,"четверг":4,"пятницу":5,"пятница":5,"субботу":6,"суббота":6,"воскресенье":0};
    for(const [w,d] of Object.entries(dayMap))if(s.includes(w))return {date:weekday(base,d),approx:true,source:"ближайший "+w};
    const months=s.match(/через\s+(\d{1,2})\s*месяц/);
    if(months){const d=new Date(base+"T12:00:00Z");d.setUTCMonth(d.getUTCMonth()+Number(months[1]));return {date:d.toISOString().slice(0,10),approx:true,source:"через "+months[1]+" мес."}}
    if(/следующ[а-яё]*\s+месяц|нов[а-яё]*\s+месяц/.test(s))return {date:nextMonth(base),approx:true,source:"начало следующего месяца"};
    return null;
  }
  function parseNotes(value,base=today()){
    const s=text(value),lower=s.toLocaleLowerCase("ru"),o={};
    const radiator=lower.match(/(\d{1,3})\s*(?:шт\.?\s*)?(?:радиатор[а-яё]*|батаре[а-яё]*|бат(?![а-яё])|алюм[а-яё]*|биметал[а-яё]*)/)||
      lower.match(/(?:радиатор[а-яё]*|батаре[а-яё]*|бат(?![а-яё])|алюм[а-яё]*|биметал[а-яё]*)\s*(\d{1,3})/);
    if(radiator)o.radiators=radiator[1];
    const loops=lower.match(/(\d{1,3})\s*(?:контур[а-яё]*|тп(?![а-яё])|тепл[а-яё]*\s*пол[а-яё]*)/)||
      lower.match(/(?:тп(?![а-яё])|контур[а-яё]*)\s*(\d{1,3})/);
    if(loops)o.loops=loops[1];
    if(/алюм|алюмин|алюмини/.test(lower))o.material="Алюминиевые";
    else if(/биметалл/.test(lower))o.material="Биметаллические";
    else if(/чугун/.test(lower))o.material="Чугунные";
    else if(/стальн/.test(lower))o.material="Стальные";
    const name=s.match(/(?:зовут|имя|клиент)\s*[:—-]?\s*([А-ЯЁ][а-яё]{2,})/)||s.match(/^\s*([А-ЯЁ][а-яё]{2,})(?:\s|,|$)/);
    if(name)o.name=name[1];
    const phone=s.match(/(?:\+7|8)\s*[\d\s\-()]{10,}/);
    if(phone)o.phone=cap(phone[0],30);
    const address=s.match(/(?:адрес|улица|ул\.?|село|с\.|город|г\.)\s*[:—-]?\s*([^,;\n]{3,75})/i);
    if(address)o.address=cap(address[0],120);
    const follow=dueFromText(s,base);
    if(follow){o.followUpDate=follow.date;o.dateApprox=follow.approx;o.followSource=follow.source}
    if(/без\s+т[её]плого\s+пола|т[её]плого\s+пола\s+нет/.test(lower))o.loops="0";
    if(/зарплат|получ[а-яё]*\s+деньг|денег\s+нет/.test(lower))o.reason="salary";
    else if(/дорог|цена\s+высок/.test(lower))o.reason="price";
    else if(/нет\s+врем|некогда/.test(lower))o.reason="time";
    else if(/посовет|мужем|женой/.test(lower))o.reason="family";
    if(/сам\s+(?:вам\s+)?(?:позвон|перезвон|набер)|(?:вам\s+)?наберу|обещал\s+(?:набрать|перезвонить)/.test(lower))o.clientWillCall=true;
    if(follow||o.clientWillCall||o.reason)o.status="waiting";
    return o;
  }
  let draft=blank(),activeFilter="all",openId=null,notice="",leadCache=[],initialized=false;
  let editing=false,cloudReady=false,loading=false,saving=false,loadError="",lastFetch=0,searchTerm="";
  let cachedUserId=null;
  const notified=new Set();
  const context=()=>window.__rdLeadContext?.()||{};
  const storeKey=()=>{const id=context().userId;return id?"rabota-preview-leads-v1:"+id:null};
  const notificationKey=()=>{const id=context().userId;return id?"rabota-lead-notifications:"+id:null};
  function localPreviews(){
    const key=storeKey();if(!key)return [];
    try{const value=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(value)?value.filter(x=>x&&typeof x==="object"):[]}catch{return []}
  }
  function resetForAccount(){
    const id=context().userId||null;
    if(id===cachedUserId)return;
    cachedUserId=id;leadCache=[];cloudReady=false;loading=false;saving=false;loadError="";
    lastFetch=0;searchTerm="";editing=false;openId=null;notice="";draft=blank();notified.clear();
  }
  const load=()=>leadCache;
  function fromRow(row){
    return {...blank(),id:row.id,name:row.name||"",phone:row.phone||"",address:row.address||"",
      radiators:row.radiators??"",material:row.material||"",loops:row.loops??"",notes:row.notes||"",
      status:row.status||"new",reason:row.reason||"none",followUpDate:row.follow_up_date||"",
      followUpTime:row.follow_up_time?String(row.follow_up_time).slice(0,5):"18:00",
      dateApprox:Boolean(row.date_approx),clientWillCall:Boolean(row.client_will_call),
      consent:Boolean(row.consent),priceAgreed:Boolean(row.price_agreed),updatedAt:row.updated_at||"",
      history:Array.isArray(row.history)?row.history:[]};
  }
  function toRow(lead){
    return {name:cap(lead.name,100),phone:cap(lead.phone,30),phone_normalized:phoneKey(lead.phone),
      address:cap(lead.address,240),radiators:lead.radiators===""?null:Number(lead.radiators),
      material:cap(lead.material,40),loops:lead.loops===""?null:Number(lead.loops),
      notes:cap(lead.notes,4000),status:lead.status,reason:lead.reason||"none",
      follow_up_date:lead.followUpDate||null,follow_up_time:lead.followUpTime||"18:00",
      date_approx:Boolean(lead.dateApprox),client_will_call:Boolean(lead.clientWillCall),
      consent:Boolean(lead.consent),price_agreed:Boolean(lead.priceAgreed),
      history:(lead.history||[]).slice(-30)};
  }
  const isOpen=lead=>!["ready","booked","lost"].includes(lead.status);
  const needsCall=(lead,day=today(),clock=nowClock())=>isOpen(lead)&&lead.consent===true&&!lead.clientWillCall&&!!lead.followUpDate&&
    (lead.followUpDate<day||(lead.followUpDate===day&&clock>=(lead.followUpTime||"18:00")));
  window.__rdLeadLogic={today,shifted,nextMonth,weekday,dueFromText,parseNotes,calc,phoneKey,needsCall};
  const countDue=()=>load().filter(l=>needsCall(l)).length;
  function syncNav(){
    resetForAccount();
    const count=countDue();
    document.querySelectorAll(".rd-nav-btn[data-page=leads]").forEach(b=>{
      const spans=b.querySelectorAll("span"),label=spans[spans.length-1];
      if(label)label.textContent="Лиды"+(count?" · "+count:"");
      b.setAttribute("aria-label",count?"Лиды, нужно связаться: "+count:"Лиды");
    });
  }
  async function refresh(force=false){
    resetForAccount();
    const account=cachedUserId;
    if(context().role==="master"||!account||loading||(!force&&cloudReady&&Date.now()-lastFetch<30000))return;
    loading=true;
    try{
      const rows=[];
      for(let offset=0;offset<100000;offset+=1000){
        const page=await dbRequest("rabota_leads?select=*&order=updated_at.desc&limit=1000&offset="+offset,"GET");
        if(!Array.isArray(page))throw new Error("Не удалось получить список лидов.");
        rows.push(...page);
        if(page.length<1000)break;
      }
      if(account!==context().userId)return;
      const firstCloudLoad=!cloudReady;
      leadCache=rows.map(fromRow);cloudReady=true;loadError="";lastFetch=Date.now();
      syncNav();if(!editing||firstCloudLoad)render();
      maybeNotify();
    }catch(error){if(account===context().userId){loadError=error.message||String(error);if(!editing)render()}}
    finally{loading=false}
  }
  function selectLead(id){
    const match=load().find(l=>l.id===id);
    draft=match?{...blank(),...match}:blank();
    openId=match?.id||null;editing=true;notice="";render();
  }
  function listView(){editing=false;openId=null;draft=blank();render();refresh(true)}
  async function save(){
    if(saving)return;
    const clean={...blank(),...draft};
    if(!text(clean.name)||!phoneKey(clean.phone)){notice="Укажите имя и правильный телефон (10–11 цифр).";render();return}
    if(["callback","waiting"].includes(clean.status)&&!clean.followUpDate){
      notice="Укажите дату повторного контакта, чтобы не потерять клиента.";render();return
    }
    if(clean.status==="callback"&&!clean.consent){
      notice="Перед перезвоном нужно согласие клиента. Отметьте галочку или выберите «Думает / ждём».";render();return;
    }
    if(clean.followUpDate&&!/^\d{4}-\d{2}-\d{2}$/.test(clean.followUpDate)){
      notice="Проверьте дату повторного контакта.";render();return
    }
    const dupe=load().find(l=>l.id!==clean.id&&phoneKey(l.phone)===phoneKey(clean.phone));
    if(dupe){notice="Телефон уже принадлежит лиду «"+dupe.name+"». Откройте его карточку.";render();return}
    clean.history=[...(draft.history||[]),{at:new Date().toISOString(),
      event:clean.id?"Карточка обновлена":"Лид создан",status:clean.status}].slice(-30);
    const original=clean.id?load().find(l=>l.id===clean.id):null;
    if(clean.id&&!original){notice="Этот лид не найден в общей базе. Обновите список.";render();return}
    if(!cloudReady){notice="Нет соединения с общей базой. Обновите список лидов.";render();return}
    saving=true;notice="Сохранение в общей базе…";render();
    try{
      const data=toRow(clean);
      const query=original?"rabota_leads?id=eq."+encodeURIComponent(original.id)+
        "&updated_at=eq."+encodeURIComponent(original.updatedAt):"rabota_leads";
      const rows=await dbRequest(query,original?"PATCH":"POST",data);
      if(!Array.isArray(rows)||rows.length!==1)throw new Error("Карточка изменилась на другом устройстве. Вернитесь к списку и обновите данные.");
      const record=fromRow(rows[0]);leadCache=[record,...leadCache.filter(l=>l.id!==record.id)];
      lastFetch=0;notice="Лид сохранён в общей базе.";editing=false;openId=null;draft=blank();
      render();syncNav();
    }catch(error){notice=error.code==="23505"?"Этот телефон уже есть в базе. Найдите существующего лида.":error.message||String(error);render();}
    finally{saving=false}
  }
  async function deleteLead(lead){
    if(!window.confirm("Удалить лид «"+lead.name+"» из общей базы без возможности восстановления?"))return;
    try{
      const rows=await dbRequest("rabota_leads?id=eq."+encodeURIComponent(lead.id),"DELETE");
      if(!Array.isArray(rows)||rows.length!==1)throw new Error("Лид не удалён.");
      leadCache=leadCache.filter(l=>l.id!==lead.id);notice="Лид удалён из общей базы.";
      editing=false;openId=null;render();syncNav();
    }catch(error){notice=error.message||String(error);render()}
  }
  async function contacted(lead){
    if(!window.confirm("Отметить повторный контакт? Напоминание будет снято."))return;
    try{
      const updated={...lead,followUpDate:"",dateApprox:false,status:"hot"};
      updated.history=[...(lead.history||[]),{at:new Date().toISOString(),event:"Связались повторно",status:"hot"}].slice(-30);
      const rows=await dbRequest("rabota_leads?id=eq."+encodeURIComponent(lead.id)+
        "&updated_at=eq."+encodeURIComponent(lead.updatedAt),"PATCH",toRow(updated));
      if(!Array.isArray(rows)||rows.length!==1)throw new Error("Карточка изменилась. Обновите данные.");
      const record=fromRow(rows[0]);leadCache=leadCache.map(l=>l.id===record.id?record:l);
      notice="Контакт отмечен. При необходимости назначьте следующую дату.";render();syncNav();
    }catch(error){notice=error.message||String(error);render()}
  }
  async function importLocal(){
    const source=localPreviews().filter(x=>phoneKey(x.phone));
    if(!source.length){notice="На устройстве нет подходящих старых лидов.";render();return}
    if(!window.confirm("Перенести до "+source.length+" старых лидов из этого браузера в общую базу? Уже существующие телефоны будут пропущены."))return;
    let added=0,skipped=0;
    for(const item of source){
      const key=phoneKey(item.phone);
      if(load().some(l=>phoneKey(l.phone)===key)){skipped++;continue}
      try{
        const prepared={...blank(),...item,id:null,followUpDate:item.followUpDate||"",
          status:item.status==="booked"?"booked":statuses[item.status]?item.status:"new"};
        if(["callback","waiting"].includes(prepared.status)&&!prepared.followUpDate)prepared.status="new";
        const rows=await dbRequest("rabota_leads","POST",toRow(prepared));
        if(Array.isArray(rows)&&rows.length===1){leadCache.push(fromRow(rows[0]));added++}else skipped++;
      }catch(error){skipped++;if(error.code!=="23505")loadError=error.message||String(error)}
    }
    notice="Из браузера перенесено: "+added+". Пропущено: "+skipped+
      ". Исходные записи оставлены на устройстве как резервная копия.";
    render();syncNav();
  }
  // Conversion is atomic in the database trigger on rabota_orders.
  // No separate client write to change the lead status.
  async function enableReminders(){
    if(!("Notification" in window)){notice="Системные уведомления недоступны в этом браузере. Внутренние напоминания работают.";render();return}
    try{
      const granted=await Notification.requestPermission();
      if(granted==="granted"){localStorage.setItem(notificationKey(),"1");notice="Напоминания работают при открытом приложении. Фоновые push пока не подключены.";maybeNotify()}
      else notice="Браузер не разрешил системные уведомления. Внутренние напоминания работают.";
    }catch(error){notice="Не удалось включить уведомления: "+(error.message||String(error))}
    render();
  }
  async function maybeNotify(){
    if(!cloudReady||!("Notification" in window)||Notification.permission!=="granted")return;
    const key=notificationKey();if(!key||localStorage.getItem(key)!=="1")return;
    for(const lead of load().filter(l=>needsCall(l))){
      const marker=lead.id+":"+(lead.followUpDate||"")+":"+(lead.followUpTime||"");
      if(notified.has(marker))continue;
      notified.add(marker);
      try{
        const title="Пора связаться с клиентом";
        const options={body:lead.name+" · "+humanDate(lead.followUpDate)+" "+lead.followUpTime,tag:"lead-"+lead.id};
        const registration=await navigator.serviceWorker?.getRegistration?.();
        if(registration&&registration.showNotification)await registration.showNotification(title,options);
        else new Notification(title,options);
      }catch(error){console.warn("Lead notification",error)}
    }
  }
  function setField(key,value){draft[key]=value}
  function field(label,key,type="text",placeholder="",opts={}){
    const wrap=node("label","la-field");
    wrap.append(node("span","",label));
    const input=type==="select"?node("select","la-input"):type==="textarea"?node("textarea","la-input"):node("input","la-input");
    if(type==="select"){
      for(const [value,title] of Object.entries(opts)){const option=node("option","",title);option.value=value;input.append(option)}
    }else if(type==="textarea"){input.rows=4;input.maxLength=4000;input.placeholder=placeholder}
    else{input.type=type;input.placeholder=placeholder;input.maxLength=type==="number"?undefined:240;if(type==="number"){input.min="0";input.step="1"}}
    input.value=draft[key]??"";
    input.addEventListener("input",()=>{setField(key,input.value);if(key==="followUpDate")draft.dateApprox=false;updatePreview()});
    input.addEventListener("change",()=>{setField(key,input.value);if(key==="followUpDate")draft.dateApprox=false;if(key==="status"){render();return}updatePreview()});
    wrap.append(input);return wrap;
  }
  function tick(label,key){
    const wrap=node("label","la-check"),input=node("input");input.type="checkbox";input.checked=!!draft[key];
    input.addEventListener("change",()=>{draft[key]=input.checked;updatePreview()});
    wrap.append(input,node("span","",label));return wrap;
  }
  function quickDay(n,label){
    return btn(label,"la-chip",()=>{draft.followUpDate=shifted(today(),n);draft.dateApprox=false;draft.status="callback";render()})
  }
  function updatePreview(){
    const container=$("laAdvisor");if(container)fillAdvisor(container);
    const preview=$("laPrice");if(preview){
      const amount=calc(draft.radiators,draft.loops);
      preview.textContent=draft.material==="Чугунные"?"Нужна консультация мастера":amount===null?"Укажите радиаторы или контуры":priceLabel(draft.radiators,draft.loops);
    }
  }
  function missing(){
    return [{key:"radiators",label:"число радиаторов"},{key:"material",label:"тип радиаторов"},{key:"loops",label:"контуры тёплого пола"},
      {key:"address",label:"населённый пункт / адрес"},{key:"name",label:"имя"},{key:"phone",label:"телефон"}]
      .filter(item=>text(draft[item.key])==="").map(x=>x.label);
  }
  function fillAdvisor(root){
    root.replaceChildren();
    root.append(node("strong","la-advisor-title","Что сказать клиенту"));
    const m=missing(),cost=calc(draft.radiators,draft.loops),chugun=draft.material==="Чугунные";
    let script="";
    if(chugun)script="У вас чугунные радиаторы. Для такой системы сначала нужно уточнить возможность подключения оборудования. Стоимость и результат пока не обещайте.";
    else if(draft.status==="waiting"||draft.status==="callback")
      script=draft.reason==="salary"?"Понимаю. Подскажите, примерно какого числа будет зарплата? Можно один раз напомнить вам после этой даты, если сами не позвоните?":
      "Хорошо. Когда вам будет удобно вернуться к вопросу? Можем согласовать один повторный звонок?";
    else if(draft.status==="ready")
      script="Давайте уточним точный адрес и телефон, затем предложим время по календарю. Запишем только после вашего подтверждения.";
    else if(draft.status==="lost")
      script="Спасибо за обращение. Если услуга снова понадобится, будем рады помочь.";
    else if(text(draft.radiators)==="")
      script="Подскажите, пожалуйста, сколько у вас радиаторов отопления?";
    else if(!text(draft.material))
      script="Из какого материала радиаторы: алюминиевые, биметаллические или чугунные?";
    else if(text(draft.loops)==="")
      script="Есть ли тёплый пол? Если да, сколько контуров?";
    else if(cost!==null)
      script="Стоимость промывки вашей системы — "+money(cost)+". Мы промываем каждый радиатор отдельно, а котёл и трубы входят в эту сумму. Подскажите, когда вам удобно принять мастера?";
    else script="Давайте уточним состав системы, чтобы правильно рассчитать стоимость.";
    root.append(node("p","",script));
    if(m.length)root.append(node("small","la-muted","Уточнить: "+m.slice(0,4).join(" · ")));
    if(draft.followUpDate)root.append(node("small","la-muted","Контроль: "+humanDate(draft.followUpDate)+" после "+(draft.followUpTime||"18:00")+(draft.dateApprox?" (ориентир — спросить точную дату)":"")));
    if(draft.followUpDate&&!draft.consent)root.append(node("small","la-warn","Разрешение на повторный звонок не отмечено. Контроль внутренний — не звонить без согласия."));
  }
  function parse(){
    const original=text(draft.notes);
    if(!original){notice="Сначала впишите заметки со слов клиента.";render();return}
    const derived=parseNotes(original);
    for(const [key,value] of Object.entries(derived)){
      if(["followSource"].includes(key))continue;
      if(key==="followUpDate"){if(!draft.followUpDate)draft.followUpDate=value;continue}
      if(key==="dateApprox"){if(derived.followUpDate&&draft.followUpDate===derived.followUpDate)draft.dateApprox=value;continue}
      if(key==="clientWillCall"){if(value)draft.clientWillCall=true;continue}
      if(key==="status"&&draft.status==="new"){draft.status=value;continue}
      if(!text(draft[key])||draft[key]==="none")draft[key]=value;
    }
    notice="Информация разобрана по правилам. Проверьте данные и дату перед сохранением.";render();
  }
  function previewSlots(){
    const wrap=node("section","la-box la-slots"),head=node("strong","","Возможные окна мастера");
    wrap.append(head,node("p","la-muted","Сверка с текущими заказами, интервал между записями ≥ 3 ч 20 мин. Перед записью расписание проверяется ещё раз."));
    const orders=Array.isArray(context().orders)?context().orders:[];
    const master="Рауль",out=node("div","la-slot-list");
    for(let day=0;day<3;day++){
      const date=shifted(today(),day);
      if(orders.filter(o=>o.date===date&&o.status!=="Отменён"&&text(o.master).toLocaleLowerCase("ru")===master.toLocaleLowerCase("ru")).length>=2)continue;
      for(const time of ["10:00","15:00","18:00"]){
        const nowTime=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Moscow",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
        if(date===today()&&time<=nowTime)continue;
        const candidate=Number(time.slice(0,2))*60+Number(time.slice(3));
        const busy=orders.some(o=>o.date===date&&o.status!=="Отменён"&&(!text(o.master)||text(o.master).toLocaleLowerCase("ru")===master.toLocaleLowerCase("ru"))&&
          Math.abs(candidate-(Number(String(o.time||"00:00").slice(0,2))*60+Number(String(o.time||"00:00").slice(3,5))))<200);
        if(!busy)out.append(btn((day===0?"Сегодня":day===1?"Завтра":"Послезавтра")+" · "+time,"la-slot",()=>{
          notice="Возможный вариант: "+humanDate(date)+" в "+time+". Спросите согласие клиента. Окончательная проверка — в форме заказа.";
          draft.notes=cap(draft.notes+"\nЖелаемый визит: "+date+" "+time+"; мастер: "+master,4000);render();
        }));
      }
    }
    if(!out.children.length)out.append(node("small","la-muted","В ближайшие три дня подходящих вариантов не найдено. Откройте календарь."));
    wrap.append(out);return wrap;
  }
  function editor(){
    const wrap=node("section","la-box la-editor");
    const back=btn("← К списку","la-neutral",listView);
    const header=group("la-title",node("h2","",openId?"Карточка клиента":"Новый лид"),back);
    wrap.append(header);
    if(notice){const message=node("p","la-message",notice);message.setAttribute("role","status");wrap.append(message)}
    const contact=node("div","la-field-grid");
    contact.append(field("Имя клиента *","name","text","Имя клиента"),
      field("Номер телефона *","phone","tel","+7..."));
    wrap.append(contact,field("Заметка о разговоре","notes","textarea",
      "Например: Андрей, 5 батарей, позвонить после зарплаты"));
    const parseRow=group("la-quiet-actions",btn("Разобрать заметку","la-neutral",parse));
    wrap.append(parseRow);
    wrap.append(node("h3","la-subhead","Что дальше?"));
    wrap.append(field("Статус клиента","status","select","",statuses));
    if(["waiting","callback"].includes(draft.status)||draft.followUpDate){
      const callRow=node("div","la-field-grid");
      callRow.append(field("Дата перезвона","followUpDate","date"),
        field("После какого времени (МСК)","followUpTime","time"));
      wrap.append(callRow);
      const shortcuts=node("div","la-shortcuts");
      shortcuts.append(quickDay(1,"Завтра"),quickDay(7,"Через 7 дней"),
        quickDay(20,"Через 20 дней"),
        btn("Следующий месяц","la-chip",()=>{draft.followUpDate=nextMonth(today());draft.dateApprox=true;draft.status="waiting";render()}));
      wrap.append(shortcuts);
      wrap.append(tick("Клиент разрешил повторный звонок","consent"));
      if(draft.dateApprox&&draft.followUpDate)wrap.append(node("p","la-warn","Дата приблизительная — её нужно уточнить."));
    }else if(!["ready","booked","lost"].includes(draft.status)){
      wrap.append(btn("Назначить перезвон","la-neutral",()=>{draft.status="callback";render()}));
    }
    const extras=node("details","la-extra");
    const extraHeading=node("summary","","Отопление, расчёт и другие подробности");
    extras.append(extraHeading);
    const extraBody=node("div","la-extra-body");
    const grid=node("div","la-field-grid");
    grid.append(field("Адрес / населённый пункт","address","text","Гизель, улица..."),
      field("Радиаторов","radiators","number","5"),
      field("Материал","material","select","",{"":"Неизвестно","Алюминиевые":"Алюминиевые",
        "Биметаллические":"Биметаллические","Чугунные":"Чугунные","Стальные":"Стальные","Другие":"Другие"}),
      field("Контуров тёплого пола","loops","number","1"),
      field("Причина переноса","reason","select","",reasons));
    extraBody.append(grid);
    const amount=group("la-price",
      node("span","","Предварительная стоимость · минимум 10 000 ₽"),
      node("strong","",draft.material==="Чугунные"?"Нужна консультация мастера":
        calc(draft.radiators,draft.loops)===null?"Укажите радиаторы или контуры":priceLabel(draft.radiators,draft.loops)),
      node("small","","Предварительный расчёт: минимум 10 000 ₽, радиатор — 2 000 ₽, контур — 1 000 ₽. При неизвестном количестве показана нижняя оценка. Окончательную цену согласуйте с клиентом."));
    amount.querySelector("strong").id="laPrice";
    extraBody.append(amount,tick("Клиент сам обещал позвонить","clientWillCall"),
      tick("Стоимость согласована","priceAgreed"));
    const adviser=node("details","la-extra");
    adviser.append(node("summary","","Подсказка для разговора"));
    const advice=node("div","la-advisor");advice.id="laAdvisor";fillAdvisor(advice);adviser.append(advice);
    extraBody.append(adviser);
    if(openId&&draft.status==="ready"){
      extraBody.append(previewSlots());
    }
    extras.append(extraBody);wrap.append(extras);
    const action=btn(saving?"Сохраняем…":openId?"Сохранить изменения":"Сохранить лид",
      "la-primary la-wide",save);action.disabled=saving||!cloudReady;wrap.append(action);
    if(!cloudReady)wrap.append(node("p","la-warn",loadError?"Нет связи с базой. Проверьте интернет и обновите раздел.":"Загрузка общей базы лидов…"));
    if(openId&&draft.status==="ready"){
      wrap.append(btn("Перевести в заказ","la-neutral la-wide",()=>{
        if(!draft.name||!phoneKey(draft.phone)){notice="Сначала укажите имя и номер телефона.";render();return}
        window.__rdLeadOpenOrder?.({...draft,price:calc(draft.radiators,draft.loops)});
      }));
      wrap.append(node("p","la-muted","Откроется форма заказа. Запись создаётся только после сохранения подтверждённого заказа."));
    }
    if(openId)wrap.append(btn("Удалить лид","la-text-danger",()=>deleteLead(draft)));
    return wrap;
  }
  const link=(label,cls,href)=>{const a=node("a",cls,label);a.href=href;return a};
  function leadCard(lead){
    const overdue=needsCall(lead),card=node("article","la-lead"+(overdue?" la-overdue":""));
    const header=group("la-lead-head",node("strong","",lead.name||"Без имени"),
      node("span","la-status"+(overdue?" la-status-due":""),overdue?"Перезвонить":statuses[lead.status]||"Лид"));
    card.append(header);
    const brief=[];
    if(lead.radiators!==""&&lead.radiators!=null)brief.push(lead.radiators+" радиаторов");
    if(lead.loops!==""&&lead.loops!=null&&Number(lead.loops)>0)brief.push(lead.loops+" контур(ов)");
    const price=calc(lead.radiators,lead.loops);
    if(price!==null&&lead.material!=="Чугунные")brief.push(priceLabel(lead.radiators,lead.loops));
    if(brief.length)card.append(node("p","la-lead-meta",brief.join(" · ")));
    if(lead.followUpDate)card.append(node("p","la-follow"+(overdue?" la-alert":""),
      (overdue?"Связаться: ":"Контроль: ")+humanDate(lead.followUpDate)+", "+(lead.followUpTime||"18:00")));
    if(lead.reason&&lead.reason!=="none")card.append(node("p","la-reason",reasons[lead.reason]||lead.reason));
    const actions=node("div","la-actions");
    const phone=phoneKey(lead.phone);
    if(phone){
      actions.append(link("Позвонить","la-link-call","tel:+"+phone));
      const wa=link("WhatsApp","la-link-wa","https://wa.me/"+phone);wa.target="_blank";wa.rel="noopener noreferrer";actions.append(wa);
    }
    actions.append(btn("Открыть","la-neutral",()=>selectLead(lead.id)));
    if(overdue)actions.append(btn("Связались","la-chip",()=>contacted(lead)));
    if(lead.status==="ready")actions.append(btn("В заказ","la-chip",()=>{
      window.__rdLeadOpenOrder?.({...lead,price:calc(lead.radiators,lead.loops)});
    }));
    card.append(actions);return card;
  }
  function filterVisible(){
    const container=$("laLeadList");if(!container)return;
    const query=searchTerm.toLocaleLowerCase("ru").trim();
    let visible=0;
    for(const card of container.querySelectorAll("[data-lead-search]")){
      card.hidden=!!query&&!card.dataset.leadSearch.includes(query);
      if(!card.hidden)visible++;
    }
    const count=$("laListCount");if(count)count.textContent=query?"Найдено: "+visible:"";
  }
  function leadsList(){
    const wrap=node("section","la-box la-list");
    const heading=group("la-title la-compact-heading",
      btn("+ Новый лид","la-primary",()=>selectLead(null)));
    wrap.append(heading);
    if(notice){const message=node("p","la-message",notice);message.setAttribute("role","status");wrap.append(message)}
    if(loadError)wrap.append(node("p","la-warn","Нет связи с общей базой: "+loadError));
    if(!cloudReady)wrap.append(node("p","la-muted","Загружаем лиды из общей CRM…"));
    const all=load(),due=all.filter(l=>needsCall(l));
    const summary=node("div","la-summary");
    for(const [num,label] of [[due.length,"Перезвонить"],
      [all.filter(l=>["waiting","callback"].includes(l.status)).length,"Ожидают"],
      [all.filter(l=>l.status==="ready").length,"Согласились"]])
      summary.append(group("la-summary-item",node("strong","",num),node("span","",label)));
    wrap.append(summary);
    // Global search above filters is the only lead search.
    const tabs=node("div","la-filters");
    for(const [key,label] of [["all","Все"],["due","Перезвонить"],["waiting","Ожидают"],["ready","Согласились"]]){
      const b=btn(label,"la-chip"+(activeFilter===key?" is-active":""),()=>{activeFilter=key;render()});
      b.setAttribute("aria-pressed",String(activeFilter===key));tabs.append(b);
    }
    wrap.append(tabs);
    let items=all.filter(l=>activeFilter==="due"?needsCall(l):
      activeFilter==="waiting"?["waiting","callback"].includes(l.status):
      activeFilter==="ready"?l.status==="ready":true);
    items.sort((a,b)=>Number(needsCall(b))-Number(needsCall(a))||
      (a.followUpDate||"9999").localeCompare(b.followUpDate||"9999")||
      String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
    const list=node("div","la-lead-list");list.id="laLeadList";
    if(!items.length&&cloudReady)list.append(node("div","la-empty",activeFilter==="all"?
      "Пока нет лидов. Нажмите «+ Новый лид», чтобы сохранить клиента, который ещё не записался.":"В этой категории пока нет клиентов."));
    for(const lead of items.slice(0,100)){
      const card=leadCard(lead);card.dataset.leadSearch=(lead.name+" "+lead.phone+" "+lead.address).toLocaleLowerCase("ru");
      list.append(card);
    }
    if(items.length>100)wrap.append(node("p","la-muted","Показаны первые 100 из "+items.length+" лидов."));
    wrap.append(list);
    const count=node("small","la-muted");count.id="laListCount";wrap.append(count);
    const old=localPreviews().filter(x=>phoneKey(x.phone)&&!all.some(y=>phoneKey(x.phone)===phoneKey(y.phone)));
    if(old.length)wrap.append(btn("Перенести старые лиды с этого устройства ("+old.length+")","la-neutral la-import",importLocal));
    wrap.append(btn("Включить напоминания на устройстве","la-notify",enableReminders));
    return wrap;
  }
  function render(){
    const root=$("rdLeadsMount");if(!root||context().role==="master")return;
    root.replaceChildren();
    root.append(editing?editor():leadsList());
    if(!editing)filterVisible();
    syncNav();initialized=true;
  }
  window.__rdLeadsRender=()=>{resetForAccount();render();refresh()};
  window.__rdLeadsSearch=value=>{searchTerm=String(value||"");filterVisible()};
  window.__rdLeadsSyncNav=syncNav;
  window.__rdLeadDueCount=countDue;
  window.setInterval?.(()=>{
    if(!$("appScreen")?.hidden&&context().role!=="master"){
      syncNav();maybeNotify();
      if(!$("rdLeads")?.hidden&&!editing)refresh();
    }
  },60000);
  window.addEventListener("focus",()=>{
    if(initialized&&!editing&&context().role!=="master")refresh(true)
  });

})();
