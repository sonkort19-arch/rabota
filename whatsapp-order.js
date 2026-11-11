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
  // Do not forward internal booking notes (or unsupported business rules) to the technician.
  // Only short, practical access and preparation instructions belong in WhatsApp.
  const INTERNAL_NOTE=/(?:внимание|исполнител|назначен|систем[аы]|запреща|треть[юяий]|две\s+запис|два\s+заказ|загру[зж]|подтверждено\s+владельц|подтвержд[её]но\s+владельц|требуется\s+назнач|согласовать|статус|оплачен|номер\s+заявки)/iu;
  const USEFUL_NOTE=/(?:позвон|звонить|наберите|предупред|подъезд|этаж|квартир|домофон|калитк|ворот|код\s+двери|ориентир|вход\s+со|парковк|собак|ключ|перекры|доступ|не\s+работает|проход|подъехать|приедьте|связаться)/iu;
  function notesForMaster(value){
    return clean(value).split(/(?<=[.!?])\s+|[\n;]+/u)
      .filter(part=>part && !INTERNAL_NOTE.test(part) && USEFUL_NOTE.test(part))
      .slice(0,2).map(part=>part.slice(0,160)).join(" ");
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
  function openDraft(text){
    if(!text){root.alert?.("На завтра у Рауля нет предстоящих заказов.");return false;}
    const phone=savedPhone()||configurePhone();
    if(!phone)return false;
    const url=whatsappURL(phone,text);
    // The action is user-initiated. WhatsApp fills a draft, but the user sends manually.
    const opened=root.open?.(url,"_blank");
    if(opened){opened.opener=null;}
    else { // Some iOS standalone/PWA configurations suppress a second window.
      root.location.assign(url);
    }
    return true;
  }
  function confirmWarnings(warnings,{requiresAgreement=false}={}){
    if(!warnings.length)return true;
    const conclusion=requiresAgreement?
      "Открыть WhatsApp с пометкой «На согласование»? Это не назначает мастера и не подтверждает время.":
      "Подтвердить проверку расписания и открыть WhatsApp с пометкой «Новый заказ»?";
    return !!root.confirm?.("Проверь перед отправкой Раулю:\n\n"+
      warnings.join("\n")+"\n\n"+conclusion);
  }
  function shareOne(order,orders=[]){
    if(!isRaul(order)){root.alert?.("Этот заказ не отмечен за Раулем.");return false;}
    const review=reviewOrder(order,orders);
    if(!confirmWarnings(review.warnings,{requiresAgreement:review.requiresAgreement}))return false;
    return openDraft(singleDraft(order,{preliminary:review.requiresAgreement}));
  }
  function shareTomorrow(orders){
    const items=tomorrowOrders(orders);
    if(!items.length){root.alert?.("На завтра у Рауля нет предстоящих заказов.");return false;}
    const reviews=items.map(order=>({order,...reviewOrder(order,orders)}));
    const flagged=reviews.filter(r=>r.requiresAgreement);
    const warnings=reviews.filter(r=>r.warnings.length);
    if(warnings.length){
      const summary=warnings.slice(0,6).map(r=>
        "• "+(clean(r.order.name)||"Клиент")+" ("+displayTime(r.order.time)+"): "+r.warnings.join(" ")
      );
      if(!confirmWarnings([
        "Проверь "+warnings.length+" из "+items.length+" заказов:",
        ...summary,
        ...(warnings.length>6?["И ещё "+(warnings.length-6)+" заказов."]:[])
      ],{requiresAgreement:flagged.length>0}))return false;
    }
    return openDraft(dailyDraft(orders,new Date(),{preliminaryIds:flagged.map(r=>r.order.id)}));
  }
  return {normalizePhone,isRaul,tomorrowMoscow,tomorrowOrders,displayDate,singleDraft,
    dailyDraft,reviewOrder,reviewWarnings,notesForMaster,whatsappURL,shareOne,shareTomorrow,configurePhone,savedPhone};
});
