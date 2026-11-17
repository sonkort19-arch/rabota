"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const wa=require("../whatsapp-client.js");
const storage=new Map();
globalThis.localStorage={
 getItem:key=>storage.has(key)?storage.get(key):null,
 setItem:(key,value)=>storage.set(key,value),
 removeItem:key=>storage.delete(key)
};
const base={name:"Марик",phone:"89181234567",date:"2026-11-20",time:"12:00",
 master:"Рауль",clientSource:"avito",details:"Секретная служебная заметка"};
test("Short default booking has appointment facts but no internal notes",()=>{
 const text=wa.bookingText(base);
 for(const token of ["Марик","MOBA","20.11.2026","12:00","Рауль"])assert.ok(text.includes(token),token);
 assert.ok(!text.includes(base.details));
 assert.ok(!text.includes("ожидайте мастера в согласованное время"));
});
test("Configured Avito URL is before MOBA signature and not duplicated",()=>{
 const settings=wa.defaults();
 wa.saveSettings({...settings,reviewUrls:{...settings.reviewUrls,
   avito:"https://example.org/avito",["2gis"]:"https://example.org/2gis"}});
 const text=wa.reviewText(base);
 const link=text.indexOf("https://example.org/avito"),signature=text.indexOf("С уважением, команда MOBA.");
 assert.ok(link>=0&&signature>link,{link,signature});
 assert.equal(text.split("https://example.org/avito").length-1,1);
 assert.ok(!text.includes("example.org/2gis"));
 assert.ok(!text.includes(base.details));
});
test("No platform URL leads to honest request without unrelated URL",()=>{
 const text=wa.reviewText({...base,clientSource:"instagram"});
 assert.match(text,/отзыв/);
 assert.ok(!text.includes("example.org/"),text);
});
test("Legacy stored defaults upgrade without touching saved review links",()=>{
 const legacyBooking="Здравствуйте, {имя}!\n\nВы записаны на промывку системы отопления MOBA.\nДата: {дата}\nВремя: {время} (МСК)\nМастер: {мастер}\n\nПожалуйста, ожидайте мастера в согласованное время.\nЕсли планы изменились, напишите нам в этот чат.";
 const legacyReview="Здравствуйте, {имя}!\n\nСпасибо, что выбрали MOBA! Работа по промывке системы отопления завершена.\n\nБудем благодарны, если вы оставите отзыв о нашей работе ответным сообщением.\n\nС уважением, команда MOBA.";
 const all=wa.getSettings();
 wa.saveSettings({...all,booking:legacyBooking,review:legacyReview,
  reviewUrls:{...all.reviewUrls,avito:"https://example.org/my-avito-review"}});
 const upgraded=wa.getSettings();
 assert.equal(upgraded.booking,wa.DEFAULT_TEMPLATES.booking);
 assert.equal(upgraded.review,wa.DEFAULT_TEMPLATES.review);
 assert.equal(upgraded.reviewUrls.avito,"https://example.org/my-avito-review");
});
test("Customized templates are never overwritten by upgrade",()=>{
 const customBooking="Добрый день, {имя}! Ваш визит {дата} в {время}.";
 const customReview="Спасибо, {имя}! Ваш отзыв: {ссылка}";
 const old=wa.getSettings();
 wa.saveSettings({...old,booking:customBooking,review:customReview});
 assert.equal(wa.getSettings().booking,customBooking);
 assert.equal(wa.getSettings().review,customReview);
 assert.match(wa.reviewText(base),/https:\/\/example.org\/my-avito-review/);
});
