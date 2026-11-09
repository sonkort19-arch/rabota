"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {candidateSlots}=require("../quick-slots.js");
const source=fs.readFileSync("redesign.js","utf8");
const index=fs.readFileSync("index.html","utf8");
const styles=fs.readFileSync("ui-alignment.css","utf8");

class Node {
 constructor(tag,cls="",value){
  this.tag=tag;this.className=cls;this.textContent=value??"";
  this.children=[];this.handlers={};this.attributes={};this.disabled=false;
 }
 append(...nodes){this.children.push(...nodes)}
 addEventListener(name,fn){this.handlers[name]=fn}
 setAttribute(name,value){this.attributes[name]=value}
}
const traverse=node=>[node,...node.children.flatMap(traverse)];
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
 const fragment=source.slice(source.indexOf("function homeSlotPicker(){"),source.indexOf("function drawHome(){"));
 assert.ok(fragment.startsWith("function homeSlotPicker(){"));
 const context={window,Date,Intl,makeNode:(...params)=>new Node(...params),
  boxText:(tag,txt,cls)=>new Node(tag,cls,txt),
  smText:value=>String(value||"").trim(),
  dateLong:date=>date};
 vm.createContext(context);
 vm.runInContext(fragment+";this.makeHomeSlotPicker=homeSlotPicker;",context);
 return {picker:context.makeHomeSlotPicker(),calls};
}

test("dashboard shows three upcoming actionable slots without opening the booking modal",async()=>{
 const {picker,calls}=pickerFor(["Рауль"]);
 const rows=traverse(picker);
 const buttons=rows.filter(n=>n.className==="rd-home-slot-choice");
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
 const slots=traverse(picker).filter(n=>n.className==="rd-home-slot-choice");
 assert.ok(slots.length>0);
 assert.ok(slots.every(n=>n.children[0].textContent==="18:00"));
 assert.ok(traverse(picker).some(n=>String(n.textContent).includes("Мастер: Рауль")));
});

test("no fictitious availability when no master exists",()=>{
 const {picker}=pickerFor([]);
 assert.equal(traverse(picker).filter(n=>n.className==="rd-home-slot-choice").length,0);
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

test("nav overflow cue is only visible when more tab content exists",()=>{
 assert.ok(source.includes("mobile.scrollWidth<=mobile.clientWidth+5"));
 assert.ok(source.includes("mobile.scrollLeft+mobile.clientWidth>=mobile.scrollWidth-8"));
 assert.ok(source.includes("mobile.scrollBy("));
});
