/* UI regression tests for compact order rows. No network, no Supabase writes.
 * Usage: node tests/orders-compact-list.js
 */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const script=fs.readFileSync(path.join(__dirname,"../orders-list.js"),"utf8");

class Element {
 constructor(tag="div"){
  this.tagName=tag.toUpperCase();this.className="";this.children=[];this.events={};
  this.hidden=false;this.attributes={};this.parentNode=null;this.id="";this._text="";
  const e=this;
  this.classList={
   contains(x){return e.className.split(" ").includes(x)},
   add(...names){for(const x of names)if(!this.contains(x))e.className=(e.className+" "+x).trim()},
   toggle(x,force){const yes=force===undefined?!this.contains(x):force;
    if(yes)this.add(x);else e.className=e.className.split(" ").filter(y=>y!==x).join(" ");return yes}
  };
 }
 set textContent(t){this._text=String(t);this.children=[]}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join("")}
 append(...items){items.forEach(x=>this.appendChild(x))}
 appendChild(x){if(x.parentNode)x.parentNode.children=x.parentNode.children.filter(y=>y!==x);
  this.children.push(x);x.parentNode=this;return x}
 prepend(x){if(x.parentNode)x.parentNode.children=x.parentNode.children.filter(y=>y!==x);
  this.children.unshift(x);x.parentNode=this}
 get firstChild(){return this.children[0]||null}
 insertBefore(x,reference){const index=this.children.indexOf(reference);
  if(x.parentNode)x.parentNode.children=x.parentNode.children.filter(y=>y!==x);
  this.children.splice(index<0?this.children.length:index,0,x);x.parentNode=this}
 replaceChildren(...items){this.children=[];this.append(...items)}
 setAttribute(k,v){this.attributes[k]=String(v)}
 getAttribute(k){return this.attributes[k]}
 addEventListener(k,fn){(this.events[k]??=[]).push(fn)}
 click(){for(const fn of this.events.click||[])fn({preventDefault(){}})}
 querySelectorAll(selector){
  if(selector===":scope > .info")return this.children.filter(x=>x.classList.contains("info"));
  const result=[];
  const visit=node=>{for(const x of node.children){
    if(selector.startsWith(".")&&x.classList.contains(selector.slice(1)))result.push(x);
    visit(x);
  }};
  visit(this);return result;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
}
function element(tag,cls="",label=""){
 const e=new Element(tag);e.className=cls;e.textContent=label;return e;
}
function fixture(role){
 const root=element("section");let originalDecorations=0,originalRefreshes=0,edits=0,paid=0;
 const document={createElement:tag=>element(tag),getElementById:id=>id==="orders"?root:null};
 const window={__rdCurrentPage:"orders",__rdDecorateOrder:()=>originalDecorations++,
  __rdRefresh:()=>originalRefreshes++};
 vm.runInNewContext(script,{window,document,currentRole:role,Intl,Date,Number,String,Array});
 const card=element("article","order-card");
 const actions=element("div","actions"),edit=element("button","action edit","Изменить");
 const controls=element("div","card-controls"),payment=element("button","payment","Не оплачено");
 edit.addEventListener("click",()=>edits++);
 payment.addEventListener("click",()=>paid++);
 actions.appendChild(edit);controls.appendChild(payment);
 card.append(element("div","card-top"),element("div","info","Адрес: тестовый"),actions,controls);
 const order={id:"synthetic-id",name:"Тестовая запись",address:"Тестовый адрес",
  date:"2026-11-02",time:"11:00",master:"Рауль",price:12345,status:"Записан",paid:false};
 window.__rdDecorateOrder(card,order);
 root.appendChild(card);
 window.__rdRefresh();window.__rdRefresh();
 return {root,card,edit,payment,window,
  get legacy(){return originalDecorations},
  get refreshes(){return originalRefreshes},
  get edits(){return edits},get payments(){return paid}};
}
for(const role of ["owner","manager"]){
 test(role+" — disclosure preserves original controls",()=>{
  const x=fixture(role);
  assert.equal(x.legacy,0);
  assert.ok(x.card.classList.contains("rd-list-row"));
  const [button,details]=x.card.children;
  assert.equal(button.tagName,"BUTTON");
  assert.equal(button.getAttribute("aria-expanded"),"false");
  assert.equal(details.hidden,true);
  button.click();
  assert.equal(details.hidden,false);
  assert.equal(button.getAttribute("aria-expanded"),"true");
  assert.ok(details.children.some(n=>n.classList.contains("actions")));
  x.edit.click();x.payment.click();
  assert.equal(x.edits,1);assert.equal(x.payments,1);
  button.click();assert.equal(details.hidden,true);
  assert.equal(x.root.querySelectorAll(".rd-list-columns").length,1);
  assert.equal(x.refreshes,2);
 });
}
test("master — original schedule is not converted",()=>{
 const x=fixture("master");
 assert.equal(x.legacy,1);
 assert.equal(x.root.querySelectorAll(".rd-list-columns").length,0);
 assert.equal(x.card.classList.contains("rd-list-row"),false);
});
