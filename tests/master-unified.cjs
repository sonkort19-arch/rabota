/* Synthetic-only regression tests of Raul's unified navigation and payment statement. */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const base=path.resolve(__dirname,"..");
const load=name=>fs.readFileSync(path.join(base,name),"utf8");
class Node{
 constructor(tag){
  this.tag=tag;this.className="";this.children=[];this.textContent="";
  this.handlers={};this.attributes={};this.hidden=false;
 }
 append(...xs){this.children.push(...xs)}
 replaceChildren(...xs){this.children=[...xs]}
 addEventListener(type,fn){this.handlers[type]=fn}
 setAttribute(n,v){this.attributes[n]=String(v)}
}
const find=(node,cls)=>[
 ...(String(node.className).split(" ").includes(cls)?[node]:[]),
 ...node.children.flatMap(c=>find(c,cls))
];
test("orders are not silently removed just because their status is closed",()=>{
 const window={},document={getElementById(){return null}};
 vm.runInNewContext(load("money-workspace.js"),{window,document,Intl,Date,Number,String,Array,Set,Map});
 assert.equal(window.__rdMasterOrdersMode,"orders");
 const all=["Новый","Записан","В работе","Выполнен","Отменён"]
   .map((status,i)=>({id:i,status,name:"Клиент "+i,address:"Владикавказ"}));
 assert.deepEqual(window.__rdMasterApplyOrderFilters(all).map(x=>x.status),all.map(x=>x.status));
 assert.equal(window.__rdMasterApplyOrderFilters([]).length,0);
});
test("receipts are summed once; handovers and payroll stay separate",()=>{
 const window={},document={createElement:tag=>new Node(tag)};
 vm.runInNewContext(load("master-payments.js"),{window,document,Intl,Date,Number,String,Array});
 const root=new Node("section");
 const sample={
  role:"master",error:"",
  paymentOrders:[
   {id:"1",name:"А",status:"Выполнен",date:"2026-11-10",amount:10000,method:"cash",paidAt:"2026-11-10T10:00:00Z"},
   {id:"2",name:"Б",status:"Выполнен",date:"2026-11-11",amount:20000,method:"card",paidAt:"2026-11-11T10:00:00Z"}
  ],
  collections:[{orderId:"1",amount:12000,confirmedAt:"2026-11-11T12:00:00Z"}],
  payouts:[{id:"p1",amount:8000,payment_method:"cash",created_at:"2026-11-12T10:00:00Z",note:"Выплата"}]
 };
 window.__rdMasterPaymentsRender(root,sample);
 const tiles=find(root,"mw-payment-metric");
 assert.equal(tiles.length,3);
 assert.match(tiles[0].children[1].textContent,/30[\s\u00a0\u202f]000/);
 assert.match(tiles[1].children[1].textContent,/10[\s\u00a0\u202f]000/);
 assert.match(tiles[2].children[1].textContent,/20[\s\u00a0\u202f]000/);
 assert.equal(find(root,"mw-payment-row").length,4);
 const filter=find(root,"mw-payment-filter").find(b=>b.textContent==="Наличные");
 filter.handlers.click();
 assert.equal(find(root,"mw-payment-row").length,2);
});
test("owner has no master-only write controls or duplicated upper navigation",()=>{
 const html=load("index.html"),css=load("master-unified.css");
 assert.match(html,/id="masterBrand"/);
 assert.match(css,/#ordersArea > \.tabs\{\s*display:none!important/);
 assert.match(css,/body\.rd #appScreen\.rd-master\.master-mode/);
 assert.match(html,/id="rdProfileMenu"/);
 assert.match(html,/data-tab="history"/); // Owner & manager legacy tabs remain.
 assert.doesNotMatch(load("master-payments.js"),/rpc\/rabota_cashbook_record_v1|rpc\/rabota_salary_payout_v2/);
 assert.match(load("master-order-dialog.js"),/window\.__rdOpenMasterDialog=open/);
});
