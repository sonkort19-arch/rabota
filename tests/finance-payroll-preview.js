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
function fixture({preview=true,activePayroll=null,storage=new Map(),sendPayout}={}){
 const body=mk("body"),panel=mk("section"),heading=mk("h2","finance-title","История");
 const root=mk("div"),salaryRoot=mk("div"),history=mk("div"),entry=mk("div"),legacy=mk("div","","Оригинальные финансовые расчёты");
 root.append(legacy);panel.append(root,entry,heading,history);
 const lookup={financePanel:panel,financeContent:root,financeHistory:history,financeEntry:entry,rdSalaryReport:salaryRoot};
 const document={body,createElement:t=>mk(t),getElementById:id=>lookup[id]||null,
  addEventListener(){},removeEventListener(){}};
 let confirmed=0;
 const window={location:{hostname:preview?"rabota-test123456-sonkort19-6069s-projects.vercel.app":"crm.test"},
  crypto:{randomUUID},
  sessionStorage:{
   getItem:key=>storage.get(key)??null,
   setItem:(key,value)=>storage.set(key,value),
   removeItem:key=>storage.delete(key)
  },
  confirm(){confirmed++;return true},alert(){}};
 if(activePayroll)window.__rdMoneyUi={payroll:()=>activePayroll,payrollPayout:sendPayout};
 vm.runInNewContext(code,{document,window,Intl,Date,Number,String,Array});
 const model={isOwner:true,raulAccrued:22750,raulPaid:15500,raulDue:7250,
  timurAccrued:6000,timurPaid:4500,timurDue:1500,companyEarned:16750,masterHeld:7500,waitingOwner:0,
  orders:[{date:"2026-10-27",name:"Тестовый клиент",price:16000,raul:8000,timur:1500}],
  operations:[{created_at:"2026-10-27T12:00:00Z",kind:"raul_payout",amount:15500,
   voided_at:null,note:"Тестовый расчёт",order_id:null}]};
 window.__rdFinanceEnhance(model);
 let back=0;
 const payroll=window.__rdPayrollReport.mount(salaryRoot,{
   getSnapshot:()=>model,onBack:()=>{back++}
 });
 return {body,panel,heading,root,salaryRoot,payroll,history,entry,legacy,window,model,
  get back(){return back},get confirmed(){return confirmed}}
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
test("owner Finance has three tabs, salary is mounted in Reports with the same numbers",()=>{
 const f=fixture();
 assert.equal(select(f.root,"fp-tab").length,3);
 assert.ok(!f.root.textContent.includes("Сотрудники"));
 assert.equal(select(f.salaryRoot,"fp-person-row").length,2);
 assert.equal(select(f.salaryRoot,"fp-metric").length,3);
 assert.ok(f.salaryRoot.textContent.includes("8 750,00")||f.salaryRoot.textContent.includes("8 750,00"));
 assert.equal(select(f.root,"fp-original")[0].hidden,true);
});
test("employee views show earned and paid entries; preview never executes payout",()=>{
 const f=fixture();
 select(f.salaryRoot,"fp-person-button")[0].click();
 assert.equal(select(f.salaryRoot,"fp-ledger-row").length,1);
 select(f.salaryRoot,"fp-subtab")[1].click();
 assert.ok(f.salaryRoot.textContent.includes("История выплат"));
 select(f.salaryRoot,"fp-balance-payout")[0].click();
 assert.equal(select(f.body,"fp-modal").length,1);
 const inputs=select(f.body,"fp-input");
 inputs[0].value="5000";inputs[1].value="Частичная зарплата";inputs.forEach(e=>e.input());
 assert.ok(f.body.textContent.includes("2 250,00")||f.body.textContent.includes("2 250,00"));
 select(f.body,"fp-primary")[0].click();
 assert.equal(f.confirmed,0);
 assert.ok(f.body.textContent.includes("не записана в Supabase"));
});
test("switching three finance tabs preserves buttons, focus state and visibility",()=>{
 const f=fixture();
 const all=select(f.root,"fp-tab");
 assert.equal(all.length,3);
 const payments=all[0],cash=all[1],ops=all[2];
 assert.equal(payments.getAttribute("aria-pressed"),"true");
 cash.click();
 assert.equal(select(f.root,"fp-tab")[1],cash);
 assert.equal(select(f.root,"fp-tab")[0],payments);
 assert.equal(cash.getAttribute("aria-pressed"),"true");
 assert.equal(payments.getAttribute("aria-pressed"),"false");
 ops.click();
 assert.equal(select(f.root,"fp-tab")[2],ops);
 assert.equal(ops.getAttribute("aria-pressed"),"true");
 payments.click();
 assert.equal(select(f.root,"fp-tab")[0],payments);
 assert.equal(payments.getAttribute("aria-pressed"),"true");
 assert.equal(f.history.hidden,true);
 assert.equal(f.entry.hidden,true);
});
test("employee detail starts with balance, payout and only two supporting totals",()=>{
 const f=fixture();
 select(f.salaryRoot,"fp-person-button")[0].click();
 const hero=select(f.salaryRoot,"fp-balance-hero")[0];
 assert.ok(hero,"balance hero must exist");
 assert.ok(hero.textContent.includes("Баланс Рауля"));
 assert.ok(hero.textContent.includes("7 250,00")||hero.textContent.includes("7 250,00"));
 assert.equal(select(f.salaryRoot,"fp-metric").length,0,"no repeated company-wide KPI strip in employee view");
 assert.equal(select(f.salaryRoot,"fp-person-summary-item").length,2);
 const button=select(f.salaryRoot,"fp-balance-payout")[0];
 assert.equal(button.textContent,"Выплатить");
 assert.equal(button.disabled,false);
 button.click();
 assert.equal(select(f.body,"fp-modal").length,1);
 assert.equal(f.confirmed,0);
});
test("Timur detail has independent balance and the same transaction tabs",()=>{
 const f=fixture();
 select(f.salaryRoot,"fp-person-button")[1].click();
 const hero=select(f.salaryRoot,"fp-balance-hero")[0];
 assert.ok(hero.textContent.includes("Баланс Тимура"));
 assert.ok(hero.textContent.includes("1 500,00")||hero.textContent.includes("1 500,00"));
 assert.equal(select(f.salaryRoot,"fp-subtab").length,2);
 assert.equal(select(f.salaryRoot,"fp-metric").length,0);
});
test("cash and operations retain old report and operation controls",()=>{
 const f=fixture();
 select(f.root,"fp-tab")[1].click();
 assert.equal(select(f.root,"fp-original")[0].hidden,false);
 assert.ok(f.root.textContent.includes("Оригинальные финансовые расчёты"));
 select(f.root,"fp-tab")[2].click();
 assert.equal(f.history.hidden,false);
 assert.equal(f.entry.hidden,false);
 assert.equal(f.heading.hidden,false);
});

test("Reports salary preserves back navigation and blocks non-owner snapshots",()=>{
 const f=fixture();
 assert.equal(select(f.salaryRoot,"fp-report-head").length,1);
 select(f.salaryRoot,"fp-link")[0].click();
 assert.equal(f.back,1);
 const denied=mk("div");
 f.window.__rdPayrollReport.mount(denied,{getSnapshot:()=>({isOwner:false}),onBack:()=>{}});
 assert.ok(denied.textContent.includes("только владельцу"));
 assert.equal(select(denied,"fp-person-row").length,0);
});
