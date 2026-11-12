/* Read-only regression for owner/manager compact rows and modal.
 * Synthetic DOM and data only. Run: node tests/orders-compact-list.js
 */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const script=fs.readFileSync(path.join(__dirname,"../orders-list.js"),"utf8");
class Element {
 constructor(tag="div"){
  this.tagName=tag.toUpperCase();this.className="";this.children=[];this.events={};
  this.hidden=false;this.attributes={};this.dataset={};this.style={};
  this.parentNode=null;this.id="";this._text="";this.disabled=false;this.isConnected=true;
  const node=this;
  this.classList={
   contains(name){return node.className.split(" ").includes(name)},
   add(...names){for(const name of names)if(!this.contains(name))node.className=(node.className+" "+name).trim()},
   toggle(name,forced){const yes=forced===undefined?!this.contains(name):forced;
    if(yes)this.add(name);else node.className=node.className.split(" ").filter(x=>x!==name).join(" ");return yes}
  };
 }
 set textContent(value){this._text=String(value);this.children=[]}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join("")}
 append(...items){items.forEach(item=>this.appendChild(item))}
 appendChild(item){if(item.parentNode)item.parentNode.children=item.parentNode.children.filter(x=>x!==item);
  this.children.push(item);item.parentNode=this;return item}
 insertBefore(item,ref){
  if(item.parentNode)item.parentNode.children=item.parentNode.children.filter(x=>x!==item);
  const index=this.children.indexOf(ref);
  this.children.splice(index<0?this.children.length:index,0,item);item.parentNode=this;
 }
 replaceChildren(...items){this.children=[];this.append(...items)}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);this.parentNode=null}
 get firstChild(){return this.children[0]||null}
 setAttribute(k,v){this.attributes[k]=String(v)}
 getAttribute(k){return this.attributes[k]}
 addEventListener(k,fn){(this.events[k]??=[]).push(fn)}
 click(){for(const fn of this.events.click||[])fn({target:this,preventDefault(){}})}
 focus(){}
 closest(){return null}
 querySelectorAll(selector){
  const wanted=selector.includes(".")?selector.slice(selector.indexOf(".")+1).split("."):[];
  const found=[];
  const visit=root=>{for(const child of root.children){
   if(wanted.length&&wanted.every(cls=>child.classList.contains(cls)))found.push(child);
   visit(child);
  }};visit(this);return found;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
}
function el(tag,cls="",label=""){const e=new Element(tag);e.className=cls;e.textContent=label;return e}
function fixture(role){
 const root=el("section"),body=el("body");let legacy=0,refreshed=0,edits=0,pays=0;
 const document={
  body,activeElement:null,createElement:tag=>el(tag),getElementById:id=>id==="orders"?root:id==="orderOverlay"?{hidden:true}:null,
  querySelectorAll:selector=>selector==="#orders > .rd-list-row"?
   root.children.filter(x=>x.classList.contains("rd-list-row")):[],
  querySelector:()=>null,addEventListener(){},removeEventListener(){}
 };
 const window={__rdCurrentPage:"orders",__rdDecorateOrder:()=>legacy++,__rdRefresh:()=>refreshed++,
  __rdOrderNotes:{display:()=>""}};
 vm.runInNewContext(script,{document,window,currentRole:role,Intl,Date,Number,String,Array,Event});
 const card=el("article","order-card"),actions=el("div","actions");
 const edit=el("button","action edit","Изменить"),payment=el("button","payment","Оплатить");
 edit.addEventListener("click",()=>edits++);payment.addEventListener("click",()=>pays++);
 actions.append(edit);
 const controls=el("div","card-controls");controls.append(payment);
 card.append(el("div","card-top"),el("div","info","Адрес: тестовый"),actions,controls);
 const order={id:"synthetic-id",name:"Тестовая запись",address:"Тестовый адрес",
  date:"2026-11-02",time:"11:00",master:"Рауль",price:12345,status:"Записан",paid:false};
 window.__rdDecorateOrder(card,order);root.append(card);
 window.__rdRefresh();window.__rdRefresh();
 return {root,body,card,edit,payment,window,get legacy(){return legacy},
  get refreshed(){return refreshed},get edits(){return edits},get pays(){return pays}};
}
for(const role of ["owner","manager"]){
 test(role+" — compact row opens a dialog with original actions",()=>{
  const f=fixture(role),button=f.card.querySelector(".rd-list-toggle");
  assert.equal(f.legacy,0);
  assert.ok(f.card.classList.contains("rd-list-row"));
  assert.equal(f.card.dataset.rdOrderId,"synthetic-id");
  assert.equal(button.getAttribute("aria-haspopup"),"dialog");
  assert.equal(f.root.querySelectorAll(".rd-list-columns").length,1);
  button.click();
  assert.ok(f.body.querySelector(".rd-order-overlay"),"dialog appears");
  assert.match(f.body.textContent,/Тестовая запись/);
  assert.equal(f.body.querySelector(".action.edit"),f.edit,"original edit action moved, not cloned");
  f.edit.click();assert.equal(f.edits,1);
  assert.equal(f.body.querySelector(".rd-order-overlay"),null,"edit closes dialog");
  assert.equal(f.refreshed,2);
 });
 test(role+" — owner/manager detail deep link opens same modal",()=>{
  const f=fixture(role);
  assert.equal(f.window.__rdOpenOrderDetail("synthetic-id"),true);
  const close=f.body.querySelector(".rd-order-close");
  assert.ok(close);
  close.click();assert.equal(f.body.querySelector(".rd-order-overlay"),null);
 });
}
test("master view is kept unchanged by compact list wrapper",()=>{
 const f=fixture("master");
 assert.equal(f.legacy,1);
 assert.equal(f.root.querySelectorAll(".rd-list-columns").length,0);
 assert.equal(f.card.classList.contains("rd-list-row"),false);
});
