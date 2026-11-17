/* CRM «Работа»: ручные сообщения клиентам через обычную ссылку WhatsApp.
 * Нет API, чтения чатов, автоматической отправки или обращения к Supabase.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root&&root.document)root.__rdClientWhatsApp=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const clean=value=>String(value??"").trim().replace(/\s+/g," ");
  function normalizePhone(value){
    let digits=String(value??"").replace(/\D/g,"");
    if(digits.length===10)digits="7"+digits;
    if(digits.length===11&&digits[0]==="8")digits="7"+digits.slice(1);
    return /^7\d{10}$/.test(digits)?digits:null;
  }
  function prettyDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
    if(!match)throw new Error("Выберите дату записи.");
    const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
    const date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)
      throw new Error("Укажите правильную дату.");
    return match[3]+"."+match[2]+"."+match[1];
  }
  function prettyTime(value){
    const time=clean(value);
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Укажите правильное время.");
    return time;
  }
  function bookingText(order){
    if(!normalizePhone(order?.phone))throw new Error("Укажите номер клиента в формате +7.");
    const name=clean(order.name)||"клиент";
    const date=prettyDate(order.date),time=prettyTime(order.time);
    const master=clean(order.master);
    return [
      "Здравствуйте, "+name+"!",
      "",
      "Вы записаны на промывку системы отопления MOBA.",
      "Дата: "+date,
      "Время: "+time+" (МСК)",
      ...(master?["Мастер: "+master]:[]),
      "",
      "Пожалуйста, ожидайте мастера в согласованное время.",
      "Если планы изменились, напишите нам в этот чат."
    ].join("\n");
  }
  function reviewText(order,reviewUrl=""){
    if(!normalizePhone(order?.phone))throw new Error("Укажите номер клиента в формате +7.");
    const name=clean(order.name)||"клиент";
    let url="";
    if(clean(reviewUrl)){
      try{
        const parsed=new URL(clean(reviewUrl));
        if(parsed.protocol!=="https:")throw new Error();
        url=parsed.href;
      }catch(_){throw new Error("Ссылка на отзывы должна начинаться с https://");}
    }
    return [
      "Здравствуйте, "+name+"!",
      "",
      "Спасибо, что выбрали MOBA! Работа по промывке системы отопления завершена.",
      "",
      "Будем благодарны, если вы оставите отзыв о нашей работе"+
        (url?":":" ответным сообщением."),
      ...(url?["",url]:[]),
      "",
      "С уважением, команда MOBA."
    ].join("\n");
  }
  function link(phone,text){
    const normalized=normalizePhone(phone);
    if(!normalized)throw new Error("Укажите номер клиента в формате +7.");
    if(!clean(text))throw new Error("Нельзя открыть пустое сообщение.");
    return "https://wa.me/"+normalized+"?text="+encodeURIComponent(String(text));
  }
  function bookingLink(order){return link(order.phone,bookingText(order));}
  function reviewLink(order,reviewUrl=""){return link(order.phone,reviewText(order,reviewUrl));}
  return {normalizePhone,prettyDate,prettyTime,bookingText,reviewText,link,bookingLink,reviewLink};
});
