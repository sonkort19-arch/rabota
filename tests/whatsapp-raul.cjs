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
test("single-job draft puts date/time on line 1 and new-order title on line 2",()=>{
 const message=wa.singleDraft(seed);
 const lines=message.split("\n");
 assert.equal(lines[0],"Дата и время: 14.11.2026 · 18:00 МСК");
 assert.equal(lines[1],"Новый заказ");
 for(const fragment of ["Алан","Тестовая улица 15","14.11.2026","18:00 МСК","20 000 ₽","Промывка 5 радиаторов + 2 контуров тёплого пола","Позвонить заранее"])
  assert.ok(message.includes(fragment),fragment);
 for(const forbidden of ["Заказ №","Статус:","Контуры тёплого пола:","Проверь время и адрес","не указаны","Алюминиевые"])
  assert.ok(!message.includes(forbidden),"must omit "+forbidden);
 assert.match(wa.singleDraft({...seed,status:"Отменён"}),/^Дата и время:.*\nОтмена заказа/);
 assert.throws(()=>wa.singleDraft({...seed,master:"Олег"}),/Раулем/);
});
test("unassigned real-case order filters internal comments but preserves working fields",()=>{
 const russlan={...seed,id:"9964a02d",name:"Руслан",phone:"89188210384",
  address:"ул. Зураба Магкаева, 12Б, подъезд 5, этаж 4, кв. 65",
  date:"2026-11-11",time:"18:00",radiators:4,floorLoops:"",
  price:10000,assignedUserId:null,
  details:"Время подтверждено владельцем: среда, 11.11.2026, 18:00. ВНИМАНИЕ: исполнитель пока не назначен — у Рауля на эту дату уже две записи (10:00 и 13:00), система запрещает третью запись на одного мастера. Требуется назначить другого исполнителя или отдельно согласовать загрузку Рауля."
 };
 const others=[
  {...seed,id:"older1",date:"2026-11-11",time:"10:00",assignedUserId:"raul-id"},
  {...seed,id:"older2",date:"2026-11-11",time:"13:00",assignedUserId:"raul-id"}
 ];
 const warnings=wa.reviewWarnings(russlan,[russlan,...others]);
 assert.ok(warnings.some(x=>/привязка мастера в базе не подтверждена/.test(x)),"not assigned");
 assert.equal(warnings.some(x=>/Рядом по времени/.test(x)),false,"18:00 is far enough from 10:00 and 13:00");
 const msg=wa.singleDraft(russlan,{preliminary:true});
 for(const must of ["На согласование","Руслан","18:00 МСК","10 000 ₽","Промывка 4 радиаторов"])
  assert.ok(msg.includes(must),must);
 for(const forbidden of ["ВНИМАНИЕ","система запрещает","требуется назначить","Статус:","№9964a02d","не указаны"])
  assert.ok(!msg.toLowerCase().includes(forbidden.toLowerCase()),forbidden);
});
test("only unassigned or exact-time conflict needs agreement; nearby bookings are advisory",()=>{
 const base={...seed,id:"x",date:"2026-11-12",time:"15:00",assignedUserId:"raul-id"};
 const nearby={...base,id:"y",time:"16:00"};
 const sameTime={...base,id:"z",time:"15:00"};
 const distant={...base,id:"d",time:"09:00"};
 assert.ok(wa.reviewOrder(base,[base,nearby]).warnings.some(x=>/Рядом по времени/.test(x)));
 assert.equal(wa.reviewOrder(base,[base,nearby]).requiresAgreement,false);
 assert.equal(wa.reviewOrder(base,[base,sameTime]).requiresAgreement,true);
 assert.deepEqual(wa.reviewWarnings(base,[base,distant]),[]);
 assert.equal(wa.reviewOrder({...base,assignedUserId:null},[base]).requiresAgreement,true);
});
test("Levan 11 Nov assigned to Raul with 10:00, 13:00, 18:00 bookings is a new order",()=>{
 const levan={...seed,id:"levan",name:"Леван",date:"2026-11-11",time:"10:00",assignedUserId:"raul-id"};
 const bella={...seed,id:"bella",name:"Белла",date:"2026-11-11",time:"13:00",assignedUserId:"raul-id"};
 const ruslan={...seed,id:"ruslan",name:"Руслан",date:"2026-11-11",time:"18:00",assignedUserId:"raul-id"};
 const review=wa.reviewOrder(levan,[levan,bella,ruslan]);
 assert.equal(review.requiresAgreement,false,"three appointments do not force preliminary status");
 assert.ok(review.warnings.some(w=>w.includes("13:00")),"owner sees nearby appointment");
 const draft=wa.singleDraft(levan,{preliminary:review.requiresAgreement});
 assert.equal(draft.split("\n")[0],"Дата и время: 11.11.2026 · 10:00 МСК");
 assert.equal(draft.split("\n")[1],"Новый заказ");
 assert.ok(!draft.includes("На согласование"));
});
test("tomorrow is Moscow day, not the phone timezone",()=>{
 assert.equal(wa.tomorrowMoscow(new Date("2026-11-11T21:01:00Z")),"2026-11-13");
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
