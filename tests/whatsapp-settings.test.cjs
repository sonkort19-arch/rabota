"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const wa=require("../whatsapp-client.js");
const repoFile=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const store=new Map();
globalThis.localStorage={
 getItem:key=>store.has(key)?store.get(key):null,
 setItem:(key,value)=>store.set(key,value),
 removeItem:key=>store.delete(key)
};
const order={name:"Александр",phone:"89181234567",date:"2026-11-20",
  time:"12:00",master:"Рауль",address:"Тестовый адрес",details:"СЕКРЕТНЫЙ ВНУТРЕННИЙ ТЕКСТ"};
test("WhatsApp templates default to existing messages",()=>{
 assert.match(wa.bookingText(order),/20.11.2026/);
 assert.match(wa.reviewText(order),/отзыв/);
});
test("Saved templates are used in both manual WhatsApp drafts",()=>{
 const state=wa.saveSettings({
  booking:"Добрый день, {имя}! Запись на {дата} в {время}. Мастер: {мастер}.",
  review:"Спасибо, {имя}! Оставьте отзыв: {ссылка}",
  reviewUrl:"https://example.org/review"
 });
 assert.equal(wa.getSettings().booking,state.booking);
 assert.equal(wa.bookingText(order),"Добрый день, Александр! Запись на 20.11.2026 в 12:00. Мастер: Рауль.");
 assert.equal(wa.bookingText({...order,price:16000,travelAmount:1000}),wa.bookingText(order)+
  "\n\nСтоимость промывки — 16 000 ₽\nДорога — 1 000 ₽\nИтого — 17 000 ₽");
 assert.match(wa.reviewText(order),/https:\/\/example.org\/review/);
 assert.match(new URL(wa.bookingLink(order)).searchParams.get("text"),/Запись на 20.11.2026/);
 assert.match(new URL(wa.reviewLink(order)).searchParams.get("text"),/Оставьте отзыв/);
 assert.doesNotMatch(wa.bookingText(order),/СЕКРЕТНЫЙ/);
});
test("Templates reject blank, overlong, unsupported tokens and unsafe link",()=>{
 const config=wa.defaults();
 assert.throws(()=>wa.saveSettings({...config,booking:" "}),/Заполните/);
 assert.throws(()=>wa.saveSettings({...config,review:"x".repeat(2501)}),/2500/);
 assert.throws(()=>wa.saveSettings({...config,booking:"{секрет}"}),/Неизвестное/);
 assert.throws(()=>wa.saveSettings({...config,reviewUrl:"javascript:alert(1)"}),/https/);
});
test("No claimed save when local storage throws",()=>{
 const old=globalThis.localStorage;
 globalThis.localStorage={getItem:old.getItem, setItem:()=>{throw Error("quota")}};
 try{assert.throws(()=>wa.saveSettings(wa.defaults()),/Не удалось сохранить/);}
 finally{globalThis.localStorage=old;}
});
test("Owner and master both expose settings, master nav has five items",()=>{
 const master=repoFile("money-workspace.js");
 const owner=repoFile("redesign.js");
 const index=repoFile("index.html");
 const style=repoFile("whatsapp-settings.css");
 assert.match(master,/\["settings","Настройки","settings"\]/);
 assert.match(master,/mwMasterSettings/);
 assert.match(master,/window\.__rdWhatsAppSettings\?\.mount\(settings,\{embedded:typeof window\.__rdSetScreenHeader==="function"\}\)/);
 assert.match(owner,/settings:"Настройки"/);
 assert.match(owner,/id="rdSettings"|sectionView\("rdSettings"/);
 assert.match(owner,/window\.__rdWhatsAppSettings\?\.mount\(settings,\{embedded:true\}\)/);
 assert.match(style,/repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(index,/whatsapp-settings\.js\?v=20261125-template-reset/);
 assert.match(index,/whatsapp-settings\.css\?v=20261124-wa-focus-v1/);
});
