/* CRM «Работа»: вручную открываем WhatsApp с редактируемыми сообщениями.
 * На устройстве сохраняются только шаблоны, не клиентские данные.
 * Нет API WhatsApp, автоотправки или изменения заказов.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root&&root.document)root.__rdClientWhatsApp=api;
})(typeof window!=="undefined"?window:globalThis,function(root){
  "use strict";
  const STORAGE_KEY="rd-client-wa-message-templates-v1";
  // Keep legacy defaults so previously saved links survive a text upgrade.
  // User-edited copy is never overwritten.
  const LEGACY_TEMPLATES=Object.freeze({
    booking:"Здравствуйте, {имя}!\n\nВы записаны на промывку системы отопления MOBA.\nДата: {дата}\nВремя: {время} (МСК)\nМастер: {мастер}\n\nПожалуйста, ожидайте мастера в согласованное время.\nЕсли планы изменились, напишите нам в этот чат.",
    review:"Здравствуйте, {имя}!\n\nСпасибо, что выбрали MOBA! Работа по промывке системы отопления завершена.\n\nБудем благодарны, если вы оставите отзыв о нашей работе ответным сообщением.\n\nС уважением, команда MOBA."
  });
  const DEFAULT_TEMPLATES=Object.freeze({
    booking:"Здравствуйте, {имя}!\n\nВы записаны на промывку системы отопления MOBA.\n\nДата: {дата}\nВремя: {время} (МСК)\nМастер: {мастер}\n\nЕсли понадобится перенести запись, напишите нам в этот чат.",
    review:"Здравствуйте, {имя}!\n\nСпасибо, что выбрали MOBA! Работа по промывке системы отопления завершена.\n\nБудем благодарны за честный отзыв о нашей работе — это помогает другим клиентам сделать выбор.\n\nС уважением, команда MOBA."
  });
  const TOKENS=Object.freeze(["имя","дата","время","мастер","адрес","ссылка"]);
  // Shared stable values: stored in order.client_source, not the display text.
  const CLIENT_SOURCES=Object.freeze([
    {value:"avito",label:"Авито"},{value:"instagram",label:"Instagram"},
    {value:"2gis",label:"2ГИС"},{value:"yandex",label:"Яндекс Карты"},
    {value:"google",label:"Google Карты"},{value:"vk",label:"ВКонтакте"},
    {value:"telegram",label:"Telegram"},{value:"website",label:"Сайт"},
    {value:"recommendation",label:"По рекомендации"},
    {value:"walk_in",label:"Мимо проходил"},
    {value:"regular",label:"Постоянный клиент"},
    {value:"other",label:"Другое"},{value:"unknown",label:"Неизвестно"}
  ]);
  const REVIEW_SOURCE_KEYS=Object.freeze(["avito","instagram","2gis","yandex","google","vk","telegram","website"]);
  const sourceLabel=key=>CLIENT_SOURCES.find(item=>item.value===key)?.label||"";
  const validSource=value=>CLIENT_SOURCES.some(item=>item.value===value)?value:"";
  const emptyReviewUrls=()=>Object.fromEntries(REVIEW_SOURCE_KEYS.map(key=>[key,""]));
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
  function validateTemplate(value,label){
    const text=String(value??"").trim();
    if(!text)throw new Error("Заполните шаблон «"+label+"».");
    if(text.length>2500)throw new Error("Максимум 2500 символов для шаблона «"+label+"».");
    for(const match of text.matchAll(/\{([^{}]+)\}/g)){
      if(!TOKENS.includes(match[1].trim().toLowerCase()))
        throw new Error("Неизвестное поле {"+match[1]+"} в шаблоне «"+label+"».");
    }
    return text;
  }
  function validateReviewUrl(value){
    const url=clean(value);
    if(!url)return "";
    try{
      const parsed=new URL(url);
      if(parsed.protocol!=="https:")throw new Error();
      return parsed.href;
    }catch(_){throw new Error("Ссылка на отзывы должна начинаться с https://");}
  }
  function defaults(){return {...DEFAULT_TEMPLATES,reviewUrl:"",reviewUrls:emptyReviewUrls()};}
  function validateSettings(data){
    if(!data||typeof data!=="object")throw new Error("Настройки не распознаны.");
    return {
      booking:validateTemplate(data.booking,"После записи"),
      review:validateTemplate(data.review,"После завершения"),
      reviewUrl:validateReviewUrl(data.reviewUrl||""),
      reviewUrls:Object.fromEntries(REVIEW_SOURCE_KEYS.map(key=>[
        key,validateReviewUrl(data.reviewUrls?.[key]||"")
      ]))
    };
  }
  function getSettings(){
    try{
      const saved=root?.localStorage?.getItem(STORAGE_KEY);
      if(!saved)return defaults();
      const parsed={...defaults(),...JSON.parse(saved)};
      if(parsed.booking===LEGACY_TEMPLATES.booking)parsed.booking=DEFAULT_TEMPLATES.booking;
      if(parsed.review===LEGACY_TEMPLATES.review)parsed.review=DEFAULT_TEMPLATES.review;
      // A single stale or malformed URL should not discard all other saved links
      // or reset the owner's personal message templates.
      const safeTemplate=(value,label,fallback)=>{
        try{return validateTemplate(value,label);}catch(_){return fallback;}
      };
      const safeUrl=value=>{
        try{return validateReviewUrl(value||"");}catch(_){return "";}
      };
      return {
        booking:safeTemplate(parsed.booking,"После записи",DEFAULT_TEMPLATES.booking),
        review:safeTemplate(parsed.review,"После завершения",DEFAULT_TEMPLATES.review),
        reviewUrl:safeUrl(parsed.reviewUrl),
        reviewUrls:Object.fromEntries(REVIEW_SOURCE_KEYS.map(key=>[
          key,safeUrl(parsed.reviewUrls?.[key])
        ]))
      };
    }catch(_){return defaults();}
  }
  function saveSettings(data){
    const next=validateSettings(data);
    // Safari can disallow storage; never claim a successful save when it fails.
    if(!root?.localStorage)throw new Error("Хранилище браузера недоступно.");
    try{root.localStorage.setItem(STORAGE_KEY,JSON.stringify(next));}
    catch(_){throw new Error("Не удалось сохранить. Проверьте доступ к памяти браузера.");}
    return next;
  }
  function renderTemplate(template,order,reviewUrl=""){
    const vars={
      имя:clean(order?.name)||"клиент",
      дата:order?.date?prettyDate(order.date):"",
      время:order?.time?prettyTime(order.time):"",
      мастер:clean(order?.master)||"уточняется",
      адрес:clean(order?.address),
      ссылка:reviewUrl
    };
    validateTemplate(template,"Сообщение");
    let templateText=String(template);
    // When there is no configured review URL, remove standalone "{ссылка}"
    // lines (optionally prefixed by a short "Ссылка:" label).
    if(!reviewUrl){
      templateText=templateText.replace(
        /^[ \t]*(?:(?:Ссылка|Ссылка на отзыв|Оставить отзыв)[ \t]*:[ \t]*)?\{[ \t]*ссылка[ \t]*\}[ \t]*$/gim,""
      );
    }
    let result=templateText.replace(/\{([^{}]+)\}/g,(_whole,name)=>vars[name.trim().toLowerCase()]??"");
    if(!reviewUrl)result=result.replace(/\n{3,}/g,"\n\n");
    return result.trim();
  }
  function bookingText(order){
    if(!normalizePhone(order?.phone))throw new Error("Укажите номер клиента в формате +7.");
    prettyDate(order.date);prettyTime(order.time);
    const message=renderTemplate(getSettings().booking,order);
    const travel=Number(order.travelAmount);
    const wash=order.price!=null&&clean(order.price)!==""?Number(order.price):NaN;
    if(!Number.isFinite(wash)||wash<0||!Number.isFinite(travel)||travel<=0)return message;
    const format=value=>value.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g," ")+" ₽";
    const summary=["Стоимость промывки — "+format(wash),"Дорога — "+format(travel),"Итого — "+format(wash+travel)];
    return message+"\n\n"+summary.join("\n");
  }
  function sourceReviewUrl(order,settings){
    const source=validSource(order?.clientSource);
    if(source)return REVIEW_SOURCE_KEYS.includes(source)?settings.reviewUrls[source]||"":"";
    // Preserve the previously configured generic URL for old orders with no source.
    return settings.reviewUrl||"";
  }
  function reviewText(order,reviewUrl,settingsOverride){
    if(!normalizePhone(order?.phone))throw new Error("Укажите номер клиента в формате +7.");
    const settings=settingsOverride?validateSettings(settingsOverride):getSettings();
    const url=validateReviewUrl(reviewUrl===undefined?sourceReviewUrl(order,settings):reviewUrl);
    let message=renderTemplate(settings.review,order,url);
    if(url&&!/\{\s*ссылка\s*\}/i.test(settings.review)){
      // Place the review action BEFORE the signature, not after it.
      if(message.includes("ответным сообщением."))
        message=message.replace("ответным сообщением.","по ссылке ниже.");
      const source=validSource(order?.clientSource);
      const action=(sourceLabel(source)?"Оставить отзыв — "+sourceLabel(source):"Оставить отзыв")+":\n"+url;
      const signature="\n\nС уважением, команда MOBA.";
      const index=message.lastIndexOf(signature);
      message=index>=0?message.slice(0,index)+"\n\n"+action+message.slice(index):message+"\n\n"+action;
    }
    return message;
  }
  function link(phone,text){
    const normalized=normalizePhone(phone);
    if(!normalized)throw new Error("Укажите номер клиента в формате +7.");
    if(!clean(text))throw new Error("Нельзя открыть пустое сообщение.");
    return "https://wa.me/"+normalized+"?text="+encodeURIComponent(String(text));
  }
  function bookingLink(order){return link(order.phone,bookingText(order));}
  function reviewLink(order,reviewUrl){return link(order.phone,reviewText(order,reviewUrl));}
  return {normalizePhone,prettyDate,prettyTime,DEFAULT_TEMPLATES,TOKENS,CLIENT_SOURCES,REVIEW_SOURCE_KEYS,
    sourceLabel,validSource,defaults,getSettings,saveSettings,validateSettings,renderTemplate,
    sourceReviewUrl,bookingText,reviewText,link,bookingLink,reviewLink};
});
