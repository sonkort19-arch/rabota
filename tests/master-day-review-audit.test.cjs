"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createMasterUI}=require("../master-ui.js");
const index=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
test("Master day and nearest banner use only assigned user's active orders",()=>{
  assert.match(index,/o\.assignedUserId===currentUser\?\.id&&\s*o\.status!=="Выполнен"/);
  assert.match(index,/masterWorkingOrders\(\)\.filter\(o=>o\.assignedUserId===currentUser\?\.id\)/);
  assert.match(index,/src="\/master-ui\.js\?v=[A-Za-z0-9_-]+"/);
});
test("Nearest order correctly changes from date to Сегодня after Moscow midnight",()=>{
  let now=new Date("2026-11-19T20:30:00Z"); // Moscow: Nov 19 23:30.
  class DateImpl extends Date{constructor(...args){super(...(args.length?args:[now]));}}
  const make=(tag,cls="",value="")=>({
    tag,className:cls,textContent:value,children:[],attributes:{},type:"",
    append(...items){this.children.push(...items);},
    setAttribute(k,v){this.attributes[k]=v;},
    addEventListener(){},replaceChildren(...items){this.children=items;}
  });
  const banner={hidden:true,children:[],
    replaceChildren(...items){this.children=items;},
    append(...items){this.children.push(...items);}
  };
  const ui=createMasterUI({
    make,parseDate:value=>new Date(value+"T00:00:00Z"),
    formatDate:value=>value.split("-").reverse().join("."),
    getOrders:()=>[],collectionForOrder:()=>null,
    getCurrentRole:()=>"master",getCurrentTab:()=>"calendar",
    doc:{getElementById:()=>banner},ordersNode:make("div"),
    openMasterOrderDialog:()=>{},STATUSES:["Записан","В работе","Выполнен","Отменён"],
    DateImpl
  });
  const order={id:"test-id",date:"2026-11-20",time:"12:00",status:"Записан",name:"Марик"};
  ui.renderMasterOverview([order]);
  assert.match(banner.children[0].children[1].textContent,/20\.11\.2026/);
  assert.doesNotMatch(banner.children[0].children[1].textContent,/Сегодня/);
  now=new Date("2026-11-19T21:05:00Z"); // Moscow: Nov 20 00:05.
  ui.renderMasterOverview([order]);
  assert.match(banner.children[0].children[1].textContent,/Сегодня/);
});
test("Deleting all completed orders hides their day section after next render",()=>{
  const make=(tag,cls="",value="")=>({
    tag,className:cls,textContent:value,children:[],attributes:{},dataset:{},
    append(...items){this.children.push(...items);},
    setAttribute(){},addEventListener(){},replaceChildren(...items){this.children=items;},
    classList:{add(){},toggle(){}}
  });
  const ordersNode=make("div");
  const ui=createMasterUI({
    make,parseDate:value=>new Date(value+"T00:00:00Z"),formatDate:x=>x,
    getOrders:()=>[],collectionForOrder:()=>null,
    getCurrentRole:()=>"master",getCurrentTab:()=>"calendar",
    doc:{getElementById:()=>({hidden:true,replaceChildren(){},append(){}})},
    ordersNode,openMasterOrderDialog:()=>{},STATUSES:["Записан","В работе","Выполнен","Отменён"]
  });
  const example={id:"test",date:"2026-11-28",time:"15:00",status:"Выполнен",name:"Юрий"};
  ui.renderMasterCompletedDay([example],"2026-11-28");
  assert.equal(ordersNode.children.length,1);
  ordersNode.replaceChildren();
  ui.renderMasterCompletedDay([],"2026-11-28");
  assert.equal(ordersNode.children.length,0);
});
