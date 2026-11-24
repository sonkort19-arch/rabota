"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {candidateSlots}=require("../quick-slots.js");
const source=fs.readFileSync("redesign.js","utf8");
const index=fs.readFileSync("index.html","utf8");
const styles=fs.readFileSync("ui-alignment-mobile.css","utf8");

class Node {
 constructor(tag,cls="",value){
  this.tag=tag;this.className=cls;this.textContent=value??"";
  this.children=[];this.handlers={};this.attributes={};this.dataset={};this.disabled=false;
  this.classList={add:className=>{this.className+=" "+className;}};
 }
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 addEventListener(name,fn){this.handlers[name]=fn}
 setAttribute(name,value){this.attributes[name]=value}
 querySelector(selector){
  const [className,state]=selector.slice(1).split(":");
  return traverse(this).find(node=>hasClass(node,className)&&(!state||node.disabled));
 }
 replaceWith(node){
  node.parent=this.parent;
  this.parent.children[this.parent.children.indexOf(this)]=node;
 }
}
const traverse=node=>[node,...node.children.flatMap(traverse)];
const hasClass=(node,cls)=>node.className.split(" ").includes(cls);
function pickerFor(masters,checkTime=(time,date,master)=>"available") {
 const calls=[];
 const window={
  __rdQuickSlotsSnapshot:()=>({masters}),
  __rdOrderAvailability:{checkTime},
  __rdQuickSlots:{
   core:{candidateSlots},
   open(){calls.push({type:"all"})},
   async book(slot){calls.push({type:"book",slot});return true}
  }
 };
 const fragment=source.slice(source.indexOf("function homeSlotOptions(){"),source.indexOf("function drawHome(){"));
 assert.ok(fragment.startsWith("function homeSlotOptions(){"));
 const home=new Node("section");
 home.dataset.date="2026-11-24";
 const context={window,Date,Intl,makeNode:(...params)=>new Node(...params),
  boxText:(tag,txt,cls)=>new Node(tag,cls,txt),
  smText:value=>String(value||"").trim(),
  dateLong:date=>date,
  todayMoscow:()=>home.dataset.date,ready:true,activePage:"home",$:()=>home};
 vm.createContext(context);
 vm.runInContext(fragment+";this.makeHomeSlotPicker=homeSlotPicker;this.refresh=refreshHomeSlots;",context);
 const picker=context.makeHomeSlotPicker();
 home.append(new Node("h1"),picker);
 return {picker,calls,home,refresh:context.refresh};
}

test("dashboard shows three upcoming actionable slots without opening the booking modal",async()=>{
 const {picker,calls}=pickerFor(["Рауль"]);
 const rows=traverse(picker);
 const buttons=rows.filter(n=>hasClass(n,"rd-home-slot-choice"));
 assert.equal(buttons.length,3);
 assert.equal(calls.length,0,"rendering must not initiate reservations");
 assert.ok(buttons.every(b=>b.attributes["aria-label"].includes("Рауль")));
 await buttons[0].handlers.click();
 assert.equal(calls.length,1);
 assert.equal(calls[0].type,"book");
 assert.equal(calls[0].slot.master,"Рауль");
 assert.equal(buttons[0].disabled,false);
});

test("prioritizes Raul and never shows a slot rejected by calendar checks",()=>{
 const {picker}=pickerFor(["Другой","Рауль"],(t,d,m)=>m==="Рауль"&&t==="18:00"?"available":"busy");
 const slots=traverse(picker).filter(n=>hasClass(n,"rd-home-slot-choice"));
 assert.ok(slots.length>0);
 assert.ok(slots.every(n=>n.children[0].textContent==="18:00"));
 assert.ok(traverse(picker).some(n=>String(n.textContent).includes("Мастер: Рауль")));
});

test("no fictitious availability when no master exists",()=>{
 const {picker}=pickerFor([]);
 assert.equal(traverse(picker).filter(n=>hasClass(n,"rd-home-slot-choice")).length,0);
 assert.ok(traverse(picker).some(n=>n.className==="rd-home-slots-empty"));
});

test("action hierarchy puts paid-order summary below booking and action blocks",()=>{
 const home=source.slice(source.indexOf("function drawHome(){"),source.indexOf("function drawCalendar(){"));
 assert.ok(home.indexOf("homeSlotPicker()")<home.indexOf("root.append(metrics)"));
 assert.ok(home.indexOf("root.append(upcoming)")<home.indexOf("root.append(paidSummary)"));
 assert.ok(home.indexOf("root.append(actions)")<home.indexOf("root.append(paidSummary)"));
 assert.ok(home.includes("window.__rdOpenAssignOrder?.(first.id)"));
 assert.ok(home.includes("first.date?dateLong(first.date)"));
 assert.ok(index.includes("window.__rdQuickSlotsSnapshot="));
 assert.ok(index.includes("window.__rdQuickSlotFill="));
 assert.ok(styles.includes("rd-home-slot-picker"));
 assert.ok(styles.includes("rd-nav-more"));
});

test("background recalculation leaves the homepage mounted and changes only affected slots",()=>{
 let state="available";
 const {home,picker,refresh}=pickerFor(["Рауль"],()=>state);
 const heading=home.children[0];
 refresh();
 assert.equal(home.children[1],picker);
 state="busy";
 refresh();
 assert.equal(home.children[0],heading);
 assert.notEqual(home.children[1],picker);
 assert.ok(home.children[1].querySelector(".rd-home-slots-empty"));
});

test("fixed mobile navigation exposes additional sections through the More menu",()=>{
 assert.ok(source.includes('mobile.append(navMore);'));
 assert.ok(source.includes('navMore.setAttribute("aria-controls","rdMobileMoreSheet");'));
 assert.ok(source.includes('navMore.setAttribute("aria-expanded",String(opening));'));
 assert.ok(source.includes('moreSheet.hidden=!opening;'));
});
