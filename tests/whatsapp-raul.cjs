"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const wa=require("../whatsapp-order.js");
const seed={id:"f2f24242-aaaa",master:"Рауль",name:"Алан",phone:"+7 900 000-00-00",address:"Тестовая улица 15",date:"2026-11-14",time:"18:00",radiators:5,floorLoops:2,radiatorType:"Алюминиевые",price:20000,status:"Записан",details:"Позвонить заранее"};
test("Russian WhatsApp number input normalized without guessing foreign numbers",()=>{
 assert.equal(wa.normalizePhone("+7 (918) 123-45-67"),"79181234567");
 assert.equal(wa.normalizePhone("8 918 123-45-67"),"79181234567");
 assert.equal(wa.normalizePhone("9181234567"),"79181234567");
 assert.equal(wa.normalizePhone("00 49 123"),null);
 assert.equal(wa.normalizePhone("javascript:alert(1)"),null);
});
test("Raul detection exact and case insensitive",()=>{
 assert.ok(wa.isRaul(seed));assert.ok(wa.isRaul({...seed,master:" раУль "}));
 assert.equal(wa.isRaul({...seed,master:"Рауль и Тимур"}),false);
});
test("single-job draft contains current details and notes for master",()=>{
 const message=wa.singleDraft(seed);
 for(const fragment of ["Алан","Тестовая улица 15","14.11.2026","18:00 МСК","20 000 ₽","Алюминиевые","Контуры тёплого пола: 2","Позвонить заранее"])
  assert.ok(message.includes(fragment),fragment);
 assert.match(wa.singleDraft({...seed,status:"Отменён"}),/^ОТМЕНА заказа/);
 assert.throws(()=>wa.singleDraft({...seed,master:"Олег"}),/Раулю/);
});
test("tomorrow is Moscow day, not the phone timezone",()=>{
 assert.equal(wa.tomorrowMoscow(new Date("2026-11-11T20:59:00Z")),"2026-11-13");
 assert.equal(wa.tomorrowMoscow(new Date("2026-11-11T19:59:00Z")),"2026-11-12");
});
test("tomorrow schedule includes only active Raul jobs sorted by time",()=>{
 const now=new Date("2026-11-11T12:00:00Z");
 const orders=[
  {...seed,id:"b",date:"2026-11-12",time:"18:00",name:"Второй"},
  {...seed,id:"a",date:"2026-11-12",time:"10:00",name:"Первый"},
  {...seed,id:"c",date:"2026-11-12",time:"12:00",name:"Отмена",status:"Отменён"},
  {...seed,id:"d",date:"2026-11-12",time:"11:00",name:"Готов",status:"Выполнен"},
  {...seed,id:"e",date:"2026-11-12",time:"15:00",name:"Другой",master:"Олег"},
  {...seed,id:"f",date:"2026-11-13",time:"09:00",name:"Позднее"}
 ];
 const result=wa.tomorrowOrders(orders,now);
 assert.deepEqual(result.map(x=>x.id),["a","b"]);
 const message=wa.dailyDraft(orders,now);
 assert.ok(message.indexOf("Первый")<message.indexOf("Второй"));
 assert.match(message,/Заказов: 2/);
 assert.doesNotMatch(message,/Отмена|Готов|Другой|Позднее/);
 assert.equal(wa.dailyDraft([],now),"");
});
test("WhatsApp URL only pre-fills text; no automatic send API",()=>{
 const url=wa.whatsappURL("89181234567",wa.singleDraft(seed));
 assert.ok(url.startsWith("https://wa.me/79181234567?text="));
 assert.ok(decodeURIComponent(url).includes("Тестовая улица 15"));
 assert.throws(()=>wa.whatsappURL("invalid","text"),/номер/);
});
