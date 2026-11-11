/* CRM "Работа": manually initiated WhatsApp drafts for the assigned master Raul.
 * Never transmits data until the owner/manager explicitly opens WhatsApp.
 * No database or WhatsApp API writes. Raul's number is local to this device.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==="object" && module.exports)module.exports=api;
  if(root && root.document)root.__rdWhatsApp=api;
})(typeof window!=="undefined"?window:globalThis,function(root){
  "use strict";
  const PHONE_KEY="rd-raul-whatsapp-phone-v1";
  const MOSCOW="Europe/Moscow";
  function clean(value){return String(value??"").trim().replace(/\s+/g," ");}
  function normalizePhone(value){
    let digits=String(value??"").replace(/\D/g,"");
    if(digits.length===10)digits="7"+digits;
    if(digits.length===11 && digits.startsWith("8"))digits="7"+digits.slice(1);
    return /^7\d{10}$/.test(digits)?digits:null;
  }
  function isRaul(order){
    return clean(order?.master).toLocaleLowerCase("ru")==="рауль";
  }
  function dateInMoscow(date){
    const parts=new Intl.DateTimeFormat("en-US",{
      timeZone:MOSCOW,year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(date);
    const get=type=>parts.find(x=>x.type===type)?.value;
    return get("year")+"-"+get("month")+"-"+get("day");
  }
  function tomorrowMoscow(now=new Date()){
    return dateInMoscow(new Date(now.getTime()+86400000));
  }
  function displayDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(clean(value)))return "не указана";
    const [year,month,day]=String(value).split("-");
    return day+"."+month+"."+year;
  }
  function displayTime(time){
    const s=clean(time);
    return /^\d{2}:\d{2}/.test(s)?s.slice(0,5):"не указано";
  }
  function displayPrice(value){
    if(value===null||value===undefined||value==="")return "не указана";
    const n=Number(value);
    return Number.isFinite(n)?n.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g," ")+" ₽":"не указана";
  }
  const INACTIVE=new Set(["Отменён","Выполнен"]);
  // Only explicitly classified master instructions go to WhatsApp.
  // Old unclassified comments are never silently leaked or discarded.
  function notesForMaster(value){
    return root.__rdOrderNotes?.parse(value).master.trim()||"";
  }
  function hasLegacyNote(order){
    return Boolean(root.__rdOrderNotes?.isLegacy(order?.details));
  }
  function notesModuleReady(){
    if(root.__rdOrderNotes)return true;
    root.alert?.("Модуль комментариев не загрузился. Обновите CRM и попробуйте снова.");
    return false;
  }
  function workDescription(order){
    const parts=[];
    const r=Number(order.radiators),f=Number(order.floorLoops);
    if(order.radiators!==""&&order.radiators!=null&&Number.isFinite(r)&&r>0)
      parts.push(r+" радиаторов");
    if(order.floorLoops!==""&&order.floorLoops!=null&&Number.isFinite(f)&&f>0)
      parts.push(f+" контуров тёплого пола");
    return parts.length?"Промывка "+parts.join(" + "):"Промывка отопления (объём уточнить)";
  }
  function appointmentHeading(order){
    return "Дата и время: "+displayDate(order.date)+" · "+displayTime(order.time)+(order.time?" МСК":"");
  }
  function conciseDetails(order){
    const lines=[
      "Клиент: "+(clean(order.name)||"не указан"),
      ...(clean(order.phone)?["Телефон: "+clean(order.phone)]:[]),
      ...(clean(order.address)?["Адрес: "+clean(order.address)]:[]),
      "Работа: "+workDescription(order),
      ...(order.price!=null&&order.price!==""?["Стоимость: "+displayPrice(order.price)]:[])
    ];
    const useful=notesForMaster(order.details);
    if(useful)lines.push("Примечание: "+useful);
    return lines.join("\n");
  }
  function isActive(order){return !INACTIVE.has(clean(order.status));}
  function timeMinutes(time){
    const m=/^(\d{2}):(\d{2})/.exec(clean(time));
    if(!m)return null;
    const h=Number(m[1]),minutes=Number(m[2]);
    return h<24&&minutes<60?h*60+minutes:null;
  }
  // Only confirmed assignment gaps and exact-time collisions require agreement.
  // Nearby appointments are shown to the owner, but a 3h20m guideline must not
  // mislabel an already assigned job as "awaiting agreement".
  function reviewOrder(order,allOrders=[]){
    if(!isRaul(order))return {warnings:["Этот заказ не указан за Раулем."],requiresAgreement:true};
    if(!isActive(order))return {warnings:[],requiresAgreement:false};
    const warnings=[];
    let requiresAgreement=false;
    if(!clean(order.assignedUserId)){
      warnings.push("Исполнитель указан как Рауль, но привязка мастера в базе не подтверждена.");
      requiresAgreement=true;
    }
    if(!clean(order.date)||timeMinutes(order.time)===null){
      warnings.push("Дата или время заявки не указаны. Проверь расписание.");
      requiresAgreement=true;
    }
    const sameDate=(Array.isArray(allOrders)?allOrders:[]).filter(other=>
      isRaul(other)&&isActive(other)&&clean(other.date)===clean(order.date)&&
      String(other.id)!==String(order.id)
    );
    const time=timeMinutes(order.time);
    if(time!==null){
      const matching=sameDate.filter(other=>timeMinutes(other.time)===time);
      if(matching.length){
        warnings.push("У Рауля уже есть другая заявка ровно на "+displayTime(order.time)+".");
        requiresAgreement=true;
      }
      const nearby=sameDate.filter(other=>{
        const otherTime=timeMinutes(other.time);
        return otherTime!==null&&otherTime!==time&&Math.abs(otherTime-time)<200;
      });
      if(nearby.length){
        warnings.push("Рядом по времени записи Рауля: "+
          nearby.map(o=>displayTime(o.time)).join(", ")+
          ". Средняя работа около 3 часов и дорога, проверь, что он успевает.");
      }
    }
    return {warnings,requiresAgreement};
  }
  function reviewWarnings(order,allOrders=[]){return reviewOrder(order,allOrders).warnings;}
  // A short, deduplicated risk report for the iPhone confirmation sheet.
  // Scheduling gaps are estimates, not a guarantee of completion time.
  function compactReview(selected,allOrders=[]){
    const items=Array.isArray(selected)?selected:[];
    const all=Array.isArray(allOrders)?allOrders:[];
    const reviews=items.map(order=>({order,...reviewOrder(order,all)}));
    const notes=[];
    const list=orders=>{
      const labels=orders.slice(0,3).map(o=>(clean(o.name)||"Клиент")+" "+displayTime(o.time));
      return labels.join(", ")+(orders.length>3?" и ещё "+(orders.length-3):"");
    };
    const unassigned=items.filter(o=>isActive(o)&&!clean(o.assignedUserId));
    if(unassigned.length)notes.push("Нет привязки мастера в базе: "+list(unassigned)+".");
    const noTime=items.filter(o=>isActive(o)&&(!clean(o.date)||timeMinutes(o.time)===null));
    if(noTime.length)notes.push("Дата/время не указаны: "+list(noTime)+".");
    const included=new Set(items.map(o=>String(o.id)));
    const relevant=[...new Map([...items,...all].filter(o=>isRaul(o)&&isActive(o))
      .map(o=>[String(o.id),o])).values()];
    const sameDay=relevant.filter(o=>items.some(chosen=>clean(chosen.date)===clean(o.date)));
    const pairs=[];
    for(let i=0;i<sameDay.length;i++)for(let j=i+1;j<sameDay.length;j++){
      const a=sameDay[i],b=sameDay[j];
      if(clean(a.date)!==clean(b.date)||!included.has(String(a.id))&&!included.has(String(b.id)))continue;
      const aTime=timeMinutes(a.time),bTime=timeMinutes(b.time);
      if(aTime===null||bTime===null)continue;
      const gap=Math.abs(aTime-bTime);
      if(gap<200)pairs.push({first:aTime<=bTime?a:b,last:aTime<=bTime?b:a,gap});
    }
    pairs.sort((a,b)=>a.gap-b.gap||timeMinutes(a.first.time)-timeMinutes(b.first.time));
    if(pairs.length){
      for(const pair of pairs.slice(0,2)){
        const interval=displayTime(pair.first.time)+"–"+displayTime(pair.last.time);
        notes.push(pair.gap===0?
          "Совпадение времени "+interval+": "+(clean(pair.first.name)||"клиент")+" и "+(clean(pair.last.name)||"клиент")+"."
          :"Плотно "+interval+": "+Math.floor(pair.gap/60)+" ч "+String(pair.gap%60).padStart(2,"0")+
          " мин между началом работ (ориентир 3 ч 20 мин).");
      }
      if(pairs.length>2)notes.push("Другие близкие записи: ещё "+(pairs.length-2)+".");
    }
    const requiresAgreement=reviews.some(r=>r.requiresAgreement);
    return {notes,reviews,requiresAgreement};
  }
  function singleDraft(order,{preliminary=false}={}){
    if(!isRaul(order))throw new Error("Отправить можно только заказ, отмеченный за Раулем.");
    const title=clean(order.status)==="Отменён"?"Отмена заказа":
      clean(order.status)==="Выполнен"?"Выполненный заказ":
      preliminary?"На согласование":"Новый заказ";
    return appointmentHeading(order)+"\n"+title+"\n\n"+conciseDetails(order);
  }
  function tomorrowOrders(orders,now=new Date()){
    const date=tomorrowMoscow(now);
    return (Array.isArray(orders)?orders:[]).filter(o=>
      isRaul(o)&&String(o.date||"")===date && isActive(o)
    ).sort((a,b)=>
      displayTime(a.time).localeCompare(displayTime(b.time))||
      clean(a.name).localeCompare(clean(b.name),"ru")
    );
  }
  function dailyDraft(orders,now=new Date(),{preliminaryIds=[]}={}){
    const items=tomorrowOrders(orders,now);
    if(!items.length)return "";
    const flagged=new Set(preliminaryIds.map(String));
    return "Расписание Рауля на "+displayDate(tomorrowMoscow(now))+
      "\nЗаказов: "+items.length+"\n\n"+
      items.map((o,i)=>{
        const title=(i+1)+". "+displayTime(o.time)+" — "+(clean(o.name)||"Клиент")+
          (flagged.has(String(o.id))?" (на согласование)":"");
        const extra=[
          ...(clean(o.phone)?["Телефон: "+clean(o.phone)]:[]),
          ...(clean(o.address)?["Адрес: "+clean(o.address)]:[]),
          "Работа: "+workDescription(o),
          ...(o.price!=null&&o.price!==""?["Стоимость: "+displayPrice(o.price)]:[])
        ];
        const useful=notesForMaster(o.details);
        if(useful)extra.push("Примечание: "+useful);
        return title+"\n"+extra.join("\n");
      }).join("\n\n");
  }
  function whatsappURL(phone,text){
    const normalized=normalizePhone(phone);
    if(!normalized)throw new Error("Укажите корректный российский номер WhatsApp Рауля.");
    return "https://wa.me/"+normalized+"?text="+encodeURIComponent(String(text));
  }
  function savedPhone(){
    try{return normalizePhone(root.localStorage.getItem(PHONE_KEY));}catch(_){return null;}
  }
  function configurePhone(){
    if(!root.prompt)return null;
    const current=savedPhone();
    const value=root.prompt(
      "Номер WhatsApp Рауля (введите один раз, например +7 9XX XXX XX XX). Он сохранится только на этом устройстве.",
      current?("+"+current):""
    );
    if(value===null)return null;
    const phone=normalizePhone(value);
    if(!phone){
      root.alert?.("Номер не распознан. Введите 10 цифр после +7.");
      return null;
    }
    try{root.localStorage.setItem(PHONE_KEY,phone);}
    catch(_){root.alert?.("Не удалось сохранить номер. Его потребуется вводить снова.");}
    return phone;
  }
  function recipientLabel(value){
    const phone=normalizePhone(value);
    if(!phone)return "номер не указан";
    return "+7 "+phone.slice(1,4)+" "+phone.slice(4,7)+"-"+phone.slice(7,9)+"-"+phone.slice(9);
  }
  function openDraft(text,phone){
    if(!text){root.alert?.("На завтра у Рауля нет предстоящих заказов.");return false;}
    if(!normalizePhone(phone))return false;
    const url=whatsappURL(phone,text);
    // The action is user-initiated. WhatsApp fills a draft, but the user sends manually.
    const opened=root.open?.(url,"_blank");
    if(opened){opened.opener=null;}
    else { // Some iOS standalone/PWA configurations suppress a second window.
      root.location.assign(url);
    }
    return true;
  }
  function confirmShare(phone,items,report,{date,scope}={}){
    const heading="Получатель: Рауль · "+recipientLabel(phone)+
      "\n"+(scope||"Заказ")+" · "+displayDate(date||items[0]?.date);
    const assignment=report.requiresAgreement?
      "\nВнимание: есть заявки на согласование.": "\nНазначения: критичных конфликтов не найдено.";
    const risks=report.notes.length?"\n"+report.notes.slice(0,4).map(note=>"• "+note).join("\n"):"";
    const notice="\n\nПроверь, что это номер РАУЛЯ. Открыть черновик в WhatsApp? Сообщение отправляется вручную.";
    return !!root.confirm?.(heading+assignment+risks+notice);
  }
  function shareOne(order,orders=[]){
    if(!isRaul(order)){root.alert?.("Этот заказ не отмечен за Раулем.");return false;}
    if(!notesModuleReady())return false;
    if(hasLegacyNote(order)){
      root.alert?.("У заказа есть старый комментарий, который пока не разделён. Откройте «Изменить», перенесите важную информацию в «Комментарий мастеру», сохраните и затем отправьте Раулю.");
      return false;
    }
    const phone=savedPhone()||configurePhone();
    if(!phone)return false;
    const report=compactReview([order],orders);
    if(!confirmShare(phone,[order],report,{date:order.date,scope:"1 заказ"}))return false;
    return openDraft(singleDraft(order,{preliminary:report.requiresAgreement}),phone);
  }
  function shareTomorrow(orders){
    const items=tomorrowOrders(orders);
    if(!items.length){root.alert?.("На завтра у Рауля нет предстоящих заказов.");return false;}
    if(!notesModuleReady())return false;
    const legacy=items.filter(hasLegacyNote);
    if(legacy.length){
      root.alert?.(
        "В "+legacy.length+" заказ(ах) есть старые комментарии, которые ещё не разделены: "+
        legacy.map(o=>clean(o.name)||"Клиент").join(", ")+
        ".\\n\\nЧтобы не потерять важные условия, откройте каждый такой заказ через «Изменить», перенесите информацию в «Комментарий мастеру» и сохраните его. Затем отправьте расписание."
      );
      return false;
    }
    const phone=savedPhone()||configurePhone();
    if(!phone)return false;
    const report=compactReview(items,orders);
    if(!confirmShare(phone,items,report,{date:tomorrowMoscow(),scope:items.length+" заказ(ов)"}))return false;
    const flagged=report.reviews.filter(r=>r.requiresAgreement).map(r=>r.order.id);
    return openDraft(dailyDraft(orders,new Date(),{preliminaryIds:flagged}),phone);
  }
  return {normalizePhone,isRaul,tomorrowMoscow,tomorrowOrders,displayDate,singleDraft,
    dailyDraft,reviewOrder,reviewWarnings,compactReview,recipientLabel,notesForMaster,whatsappURL,shareOne,shareTomorrow,configurePhone,savedPhone};
});
