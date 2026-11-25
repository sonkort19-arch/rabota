"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const html=fs.readFileSync(require("node:path").join(__dirname,"..","index.html"),"utf8");
const client=fs.readFileSync(require("node:path").join(__dirname,"..","whatsapp-client.js"),"utf8");
function between(begin,end){
  const a=html.indexOf(begin);assert.ok(a>=0,"Missing anchor: "+begin);
  const b=html.indexOf(end,a+begin.length);assert.ok(b>=0,"Missing end: "+end);
  return html.slice(a,b);
}
test("Client WhatsApp draft module is loaded by CRM",()=>{
  assert.match(html,/<script src="\/whatsapp-client\.js\?v=20261118-safety-fix-v1"><\/script>/);
});
test("New order draft only opens after successful database save and not for edits",()=>{
  const block=between('form.addEventListener("submit",async event => {','function updateImportButton()');
  assert.ok(block.indexOf("await persistOrder(order,")>=0);
  assert.ok(block.indexOf("await persistOrder(order,")<block.indexOf('openClientDraft(order,"booking")'));
  assert.ok(block.indexOf("if(result.refreshError||paymentError)return;")>=0);
  assert.ok(block.indexOf("if(result.refreshError||paymentError)return;")<block.indexOf('openClientDraft(order,"booking")'));
  assert.match(block,/if\(!original && order\.status==="Записан"\)openClientDraft\(order,"booking"\)/);
  assert.match(block,/else if\(original && original\.status!=="Выполнен" && order\.status==="Выполнен"\)/);
});
test("Completion draft gated on real completed order in refreshed data",()=>{
  const block=between("function openCompletedClientDraft(previousOrder) {","// One confirmation replaces");
  assert.match(block,/const updated=getOrders\(\)\.find/);
  assert.match(block,/updated\?\.status==="Выполнен"/);
  assert.match(block,/previousOrder\.status!=="Выполнен"/);
});
test("Master and manager completion paths use same gated draft",()=>{
  const payment=between("async function openPaymentForOrder(order) {","function makeCard(order) {");
  const save=payment.indexOf("await orderModel.recordFullPayment");
  assert.ok(save>=0&&save<payment.indexOf("openCompletedClientDraft(order)"));
  assert.match(payment,/if\(generation!==accessGeneration\)return false;\s*if\(complete\)openCompletedClientDraft\(order\)/);
  const cards=between("function makeCard(order) {","let formPaymentChoice=null;");
  assert.match(cards,/if\(action==="complete"\)openCompletedClientDraft\(order\)/);
  assert.match(cards,/if\(state!=="Выполнен" && next\.status==="Выполнен"\)/);
});
test("Draft handoff does not use unofficial WhatsApp APIs or send automatically",()=>{
  assert.match(html,/window\.location\.assign\(url\)/);
  assert.doesNotMatch(client,/whatsapp-web\.js|Baileys|sendMessage\s*\(/i);
  assert.match(client,/https:\/\/wa\.me\//);
});
