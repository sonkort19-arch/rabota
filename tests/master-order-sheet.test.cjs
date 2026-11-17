/* Raul's approved single-sheet design. Synthetic, read-only regression. */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"master-order-sheet.css"),"utf8");
const start=html.indexOf("    function masterSheetCount(value,forms){");
const end=html.indexOf("    function refreshMasterOrderDialog(){",start);
assert.ok(start>0&&end>start,"sheet builder source available");
class Element{
  constructor(tag,cls="",value=""){
    this.tagName=tag.toUpperCase();this.className=cls;
    this.textContent=String(value??"");this.children=[];
    this.classList={add:token=>{this.className+=" "+token;}};
  }
  append(...children){this.children.push(...children)}
  all(){return [this,...this.children.flatMap(child=>child.all())]}
  querySelector(selector){const cls=selector.slice(1);return this.all().find(
    node=>node.className.split(/\s+/).includes(cls))||null}
}
const make=(tag,cls,text)=>new Element(tag,cls,text);
function originalCard(order){
  const card=make("article","order-card"),actions=make("div","actions");
  actions.append(make("a","action","Позвонить"),
    make("a","action wa","WhatsApp клиенту"),
    make("a","action map-link","Открыть адрес на карте"));
  card.append(actions);
  if(order.status==="Записан")card.append(make("button","primary master-action","Принять заказ"));
  else if(order.status==="В работе")card.append(make("button","primary master-action","Заказ выполнен"));
  else if(order.status==="Выполнен")card.append(make("div","cash-share","Финансовые действия"));
  return card;
}
const factory=new Function("make","makeCard","phoneForDisplay","window","currentRole",
  html.slice(start,end)+"return {buildMasterSheetParts,masterSheetCount};")(
    make,originalCard,phone=>phone,{__rdOrderNotes:{display:note=>note||""}},"master");
const textValues=element=>element.all().map(node=>node.textContent.replace(/[\u00A0\u202F]/g," ")).filter(Boolean);
test("reference design keeps exactly one customer title, price and action set",()=>{
  const order={name:"Мадина",phone:"89188228825",address:"Ардонская 196 кв 16",
    radiators:8,floorLoops:8,price:24000,status:"Записан"};
  const result=factory.buildMasterSheetParts(order);
  const body=textValues(result.details),buttons=textValues(result.footer);
  assert.equal(body.includes("Мадина"),false,"customer appears only in sheet heading");
  assert.equal(body.filter(x=>x==="24 000 ₽").length,1,"single price");
  for(const item of ["8 918 822-88-25","Ардонская 196 кв 16","8 радиаторов",
    "8 контуров пола","Стоимость заказа"])
    assert.ok(body.includes(item),item);
  assert.deepEqual(buttons,["Позвонить","WhatsApp","Маршрут","Принять заказ"]);
});
test("existing status, payment, financial details and notes remain accessible",()=>{
  const active=factory.buildMasterSheetParts({status:"В работе",price:24000,details:"Позвонить перед выездом"});
  assert.ok(textValues(active.footer).includes("Заказ выполнен"));
  assert.ok(active.details.querySelector(".master-sheet-note"));
  const paid=factory.buildMasterSheetParts({status:"Выполнен",price:24000,paid:true});
  assert.ok(paid.details.querySelector(".cash-share"));
  assert.equal(paid.footer.querySelector(".master-action"),null);
});
test("Russian quantity labels handle one, two, and five",()=>{
  for(const [n,w] of [[1,"радиатор"],[2,"радиатора"],[5,"радиаторов"],[11,"радиаторов"],[21,"радиатор"]])
    assert.equal(factory.masterSheetCount(n,["радиатор","радиатора","радиаторов"]),n+" "+w);
});
test("master-only sheet has accessible copy icon and iOS bottom actions",()=>{
  assert.match(html,/className="master-sheet-status/);
  assert.match(html,/make\("section","mw-order-modal master-order-sheet"\)/);
  assert.match(html,/copyBtn\.setAttribute\("aria-live","polite"\)/);
  assert.match(html,/footer\.replaceChildren\(parts\.footer\)/);
  assert.match(html,/makeCard\(order\)/);
  assert.match(html,/href="\/master-order-sheet\.css\?v=20261117-reference-v1"/);
  assert.match(css,/\.master-order-sheet \.master-sheet-shortcuts\.actions > a/);
  assert.match(css,/\.master-order-sheet \.master-action\.primary/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(css,/(^|\n)\.order-card\s*\{/);
});
