/* Работа · продажи по телефону. Изолированный Preview-прототип:
   лиды хранятся только в localStorage текущего аккаунта и origin, Supabase не меняется. */
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
  const calc=(r,c)=>{const a=number(r),b=number(c);return Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a+b>0?a*2000+b*1000:null};
  const statuses={new:"Новый",hot:"Горячий",waiting:"Думает / ждём",callback:"Перезвонить",ready:"Согласился",lost:"Отказался"};
  const reasons={none:"Не выбрано",salary:"После зарплаты",price:"Дорого",time:"Нет времени",family:"Посоветуется",other:"Другая причина"};
  const blank=()=>({id:null,name:"",phone:"",address:"",radiators:"",material:"",loops:"",notes:"",status:"new",reason:"none",followUpDate:"",followUpTime:"18:00",dateApprox:false,clientWillCall:false,consent:false,priceAgreed:false,updatedAt:"",history:[]});
  const phoneKey=s=>{let digits=String(s||"").replace(/\D/g,"");if(digits.length===11&&digits[0]==="8")digits="7"+digits.slice(1);if(digits.length===10)digits="7"+digits;return digits.length===11?digits:""};
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
  const context=()=>window.__rdLeadContext?.()||{};
  const storeKey=()=>{const id=context().userId;if(!id)return null;return "rabota-preview-leads-v1:"+id};
  function load(){
    const key=storeKey();if(!key)return [];
    try{const data=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(data)?data.filter(x=>x&&typeof x==="object"&&typeof x.id==="string").slice(0,500):[]}
    catch(e){notice="Не удалось прочитать сохранённые лиды в браузере.";return []}
  }
  function persist(items){
    const key=storeKey();
    if(!key){notice="Сессия пользователя ещё не готова.";return false}
    try{localStorage.setItem(key,JSON.stringify(items));leadCache=items;return true}
    catch(e){notice="Браузер не сохранил лиды. Проверьте доступную память.";return false}
  }
  const isOpen=lead=>!["ready","lost"].includes(lead.status);
  const needsCall=(lead,day=today(),clock=nowClock())=>isOpen(lead)&&!!lead.followUpDate&&
    (lead.followUpDate<day||(lead.followUpDate===day&&clock>=(lead.followUpTime||"18:00")));
  window.__rdLeadLogic={today,shifted,nextMonth,weekday,dueFromText,parseNotes,calc,phoneKey,needsCall};
  const countDue=()=>load().filter(l=>needsCall(l)).length;
  function syncNav(){const count=countDue();
    document.querySelectorAll(".rd-nav-btn[data-page=leads]").forEach(b=>{
      const spans=b.querySelectorAll("span");
      const label=spans[spans.length-1];
      if(label)label.textContent="Лиды"+(count?" · "+count:"");
      b.setAttribute("aria-label",count?"Лиды, просрочено "+count:"Лиды");
    });
  }
  function selectLead(id){const match=load().find(l=>l.id===id);draft=match?{...blank(),...match}:blank();openId=id||null;notice="";render()}
  function save(){
    const clean={...blank(),...draft};
    if(!text(clean.name)||!phoneKey(clean.phone)){
      notice="Для сохранения укажите имя и номер телефона (10–11 цифр).";render();return
    }
    if(["callback","waiting"].includes(clean.status)&&!clean.followUpDate){
      notice="Укажите дату контроля, чтобы клиент не потерялся. Если клиент ещё не назвал дату — уточните её.";render();return
    }
    if(clean.followUpDate&&!/^\d{4}-\d{2}-\d{2}$/.test(clean.followUpDate)){
      notice="Проверьте дату напоминания.";render();return
    }
    clean.notes=cap(clean.notes,4000);clean.address=cap(clean.address,240);
    clean.name=cap(clean.name,100);clean.phone=cap(clean.phone,30);
    clean.updatedAt=new Date().toISOString();
    const items=load();
    const dupe=items.find(l=>l.id!==clean.id&&phoneKey(l.phone)===phoneKey(clean.phone));
    if(dupe){notice="Этот телефон уже есть у клиента «"+dupe.name+"». Откройте существующий лид, чтобы не создавать дубликат.";render();return}
    if(!clean.id)clean.id="lead-"+new Date().getTime()+"-"+Math.random().toString(36).slice(2,9);
    const prev=items.find(l=>l.id===clean.id);
    clean.history=[...(prev?.history||[]),{at:clean.updatedAt,event:prev?"Карточка обновлена":"Лид создан",status:clean.status}].slice(-30);
    const next=[clean,...items.filter(l=>l.id!==clean.id)];
    if(!persist(next)){render();return}
    draft={...clean};openId=clean.id;notice="Лид сохранён в браузере этого устройства. В общую CRM он пока не передан.";render();
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
    input.addEventListener("input",()=>{setField(key,input.value);updatePreview()});
    input.addEventListener("change",()=>{setField(key,input.value);updatePreview()});
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
      preview.textContent=amount===null?"Заполните количество":money(amount);
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
      for(const time of ["10:00","13:30","17:00"]){
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
    wrap.append(group("la-title",node("h2","",openId?"Карточка клиента":"Новый звонок"),btn("Очистить","la-neutral",()=>selectLead(null))));
    wrap.append(node("p","la-muted","Пишите как слышите. Опечатки допустимы: «Андрей 5 батарей алюм 1 тп после зп через 20 дней»."));
    const notes=field("Быстрые заметки","notes","textarea","Имя, батареи, контуры, сомнения, когда перезвонить...");
    wrap.append(notes,btn("Разобрать заметки","la-primary la-wide",parse));
    wrap.append(node("h3","la-subhead","Контакты и отопление"));
    const grid=node("div","la-field-grid");
    grid.append(field("Имя *","name","text","Например, Андрей"),field("Телефон *","phone","tel","+7..."),
      field("Адрес / населённый пункт","address","text","Гизель, улица..."),
      field("Радиаторов","radiators","number","5"),
      field("Материал","material","select","",{ "":"Неизвестно", "Алюминиевые":"Алюминиевые", "Биметаллические":"Биметаллические", "Чугунные":"Чугунные", "Стальные":"Стальные", "Другие":"Другие"}),
      field("Контуров пола","loops","number","1"));
    wrap.append(grid);
    const amount=group("la-price",node("span","","Расчёт по прайсу · радиатор 2 000 ₽ / контур 1 000 ₽"),
      node("strong","",calc(draft.radiators,draft.loops)===null?"Заполните количество":money(calc(draft.radiators,draft.loops))),
      node("small","","Промывка котла и труб включена. Для нестандартной системы — уточнение."));
    amount.querySelector("strong").id="laPrice";wrap.append(amount);
    wrap.append(node("h3","la-subhead","Статус и повторный контакт"));
    const statusRow=node("div","la-field-grid");
    statusRow.append(field("Статус","status","select","",statuses),field("Причина переноса","reason","select","",reasons));
    wrap.append(statusRow);
    const callbackRow=node("div","la-date-grid");
    callbackRow.append(field("Дата контроля","followUpDate","date"),field("Проверить после (МСК)","followUpTime","time"));
    const shortcuts=node("div","la-shortcuts");
    shortcuts.append(quickDay(1,"Завтра"),quickDay(7,"Через 7 дней"),quickDay(20,"Через 20 дней"),
      btn("Следующий месяц","la-chip",()=>{draft.followUpDate=nextMonth(today());draft.dateApprox=true;draft.status="waiting";render()}));
    callbackRow.append(shortcuts);wrap.append(callbackRow);
    if(draft.dateApprox&&draft.followUpDate)wrap.append(node("p","la-warn","Дата приблизительная. Уточните у клиента день зарплаты или удобного звонка."));
    wrap.append(tick("Клиент обещал позвонить сам","clientWillCall"),tick("Клиент разрешил один повторный звонок","consent"),
      tick("Цена согласована с клиентом","priceAgreed"));
    const helper=node("div","la-advisor");helper.id="laAdvisor";fillAdvisor(helper);wrap.append(helper);
    if(notice){const n=node("p","la-message",notice);n.setAttribute("role","status");wrap.append(n)}
    wrap.append(btn(openId?"Сохранить изменения":"Сохранить потенциального клиента","la-primary la-wide",save));
    if(openId&&draft.status==="ready"){
      wrap.append(btn("Передать данные в новый заказ","la-neutral la-wide",()=>{
        if(!draft.name||!phoneKey(draft.phone)){notice="Нужны имя и телефон.";render();return}
        window.__rdLeadOpenOrder?.({...draft,price:calc(draft.radiators,draft.loops)});
      }));
      wrap.append(node("p","la-muted","Согласие на услугу не создаёт заказ автоматически. В тестовой версии сохранение заказа из лида отключено."));
    }
    wrap.append(previewSlots());return wrap;
  }
  function leadCard(lead){
    const overdue=needsCall(lead),card=node("article","la-lead"+(overdue?" la-overdue":""));
    const heading=group("la-lead-head",node("strong","",lead.name||"Без имени"),
      node("span","la-status",statuses[lead.status]||"Лид"));
    card.append(heading);
    card.append(node("p","la-lead-meta",(lead.phone||"Без телефона")+(lead.address?" · "+lead.address:"")));
    const amount=calc(lead.radiators,lead.loops);
    if(amount!==null)card.append(node("p","la-lead-meta","Предварительно: "+money(amount)));
    if(lead.reason&&lead.reason!=="none")card.append(node("p","la-lead-meta","Причина: "+(reasons[lead.reason]||lead.reason)));
    if(lead.followUpDate)card.append(node("p","la-follow"+(overdue?" la-alert":""),(overdue?"Пора связаться · ":"Контроль · ")+humanDate(lead.followUpDate)+" после "+(lead.followUpTime||"18:00")+(lead.dateApprox?" (ориентир)":"")));
    if(overdue&&!lead.consent)card.append(node("p","la-warn","Нет разрешения на повторный звонок — сначала проверьте согласие."));
    const actions=node("div","la-actions");
    actions.append(btn("Открыть","la-neutral",()=>selectLead(lead.id)));
    actions.append(btn("Удалить","la-neutral",()=>{
      if(!window.confirm("Удалить местную карточку «"+lead.name+"» без возможности восстановления?"))return;
      if(persist(load().filter(x=>x.id!==lead.id))){
        if(openId===lead.id){draft=blank();openId=null}
        notice="Карточка удалена с этого устройства.";render();
      }
    }));
    if(overdue)actions.append(btn("Связались","la-chip",()=>{
      if(!window.confirm("Отметить контакт с клиентом? Напоминание на эту дату будет снято."))return;
      const items=load(),entry=items.find(x=>x.id===lead.id);
      if(!entry)return;entry.followUpDate="";entry.dateApprox=false;entry.status="hot";
      entry.updatedAt=new Date().toISOString();
      entry.history=[...(entry.history||[]),{at:entry.updatedAt,event:"Связались повторно",status:"hot"}].slice(-30);
      if(persist(items)){if(openId===entry.id)draft={...entry};notice="Повторный контакт отмечен. При необходимости назначьте новую дату.";render()}
    }));
    card.append(actions);return card;
  }
  function leadsList(){
    const wrap=node("section","la-box la-list");
    wrap.append(group("la-title",node("h2","","Лиды и задачи"),btn("+ Новый звонок","la-neutral",()=>selectLead(null))));
    const all=load(),due=all.filter(l=>needsCall(l));
    const summary=node("div","la-summary");
    for(const [num,label] of [[all.length,"Всего лидов"],[due.length,"На контроле"],[all.filter(l=>l.status==="ready").length,"Согласились"]])
      summary.append(group("la-summary-item",node("strong","",num),node("span","",label)));
    wrap.append(summary);
    const tabs=node("div","la-filters");
    for(const [key,label] of [["all","Все"],["due","Контроль"],["waiting","Ожидают"],["ready","Согласились"]]){
      const b=btn(label,"la-chip"+(activeFilter===key?" is-active":""),()=>{activeFilter=key;render()});
      b.setAttribute("aria-pressed",String(activeFilter===key));tabs.append(b);
    }
    wrap.append(tabs);
    let items=all.filter(l=>activeFilter==="due"?needsCall(l):activeFilter==="waiting"?["waiting","callback"].includes(l.status):activeFilter==="ready"?l.status==="ready":true);
    items.sort((a,b)=>Number(needsCall(b))-Number(needsCall(a))||(a.followUpDate||"9999").localeCompare(b.followUpDate||"9999")||String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
    if(!items.length)wrap.append(node("div","la-empty",activeFilter==="all"?"Лидов пока нет. Начните с нового звонка.":"В этой категории клиентов нет."));
    for(const lead of items.slice(0,100))wrap.append(leadCard(lead));
    if(items.length>100)wrap.append(node("p","la-muted","Показаны первые 100 записей."));
    return wrap;
  }
  function render(){
    const root=$("rdLeadsMount");
    if(!root||context().role==="master")return;
    root.replaceChildren();
    const warning=node("div","la-preview-note","Тестовый режим: лиды сохраняются только в браузере этого устройства и аккаунта. Между менеджерами не синхронизируются. Push-уведомлений и отправки сообщений клиентам пока нет.");
    const layout=node("div","la-layout");layout.append(editor(),leadsList());
    root.append(warning,layout);
    syncNav();initialized=true;
  }
  window.__rdLeadsRender=render;
  window.__rdLeadsSyncNav=syncNav;
  window.__rdLeadDueCount=countDue;
  // Recheck date-based reminders while the CRM stays open.
  window.setInterval?.(()=>{if(!$("appScreen")?.hidden){syncNav();if(!$("rdLeads")?.hidden)render()}},60000);
  window.addEventListener("focus",()=>{if(initialized){syncNav();if(!$("rdLeads")?.hidden)render()}});
  window.addEventListener("storage",e=>{if(e.key===storeKey()&&initialized){syncNav();if(!$("rdLeads")?.hidden)render()}});
})();
