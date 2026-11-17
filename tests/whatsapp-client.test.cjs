"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const wa=require("../whatsapp-client.js");
const order={name:"Александр",phone:"8 (918) 123-45-67",date:"2026-11-20",time:"12:00",master:"Рауль",details:"Внутренняя заметка — НЕ ПОКАЗЫВАТЬ"};
test("Accepts Russian phone variants but rejects unrelated numbers",()=>{
  for(const input of ["89181234567","+7 918 123-45-67","9181234567"])
    assert.equal(wa.normalizePhone(input),"79181234567");
  for(const input of ["", "123", "+49 1234567890","javascript:alert(1)"])
    assert.equal(wa.normalizePhone(input),null);
});
test("Booking draft includes appointment facts without internal notes",()=>{
  const msg=wa.bookingText(order);
  for(const item of ["Александр","20.11.2026","12:00 (МСК)","Рауль","MOBA"])
    assert.ok(msg.includes(item),item);
  assert.ok(!msg.includes("Внутренняя заметка"));
  assert.ok(!msg.includes(order.phone));
});
test("Review draft asks for honest review, never claims it was sent",()=>{
  const msg=wa.reviewText(order);
  assert.match(msg,/отзыв/);
  assert.doesNotMatch(msg,/отправлено|доставлено|5 звёзд|Внутренняя заметка/);
  assert.match(wa.reviewText(order,"https://example.org/review"),/https:\/\/example.org\/review/);
  assert.throws(()=>wa.reviewText(order,"javascript:alert(1)"),/https/);
});
test("Rejects invalid dates and times",()=>{
  assert.throws(()=>wa.bookingText({...order,date:"2026-02-30"}),/дату/);
  assert.throws(()=>wa.bookingText({...order,time:"25:00"}),/время/);
});
test("Produces WhatsApp click-to-chat link but does not send",()=>{
  const url=wa.bookingLink(order);
  assert.ok(url.startsWith("https://wa.me/79181234567?text="));
  assert.equal(new URL(url).searchParams.get("text"),wa.bookingText(order));
  assert.equal(new URL(wa.reviewLink(order)).searchParams.get("text"),wa.reviewText(order));
});
