/* Финансы: безопасный UI smoke-test. Только синтетические данные, без сети или Supabase.
 * Запуск: node tests/finance-payroll-preview.js
 */
"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const {randomUUID}=require("node:crypto");
const code=fs.readFileSync(path.join(__dirname,"../finance-payroll.js"),"utf8");
class Element {
 constructor(tag){
  this.tagName=tag.toUpperCase();this.className="";this.children=[];this.events={};
  this.parent=null;this.attrs={};this.hidden=false;this.value="";this.disabled=false;this.id="";this.style={};
  this._text="";
 }
 set textContent(value){this._text=String(value);this.children=[]}
 get textContent(){return this._text+this.children.map(e=>e.textContent).join("")}
 get firstChild(){return this.children[0]||null}
 append(...children){children.forEach(e=>this.appendChild(e))}
 appendChild(e){if(e.parent)e.parent.children=e.parent.children.filter(v=>v!==e);
  this.children.push(e);e.parent=this}
 replaceChildren(...children){this.children=[];this.append(...children)}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null}
 contains(node){return node===this||this.children.some(child=>child.contains?.(node))}
 setAttribute(key,value){this.attrs[key]=String(value)}
 getAttribute(key){return this.attrs[key]}
 addEventListener(key,fn){(this.events[key]??=[]).push(fn)}
 click(){for(const fn of this.events.click||[])fn({target:this,preventDefault(){}})}
 input(){for(const fn of this.events.input||[])fn({target:this})}
 focus(){}
 querySelector(query){
  if(query===":scope > h2.finance-title")return this.children.find(
    e=>e.tagName==="H2"&&e.className.split(" ").includes("finance-title"))||null;
  return null;
 }
}
const mk=(tag,cls,txt)=>{const e=new Element(tag);e.className=cls||"";if(txt!==undefined)e.textContent=txt;return e};
const select=(root,cls)=>{
 const result=[];function visit(e){if(e.className.split(" ").includes(cls))result.push(e);e.children.forEach(visit)}visit(root);return result
};
const defaultPayroll={active:true,ready:true,actorId:"owner",employeeId:"raul",
 earned:6500,paid:2000,due:4500,accruals:[],payouts:[]};
function fixture({preview=true,activePayroll=defaultPayroll,storage=new Map(),sendPayout}={}){
 const body=mk("body"),salaryRoot=mk("div");
 const document={body,createElement:t=>mk(t),getElementById:id=>id==="rdSalaryReport"?salaryRoot:null,
  addEventListener(){},removeEventListener(){}};
 const window={location:{hostname:preview?"rabota-test123456-sonkort19-6069s-projects.vercel.app":"crm.test"},
  crypto:{randomUUID},
  sessionStorage:{
   getItem:key=>storage.get(key)??null,
   setItem:(key,value)=>storage.set(key,value),
   removeItem:key=>storage.delete(key)
  }};
 window.__rdMoneyUi={payroll:()=>activePayroll,payrollPayout:sendPayout};
 vm.runInNewContext(code,{document,window,Intl,Date,Number,String,Array});
 let back=0;
 const payroll=window.__rdPayrollReport.mount(salaryRoot,{onBack:()=>{back++}});
 return {body,salaryRoot,payroll,window,get back(){return back}};
}

test("active payroll shows Raul only and leaves the payout controls out of the master's view",()=>{
 const activePayroll={active:true,ready:true,actorId:"owner",employeeId:"raul",employeeName:"Рауль",
  earned:6500,paid:2000,due:4500,accruals:[{reference:"№00052",title:"Синтетический заказ",
  earned:6500,actualPaid:10000,earnedAt:"2026-11-22T21:30:00Z"}],
  payouts:[{amount:2000,method:"card",note:"Синтетическая выплата",occurredAt:"2026-11-23T10:00:00Z"}],
  refunds:[{reference:"№00053",title:"Возврат по заказу",amount:4000,earnedReversed:3500,
    earnedAt:"2026-11-21T10:00:00Z",occurredAt:"2026-11-23T12:00:00Z"}]};
 const f=fixture({activePayroll});
 const report=select(f.salaryRoot,"fp-v3-payroll")[0];
 assert.ok(report);
 assert.match(report.textContent,/Рауль/);
 assert.doesNotMatch(report.textContent,/Тимур/);
 assert.equal(select(report,"fp-v3-actions").length,1);
 assert.match(report.textContent,/№00052.*Синтетический заказ/);
 select(report,"fp-subtab")[1].click();
 assert.match(f.salaryRoot.textContent,/Синтетическая выплата.*Карта/);
 select(f.salaryRoot,"fp-subtab")[2].click();
 assert.match(f.salaryRoot.textContent.replace(/\s/g," "),/Возвращено клиенту 4 000,00 ₽.*−3 500,00 ₽/);
 assert.doesNotMatch(f.salaryRoot.textContent,/Синтетическая выплата/);
 const master=mk("div");
 f.window.__rdPayrollReport.mount(master,{master:true});
 assert.equal(select(master,"fp-v3-actions").length,0);
 assert.match(master.textContent,/Моя зарплата.*Осталось получить/);
});

test("only the owner sees disputed historical entries separate from the payable balance",()=>{
 const activePayroll={active:true,ready:true,actorId:"owner",employeeId:"raul",
  earned:5500,paid:5500,due:0,accruals:[],payouts:[],holds:[
   {orderNumber:101,payrollOnHold:true,cashOnHold:false,earned:6500,credited:6500,
    linkedRecorded:6500,reason:"Проверить повторную запись"},
   {orderNumber:102,payrollOnHold:false,cashOnHold:true,paymentAmount:8000,
    reason:"Уточнить местонахождение наличных"}
  ]};
 const f=fixture({activePayroll});
 const review=select(f.salaryRoot,"fp-cutover-review")[0];
 assert.match(review.textContent.replace(/\s/g," "),/Архив сверки · 2 заказов.*№00101.*в старом журнале по заказу 6 500,00 ₽.*№00102.*Получено от клиента 8 000,00 ₽.*историческая запись на сверке/);
 assert.equal(select(f.salaryRoot,"fp-balance-payout")[0].disabled,true);
 const master=mk("div");
 f.window.__rdPayrollReport.mount(master,{master:true});
 assert.equal(select(master,"fp-cutover-review").length,0);
});

test("a paid trip reversal remains in the accrual history and shows repayment credit without payment controls",()=>{
 const activePayroll={...defaultPayroll,earned:0,paid:1000,due:0,balance:-1000,overpaid:1000,
  baseEarned:0,travelEarned:0,travelHistory:[
   {orderId:"trip",orderNumber:52,delta:1000,occurredAt:"2026-11-22T10:00:00Z"},
   {orderId:"trip",orderNumber:52,delta:-1000,occurredAt:"2026-11-23T10:00:00Z"}
  ],payouts:[{amount:1000,method:"cash",occurredAt:"2026-11-22T11:00:00Z"}]};
 const f=fixture({activePayroll});
 const compact=value=>value.textContent.replace(/\s/g," ");
 assert.equal(compact(select(f.salaryRoot,"fp-balance-value")[0]),"0,00 ₽");
 assert.match(compact(select(f.salaryRoot,"fp-travel-overpayment")[0]),/Переплата 1 000,00 ₽/);
 assert.equal(select(f.salaryRoot,"fp-balance-payout")[0].disabled,true);
 assert.equal(select(f.salaryRoot,"fp-v3-partial")[0].disabled,true);
 const [adjustment,accrual]=select(f.salaryRoot,"fp-travel-row");
 assert.match(compact(adjustment),/Дорога · №00052.*Корректировка начисления за дорогу.*−1 000,00 ₽/);
 assert.match(compact(accrual),/Дорога · №00052.*Доплата за дорогу.*1 000,00 ₽/);
 select(f.salaryRoot,"fp-subtab")[1].click();
 assert.match(compact(f.salaryRoot),/История выплат.*1 000,00 ₽/);
});

test("after a lost payout response the next page resumes the original intent, even at zero due",async()=>{
 const storage=new Map(),calls=[],committed=new Map();
 const activePayroll={active:true,ready:true,actorId:"original-owner",employeeId:"raul",
  earned:8000.50,paid:0,due:8000.50,accruals:[],payouts:[]};
 const sendPayout=async intent=>{
  calls.push(intent);
  if(!committed.has(intent.requestId)){
   committed.set(intent.requestId,{id:"fixture-receipt",amount:intent.amount,due:0});
   throw Error("Соединение потеряно после записи");
  }
  return {receipt:committed.get(intent.requestId)};
 };
 const first=fixture({preview:false,activePayroll,storage,sendPayout});
 select(first.salaryRoot,"fp-balance-payout")[0].click();
 assert.equal(select(first.body,"fp-input")[0].value,"8000,50");
 select(first.body,"fp-primary")[0].click();
 await new Promise(setImmediate);
 assert.equal(select(first.body,"fp-primary")[0].textContent,"Повторить отправку");
 assert.equal(select(first.body,"fp-input").every(input=>input.disabled),true);

 const nextSnapshot={...activePayroll,paid:8000.50,due:0};
 const unrelated=fixture({preview:false,activePayroll:{...nextSnapshot,actorId:"other-owner"},storage,sendPayout});
 assert.doesNotMatch(unrelated.salaryRoot.textContent,/Продолжить выплату/);
 const resumed=fixture({preview:false,activePayroll:nextSnapshot,storage,sendPayout});
 const proceed=select(resumed.salaryRoot,"fp-balance-payout")[0];
 assert.equal(proceed.textContent,"Продолжить выплату");proceed.click();
 select(resumed.body,"fp-primary")[0].click();
 await new Promise(setImmediate);
 assert.equal(calls.length,2);
 assert.equal(calls[0].requestId,calls[1].requestId);
 assert.equal(calls[0].amount,calls[1].amount);
 assert.equal(committed.size,1);
 assert.equal(storage.size,0);
 assert.match(resumed.body.textContent,/Выплата проведена/);
});

test("account reset closes an in-flight payroll dialog and ignores its late receipt",async()=>{
 const activePayroll={active:true,ready:true,actorId:"owner",employeeId:"raul",
  earned:6500,paid:0,due:6500,accruals:[],payouts:[]};
 let confirm;
 const response=new Promise(resolve=>{confirm=resolve;});
 const storage=new Map(),f=fixture({preview:false,activePayroll,storage,sendPayout:()=>response});
 select(f.salaryRoot,"fp-balance-payout")[0].click();
 select(f.body,"fp-primary")[0].click();
 assert.equal(select(f.body,"fp-modal").length,1);
 f.window.__rdResetPayrollUi();
 assert.equal(select(f.body,"fp-modal").length,0);
 const [key,previous]=storage.entries().next().value;
 const replacement=JSON.stringify({...JSON.parse(previous),requestId:randomUUID()});
 storage.set(key,replacement);
 confirm({id:"test",amount:6500,due:0});
 await new Promise(setImmediate);
 assert.equal(select(f.body,"fp-modal").length,0);
 assert.equal(storage.get(key),replacement);
});
test("owner salary starts with one balance, history tabs and two totals",()=>{
 const f=fixture();
 const hero=select(f.salaryRoot,"fp-balance-hero")[0];
 assert.ok(hero);
 assert.match(hero.textContent.replace(/\s/g," "),/Рауль.*4 500,00 ₽/);
 assert.equal(select(f.salaryRoot,"fp-person-summary-item").length,2);
 const tabs=select(f.salaryRoot,"fp-subtab");
 assert.equal(tabs.length,2);
 assert.equal(tabs[0].getAttribute("aria-pressed"),"true");
 tabs[1].click();
 assert.match(f.salaryRoot.textContent,/История выплат/);
 assert.equal(select(f.salaryRoot,"fp-subtab")[1].getAttribute("aria-pressed"),"true");
 assert.doesNotMatch(f.salaryRoot.textContent,/Тимур|Передать|Подтвердить получение/);
});
test("preview refuses a real payout even when the owner form is open",()=>{
 let writes=0;
 const f=fixture({sendPayout:()=>{writes++}});
 select(f.salaryRoot,"fp-balance-payout")[0].click();
 assert.equal(select(f.body,"fp-modal").length,1);
 select(f.body,"fp-primary")[0].click();
 assert.equal(writes,0);
 assert.match(f.body.textContent,/не записана в Supabase/);
});
test("reports retain navigation and block salary when access is absent",()=>{
 const f=fixture();
 select(f.salaryRoot,"fp-link")[0].click();
 assert.equal(f.back,1);
 const denied=fixture({activePayroll:{active:false,ready:true}});
 assert.match(denied.salaryRoot.textContent,/только владельцу/);
 assert.equal(select(denied.salaryRoot,"fp-v3-payroll").length,0);
});
