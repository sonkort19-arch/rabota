/* CRM "Работа": manually initiated WhatsApp drafts for the assigned master Raul.
 * Never transmits data until the owner/manager explicitly opens WhatsApp.
 * No database or WhatsApp API writes. Raul's number is local to this device.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports)module.exports=api;
  if(root && root.document)root.__rdWhatsApp=api;
})(typeof window!=="undefined"?window:globalThis,function(){
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
    return Number.isFinite(n)?n.toLocaleString("ru-RU")+" ₽":"не указана";
  }
  function jobId(order){return clean(order.id)?String(order.id).slice(0,8):"не указан";}
  function describe(order){
    const info=[
      "Клиент: "+(clean(order.name)||"не указан"),
      "Телефон: "+(clean(order.phone)||"не указан"),
      "Адрес: "+(clean(order.address)||"не указан"),
      "Дата: "+displayDate(order.date),
      "Время: "+displayTime(order.time)+(order.time?" МСК":""),
      "Радиаторы: "+(order.radiators==null||order.radiators===""?"не указаны":order.radiators),
      "Контуры тёплого пола: "+(order.floorLoops==null||order.floorLoops===""?"не указаны":order.floorLoops),
      "Стоимость: "+displayPrice(order.price),
      "Статус: "+(clean(order.status)||"не указан")
    ];
    if(clean(order.radiatorType))info.splice(6,0,"Тип радиаторов: "+clean(order.radiatorType));
    if(clean(order.details))info.push("Комментарий: "+clean(order.details));
    return info.join("\n");
  }
  function singleDraft(order){
    if(!isRaul(order))throw new Error("Отправить можно только заказ, назначенный Раулю.");
    const title=clean(order.status)==="Отменён"?"ОТМЕНА заказа для Рауля":"Актуальный заказ для Рауля";
    return title+"\nЗаказ №"+jobId(order)+"\n\n"+describe(order)+"\n\nПроверь время и адрес перед выездом.";
  }
  function tomorrowOrders(orders,now=new Date()){
    const date=tomorrowMoscow(now);
    return (Array.isArray(orders)?orders:[]).filter(o=>
      isRaul(o)&&String(o.date||"")===date &&
      !["Отменён","Выполнен"].includes(clean(o.status))
    ).sort((a,b)=>
      displayTime(a.time).localeCompare(displayTime(b.time))||
      clean(a.name).localeCompare(clean(b.name),"ru")
    );
  }
  function dailyDraft(orders,now=new Date()){
    const date=tomorrowMoscow(now),items=tomorrowOrders(orders,now);
    if(!items.length)return "";
    return "Расписание Рауля на "+displayDate(date)+"\n"+
      "Заказов: "+items.length+"\n\n"+
      items.map((o,i)=>(
        (i+1)+". "+displayTime(o.time)+" — "+(clean(o.name)||"Клиент")+
        "\n"+describe(o)+"\n№"+jobId(o)
      )).join("\n\n")+
      "\n\nАктуально на момент отправки. При изменении времени или адреса пришлю новое сообщение.";
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
  function shareOne(order){
    if(!isRaul(order)){root.alert?.("Этот заказ не назначен Раулю.");return false;}
    return openDraft(singleDraft(order));
  }
  function shareTomorrow(orders){return openDraft(dailyDraft(orders));}
  return {normalizePhone,isRaul,tomorrowMoscow,tomorrowOrders,displayDate,singleDraft,
    dailyDraft,whatsappURL,shareOne,shareTomorrow,configurePhone,savedPhone};
});
