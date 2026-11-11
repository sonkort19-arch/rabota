const test=require("node:test");
const assert=require("node:assert/strict");
const notes=require("../order-notes.js");
globalThis.__rdOrderNotes=notes;
const wa=require("../whatsapp-order.js");

const job={
  id:"test-order",name:"Леван",master:"Рауль",assignedUserId:"master-id",
  date:"2026-11-11",time:"10:00",status:"Записан",phone:"89284963410",
  address:"Международная, 2",radiators:4,price:10000
};

test("unclassified old comments are preserved but never included in WhatsApp",()=>{
  const legacy="Клиент: «Если не поможет, не заплачу». Нужно обсудить оплату.";
  const parsed=notes.parse(legacy);
  assert.deepEqual(parsed,{master:"",internal:legacy,legacy:true});
  assert.equal(notes.isLegacy(legacy),true);
  assert.equal(wa.singleDraft({...job,details:legacy}).includes(legacy),false);
});

test("master receives all explicit instructions, not the internal note",()=>{
  const message="Сначала проверить необходимость промывки. Клиент не согласовал условия оплаты.";
  const internal="Внутренний: предварительно уточнить решение владельца.";
  const packed=notes.pack(message,internal);
  assert.deepEqual(notes.parse(packed),{master:message,internal,legacy:false});
  assert.match(wa.singleDraft({...job,details:packed}),/Клиент не согласовал условия оплаты/);
  assert.doesNotMatch(wa.singleDraft({...job,details:packed}),/решение владельца/);
  assert.doesNotMatch(notes.display(packed,"master"),/решение владельца/);
  assert.match(notes.display(packed,"owner"),/решение владельца/);
  const daily=wa.dailyDraft([{...job,details:packed}],new Date("2026-11-10T08:00:00Z"));
  assert.match(daily,/Сначала проверить необходимость/);
  assert.doesNotMatch(daily,/решение владельца/);
});

test("unclassified comments block a single manual share",()=>{
  const message="Старый комментарий";
  const oldAlert=globalThis.alert;
  let alertText="";
  globalThis.alert=text=>{alertText=text;};
  try {
    assert.equal(wa.shareOne({...job,details:message}),false);
    assert.match(alertText,/старый комментарий/);
  }finally{globalThis.alert=oldAlert;}
});

test("malformed structured notes fail closed and oversized ones are rejected",()=>{
  assert.equal(notes.isLegacy("[rabota-notes:1]{}"),true);
  assert.throws(()=>notes.pack("x".repeat(1000),""),/слишком длинные/);
  assert.equal(notes.pack("",""),"");
});
