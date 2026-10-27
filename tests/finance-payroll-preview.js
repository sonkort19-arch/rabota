/* Финансы: безопасный UI smoke-test. Только синтетические данные, без сети или Supabase.
 * Запуск: node tests/finance-payroll-preview.js
 */
"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const code=fs.readFileSync(path.join(__dirname,"../finance-payroll.js"),"utf8");
class Element {
 constructor(tag){
  this.tagName=tag.toUpperCase();this.className="";this.children=[];this.events={};
  this.parent=null;this.attrs={};this.hidden=false;this.value="";this.disabled=false;this.id="";
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
function fixture(){
 const body=mk("body"),panel=mk("section"),heading=mk("h2","finance-title","История");
 const root=mk("div"),history=mk("div"),entry=mk("div"),legacy=mk("div","","Оригинальные финансовые расчёты");
 root.append(legacy);panel.append(root,entry,heading,history);
 const lookup={financePanel:panel,financeContent:root,financeHistory:history,financeEntry:entry};
 const document={body,createElement:t=>mk(t),getElementById:id=>lookup[id]||null,
  addEventListener(){},removeEventListener(){}};
 let confirmed=0;
 const window={location:{hostname:"rabota-test123456-sonkort19-6069s-projects.vercel.app"},
  confirm(){confirmed++;return true},alert(){}};
 vm.runInNewContext(code,{document,window,Intl,Date,Number,String,Array});
 const model={isOwner:true,raulAccrued:22750,raulPaid:15500,raulDue:7250,
  timurAccrued:6000,timurPaid:4500,timurDue:1500,companyEarned:16750,masterHeld:7500,waitingOwner:0,
  orders:[{date:"2026-10-27",name:"Тестовый клиент",price:16000,raul:8000,timur:1500}],
  operations:[{created_at:"2026-10-27T12:00:00Z",kind:"raul_payout",amount:15500,
   voided_at:null,note:"Тестовый расчёт",order_id:null}]};
 window.__rdFinanceEnhance(model);
 return {body,panel,heading,root,history,entry,legacy,window,model,get confirmed(){return confirmed}}
}
test("owner finance opens on salary; totals come from supplied numbers",()=>{
 const f=fixture();
 assert.equal(select(f.root,"fp-tab").length,3);
 assert.equal(select(f.root,"fp-person-row").length,2);
 assert.equal(select(f.root,"fp-metric").length,3);
 assert.ok(f.root.textContent.includes("8 750,00")||f.root.textContent.includes("8 750,00"));
 assert.equal(select(f.root,"fp-original")[0].hidden,true);
});
test("employee views show earned and paid entries; preview never executes payout",()=>{
 const f=fixture();
 select(f.root,"fp-person-button")[0].click();
 assert.equal(select(f.root,"fp-ledger-row").length,1);
 select(f.root,"fp-subtab")[1].click();
 assert.ok(f.root.textContent.includes("История выплат"));
 select(f.root,"fp-balance-payout")[0].click();
 assert.equal(select(f.body,"fp-modal").length,1);
 const inputs=select(f.body,"fp-input");
 inputs[0].value="5000";inputs[1].value="Частичная зарплата";inputs.forEach(e=>e.input());
 assert.ok(f.body.textContent.includes("2 250,00")||f.body.textContent.includes("2 250,00"));
 select(f.body,"fp-primary")[0].click();
 assert.equal(f.confirmed,0);
 assert.ok(f.body.textContent.includes("не записана в Supabase"));
});
test("switching finance tabs preserves button identity, focus target and active states",()=>{
 const f=fixture();
 const all=select(f.root,"fp-tab");
 assert.equal(all.length,3);
 const salary=all[0],cash=all[1],ops=all[2];
 assert.equal(salary.getAttribute("aria-pressed"),"true");
 cash.click();
 assert.equal(select(f.root,"fp-tab")[1],cash);
 assert.equal(select(f.root,"fp-tab")[0],salary);
 assert.equal(cash.getAttribute("aria-pressed"),"true");
 assert.equal(salary.getAttribute("aria-pressed"),"false");
 ops.click();
 assert.equal(select(f.root,"fp-tab")[2],ops);
 assert.equal(ops.getAttribute("aria-pressed"),"true");
 salary.click();
 assert.equal(select(f.root,"fp-tab")[0],salary);
 assert.equal(salary.getAttribute("aria-pressed"),"true");
 assert.equal(f.history.hidden,true);
 assert.equal(f.entry.hidden,true);
});
test("employee detail starts with balance, payout and only two supporting totals",()=>{
 const f=fixture();
 select(f.root,"fp-person-button")[0].click();
 const hero=select(f.root,"fp-balance-hero")[0];
 assert.ok(hero,"balance hero must exist");
 assert.ok(hero.textContent.includes("Баланс Рауля"));
 assert.ok(hero.textContent.includes("7 250,00")||hero.textContent.includes("7 250,00"));
 assert.equal(select(f.root,"fp-metric").length,0,"no repeated company-wide KPI strip in employee view");
 assert.equal(select(f.root,"fp-person-summary-item").length,2);
 const button=select(f.root,"fp-balance-payout")[0];
 assert.equal(button.textContent,"Выплатить");
 assert.equal(button.disabled,false);
 button.click();
 assert.equal(select(f.body,"fp-modal").length,1);
 assert.equal(f.confirmed,0);
});
test("Timur detail has independent balance and the same transaction tabs",()=>{
 const f=fixture();
 select(f.root,"fp-person-button")[1].click();
 const hero=select(f.root,"fp-balance-hero")[0];
 assert.ok(hero.textContent.includes("Баланс Тимура"));
 assert.ok(hero.textContent.includes("1 500,00")||hero.textContent.includes("1 500,00"));
 assert.equal(select(f.root,"fp-subtab").length,2);
 assert.equal(select(f.root,"fp-metric").length,0);
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
