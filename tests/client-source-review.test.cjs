"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const wa=require("../whatsapp-client.js");
const {createOrdersModel}=require("../order-model.js");
const contents=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const storage=new Map();
globalThis.localStorage={
  getItem:key=>storage.get(key)||null,
  setItem:(key,value)=>storage.set(key,value),
  removeItem:key=>storage.delete(key)
};
const order={name:"Александр",phone:"89181234567",date:"2026-11-20",time:"12:00",master:"Рауль",
  address:"Тестовый адрес",details:"ВНУТРЕННИЙ СЕКРЕТ"};
function setLinks(){
 const original=wa.defaults();
 return wa.saveSettings({...original,reviewUrl:"https://example.org/default",
   reviewUrls:{...original.reviewUrls,avito:"https://example.org/avito",["2gis"]:"https://example.org/2gis",
     yandex:"https://example.org/yandex"}});
}
test("Source list offers requested platforms and offline categories",()=>{
 const wanted=["avito","instagram","2gis","yandex","google","recommendation","walk_in","regular","unknown"];
 for(const key of wanted)assert.ok(wa.CLIENT_SOURCES.some(item=>item.value===key),key);
});
test("Order model serializes and reads source as dedicated database column",()=>{
 const model=createOrdersModel({statuses:["Записан","В работе","Выполнен","Отменён"],
   dbRequest:async()=>[],reloadOrders:async()=>{},getOrders:()=>[],getCurrentUserId:()=>null,
   getFinanceOperations:()=>[],getFinanceCollections:()=>[]});
 const serialized=model.serializeOrder({...order,status:"Записан",clientSource:"avito"});
 assert.equal(serialized.client_source,"avito");
 assert.equal(model.readOrder({...serialized,id:"example"}).clientSource,"avito");
 assert.equal(model.readOrder({id:"older-order"}).clientSource,"");
});
test("Avito clients get only Avito review URL, 2GIS and Yandex get their own",()=>{
 setLinks();
 const matrix={avito:"avito",["2gis"]:"2gis",yandex:"yandex"};
 for(const [source,expected] of Object.entries(matrix)){
   const message=wa.reviewText({...order,clientSource:source});
   assert.ok(message.includes("https://example.org/"+expected),source);
   for(const other of Object.values(matrix).filter(x=>x!==expected))
     assert.ok(!message.includes("https://example.org/"+other),source+" -> "+other);
   assert.ok(!message.includes("https://example.org/default"));
 }
});
test("No configured URL never silently redirects client to another platform",()=>{
 setLinks();
 for(const source of ["instagram","google","recommendation","walk_in","regular","unknown"]){
   const msg=wa.reviewText({...order,clientSource:source});
   assert.ok(!msg.includes("https://example.org/"),source);
   assert.match(msg,/отзыв/);
 }
 // Historical orders without a recorded source retain existing generic link.
 assert.match(wa.reviewText(order),/https:\/\/example.org\/default/);
});
test("Manual WhatsApp handoff uses the source-specific final text",()=>{
 setLinks();
 const url=new URL(wa.reviewLink({...order,clientSource:"avito"}));
 assert.ok(url.searchParams.get("text").includes("https://example.org/avito"));
 assert.ok(!url.searchParams.get("text").includes("example.org/2gis"));
 assert.doesNotMatch(url.searchParams.get("text"),/ВНУТРЕННИЙ СЕКРЕТ/);
});
test("Unsafe review URLs are rejected and not saved",()=>{
 const before=wa.getSettings();
 assert.throws(()=>wa.saveSettings({...before,
   reviewUrls:{...before.reviewUrls,avito:"javascript:alert(1)"}}),/https/);
 assert.deepEqual(wa.getSettings(),before);
});
test("Source UI is wired to persistence, preview and new-order validation",()=>{
 const html=contents("index.html"), settings=contents("whatsapp-settings.js");
 assert.match(html,/id="clientSource"/);
 assert.match(html,/name="clientSource"/);
 assert.match(html,/controls\.source\.value=existing\.clientSource/);
 assert.match(html,/clientSource:controls\.source\.value/);
 assert.match(html,/editingId===null && !controls\.source\.value/);
 assert.match(settings,/wa\(\)\.REVIEW_SOURCE_KEYS/);
 assert.match(settings,/reviewUrls:Object\.fromEntries/);
 assert.match(settings,/wa\(\)\.reviewText/);
 assert.match(html,/client-source\.css\?v=20261118-v1/);
});
