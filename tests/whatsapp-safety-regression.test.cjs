"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const wa=require("../whatsapp-client.js");
const files=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const store=new Map();
globalThis.localStorage={
  getItem:key=>store.get(key)??null,
  setItem:(key,v)=>store.set(key,String(v)),
  removeItem:key=>store.delete(key)
};
const base={name:"Тестовый клиент",phone:"89181234567",date:"2026-11-23",time:"12:00",master:"Рауль"};
function fresh(){
  store.clear(); return wa.defaults();
}
test("One malformed saved source URL does not erase other URLs or custom templates",()=>{
  const config=fresh();
  const customBooking="Здравствуйте, {имя}! Ждём {дата} в {время}.";
  const customReview="Ваш отзыв важен для нас, {имя}!";
  const saved=wa.saveSettings({...config,booking:customBooking,review:customReview,
    reviewUrls:{...config.reviewUrls,avito:"https://example.org/avito",
      ["2gis"]:"https://example.org/2gis"}});
  // Existing localStorage can be manually damaged on only one source.
  const corrupt={...saved,reviewUrls:{...saved.reviewUrls,instagram:"javascript:alert(1)"}};
  const key=Array.from(store.keys())[0];
  store.set(key,JSON.stringify(corrupt));
  const actual=wa.getSettings();
  assert.equal(actual.reviewUrls.instagram,"");
  assert.equal(actual.reviewUrls.avito,"https://example.org/avito");
  assert.equal(actual.reviewUrls["2gis"],"https://example.org/2gis");
  assert.equal(actual.booking,customBooking);
  assert.equal(actual.review,customReview);
});
test("Empty {ссылка} does not leave a fake link in client message",()=>{
  const config=fresh();
  wa.saveSettings({...config,review:"Здравствуйте, {имя}!\n\nСпасибо за обращение.\n\n{ссылка}\n\nС уважением, команда MOBA."});
  const result=wa.reviewText({...base,clientSource:"avito"});
  assert.doesNotMatch(result,/\{ссылка\}/);
  assert.doesNotMatch(result,/\n{3,}/);
  assert.match(result,/С уважением, команда MOBA/);
});
test("A matching Avito link still appears in the draft exactly once",()=>{
  const config=fresh();
  wa.saveSettings({...config,review:"Здравствуйте, {имя}!\n\nВаш отзыв: {ссылка}",
    reviewUrls:{...config.reviewUrls,avito:"https://example.org/review"}});
  const result=wa.reviewText({...base,clientSource:"avito"});
  assert.match(result,/https:\/\/example.org\/review/);
  assert.equal(result.split("https://example.org/review").length-1,1);
});
test("Restoring default texts never erases saved or unsaved review URL inputs",()=>{
  const config=fresh();
  const storedLink="https://example.org/old";
  const customBooking="Ваша запись оформлена, {имя}.";
  wa.saveSettings({...config,booking:customBooking,review:"Спасибо, {имя}!",
    reviewUrls:{...config.reviewUrls,avito:storedLink}});
  const handlers=new Map();
  function element(tag){
    const e={tag,children:[],attributes:{},className:"",value:"",hidden:false,style:{},
      classList:{add(){},remove(){}},
      append(...els){this.children.push(...els);},
      setAttribute(k,v){this.attributes[k]=v;},
      addEventListener(k,fn){handlers.set(this,handlers.get(this)||{});handlers.get(this)[k]=fn;},
      focus(){},setSelectionRange(){},selectionStart:0,selectionEnd:0,
      querySelector(selector){
        if(selector.startsWith(".")){
          const target=selector.slice(1);
          if(this.className?.split(" ").includes(target))return this;
          for(const ch of this.children){const found=ch.querySelector?.(selector);if(found)return found;}
        }
        return null;
      }
    };
    return e;
  }
  const originalDocument=globalThis.document,originalWindow=globalThis.window,originalConfirm=globalThis.confirm;
  const root=element("main");
  function findByClass(e,cls){
    if(e.className?.split(" ").includes(cls))return e;
    for(const c of e.children){const r=findByClass(c,cls);if(r)return r;}
    return null;
  }
  try {
    globalThis.document={createElement:element};
    globalThis.window=globalThis;
    globalThis.confirm=()=>true;
    globalThis.__rdClientWhatsApp=wa;
    delete require.cache[require.resolve("../whatsapp-settings.js")];
    require("../whatsapp-settings.js");
    globalThis.__rdWhatsAppSettings.mount(root);
    const entry=findByClass(root,"wa-settings-entry");
    assert.ok(entry);
    handlers.get(entry).click();
    const linkFields=[];
    (function walk(e){
      if(e.id?.startsWith("wa-review-source-avito-"))linkFields.push(e);
      for(const ch of e.children)walk(ch);
    })(root);
    assert.equal(linkFields.length,1);
    assert.equal(linkFields[0].value,storedLink);
    const restore=findByClass(root,"wa-settings-restore");
    assert.ok(restore);
    for(const draft of ["https://example.org/new","","незаконченная ссылка"]){
      linkFields[0].value=draft;
      handlers.get(restore).click();
      const saved=wa.getSettings();
      assert.equal(saved.reviewUrls.avito,storedLink);
      assert.equal(saved.booking,wa.DEFAULT_TEMPLATES.booking);
      assert.equal(saved.review,wa.DEFAULT_TEMPLATES.review);
      assert.equal(linkFields[0].value,draft);
    }
    linkFields[0].value="";
    handlers.get(findByClass(root,"wa-settings-save")).click();
    assert.equal(wa.getSettings().reviewUrls.avito,"","only explicit save applies the cleared draft URL");
  }finally{
    globalThis.document=originalDocument;
    globalThis.window=originalWindow;
    globalThis.confirm=originalConfirm;
    delete globalThis.__rdWhatsAppSettings;
    delete globalThis.__rdClientWhatsApp;
  }
});
test("Order card offers explicit retry and original blank chat link remains",()=>{
  const c=files("index.html");
  const card=c.slice(c.indexOf("function makeCard(order) {"),c.indexOf("let formPaymentChoice=null;"));
  assert.match(card,/\"WhatsApp клиенту\"/);
  assert.match(card,/\"Текст записи\"/);
  assert.match(card,/\"Запросить отзыв\"/);
  assert.match(card,/if\(state!==\"Отменён\"\)/);
  assert.match(card,/openClientDraft\(fresh,fresh\.status===\"Выполнен\"\?\"review\":\"booking\"\)/);
  assert.match(c,/whatsapp-client\.js\?v=20261125-travel/);
  assert.match(c,/whatsapp-settings\.js\?v=[\w-]+/);
});
