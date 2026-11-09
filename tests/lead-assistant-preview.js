/* Тестовый режим: без Supabase, вызовов сети и реальных клиентов.
   Запуск: node --test tests/lead-assistant-preview.js */
"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../lead-assistant.js"),"utf8");
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.className="";this._text="";this.dataset={};this.attrs={};this.value="";this.checked=false;this.hidden=false;this.type="";this.id="";this.parent=null}
  set textContent(s){this._text=String(s);this.children=[]}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join("")}
  append(...elements){for(const el of elements){if(el.parent)el.parent.children=el.parent.children.filter(x=>x!==el);el.parent=this;this.children.push(el)}}
  replaceChildren(...elements){this.children=[];this.append(...elements)}
  setAttribute(k,v){this.attrs[k]=String(v)}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn)}
  fire(k){return Promise.all((this.events[k]||[]).map(fn=>fn({target:this,preventDefault(){}})))}
  click(){return this.fire("click")}
  querySelectorAll(selector){
    const result=[];
    function visit(n){for(const c of n.children){if(selector.startsWith(".")?c.className.split(" ").includes(selector.slice(1)):c.tagName===selector.toUpperCase())result.push(c);visit(c)}}
    visit(this);return result;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
}
function setup(){
  const root=new Element("div");root.id="rdLeadsMount";
  const app=new Element("main");app.hidden=false;
  const leads=new Element("section");leads.hidden=false;
  const lookup={rdLeadsMount:root,appScreen:app,rdLeads:leads};
  const document={createElement:tag=>new Element(tag),getElementById:id=>lookup[id]||null,querySelectorAll:()=>[]};
  const storage=new Map();let userId="manager-a";
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{storage.set(key,value)},removeItem:key=>storage.delete(key)};
  const window={addEventListener(){},setInterval(){},confirm(){return true},
    __rdLeadContext:()=>({role:"manager",userId,orders:[]})};
  const rows=[],calls=[];
  const dbRequest=async(query,method,payload)=>{
    calls.push({query,method});
    if(method==="GET")return rows.slice();
    if(method==="POST"){
      const row={...payload,id:"lead-"+(rows.length+1),updated_at:new Date().toISOString()};rows.push(row);return [row];
    }
    throw Error("Unexpected mocked method "+method);
  };
  vm.runInNewContext(source,{document,window,localStorage,dbRequest,Intl,Date,Number,String,Array,Math});
  const button=label=>root.querySelectorAll("button").find(x=>x.textContent===label);
  const type=(t,v)=>{const field=root.querySelectorAll("input").find(x=>x.type===t);assert.ok(field,"missing "+t);field.value=v;field.fire("input")};
  return {window,root,storage,button,type,getUser:()=>userId,setUser:s=>{userId=s},read:()=>rows,readLocal:()=>JSON.parse(storage.get("rabota-preview-leads-v1:"+userId)||"[]"),calls,ready:()=>window.__rdLeadsRefresh()};
}
const logic=setup().window.__rdLeadLogic;
test("salary follow-up in 20 days",()=>{
  assert.equal(logic.dueFromText("после зарплаты через 20 дней","2026-10-28").date,"2026-11-17");
});
test("new month is an approximate date, not a confirmed agreement",()=>{
  const d=logic.dueFromText("сам перезвоню в новом месяце","2026-10-28");
  assert.equal(d.date,"2026-11-01");assert.equal(d.approx,true);
});
test("next Monday is computed in Moscow calendar; tomorrow/after tomorrow work",()=>{
  assert.equal(logic.dueFromText("в понедельник","2026-10-28").date,"2026-11-02");
  assert.equal(logic.dueFromText("завтра","2026-10-28").date,"2026-10-29");
  assert.equal(logic.dueFromText("послезавтра","2026-10-28").date,"2026-10-30");
});
test("pricing uses 2000 per radiator and 1000 per circuit",()=>{
  assert.equal(logic.calc("5","1"),11000);
  assert.equal(logic.calc("6","4"),16000);
  assert.equal(logic.calc("","4"),10000);
  assert.equal(logic.calc("-1","4"),null);
});
test("compact Russian notes extract numbers, salary reason, callback and contact promise",()=>{
  const l=logic.parseNotes("Андрей 5 батарей алюминевые 1 тп после зарплаты сам наберу через 20 дней","2026-10-28");
  assert.equal(l.name,"Андрей");assert.equal(l.radiators,"5");assert.equal(l.loops,"1");
  assert.equal(l.material,"Алюминиевые");assert.equal(l.followUpDate,"2026-11-17");
  assert.equal(l.status,"waiting");assert.equal(l.reason,"salary");assert.equal(l.clientWillCall,true);
});
test("abbreviations and no-floor notes are understood",()=>{
  const l=logic.parseNotes("Андрей 5 алюм 1 тп","2026-10-28");
  assert.equal(l.radiators,"5");assert.equal(l.loops,"1");assert.equal(l.material,"Алюминиевые");
  assert.equal(logic.parseNotes("5 батарей без теплого пола","2026-10-28").loops,"0");
});
test("never alert before agreed callback time, or after conversion/rejection",()=>{
  const lead={status:"waiting",followUpDate:"2026-11-17",followUpTime:"18:00",consent:true};
  assert.equal(logic.needsCall(lead,"2026-11-17","17:59"),false);
  assert.equal(logic.needsCall(lead,"2026-11-17","18:00"),true);
  assert.equal(logic.needsCall(lead,"2026-11-18","09:00"),true);
  assert.equal(logic.needsCall({...lead,status:"ready"},"2026-11-18","09:00"),false);
  assert.equal(logic.needsCall({...lead,status:"lost"},"2026-11-18","09:00"),false);
});
test("shared lead renders and saves through mocked Supabase without network",async()=>{
  const f=setup();await f.ready();await f.button("+ Новый лид").click();
  const notes=f.root.querySelector("textarea");
  notes.value="Андрей 5 батарей алюминевые 1 тп после зарплаты сам наберу через 20 дней";
  await notes.fire("input");await f.button("Разобрать заметку").click();f.type("tel","89280000000");
  await f.button("Сохранить лид").click();
  assert.equal(f.read().length,1);assert.equal(f.read()[0].name,"Андрей");
  assert.equal(f.read()[0].radiators,5);assert.equal(f.read()[0].loops,1);
  assert.equal(f.read()[0].follow_up_date,logic.dueFromText("через 20 дней").date);
  assert.equal(f.read()[0].status,"waiting");assert.equal(f.read()[0].consent,false);
  assert.ok(f.root.textContent.includes("Лид сохранён в общей базе"));
});
test("same phone is not saved as a duplicate",async()=>{
  const f=setup();await f.ready();await f.button("+ Новый лид").click();
  const notes=f.root.querySelector("textarea");notes.value="Андрей 5 батарей";await notes.fire("input");
  await f.button("Разобрать заметку").click();f.type("tel","89280000000");await f.button("Сохранить лид").click();
  await f.button("+ Новый лид").click();
  const input=f.root.querySelectorAll("input").find(x=>x.type==="text");input.value="Другой";await input.fire("input");
  f.type("tel","+79280000000");await f.button("Сохранить лид").click();
  assert.equal(f.read().length,1);assert.ok(f.root.textContent.includes("уже принадлежит лиду"));
});
test("legacy local import remains isolated by authenticated account",()=>{
 const f=setup();f.storage.set("rabota-preview-leads-v1:manager-a",JSON.stringify([{name:"Локальный"}]));
 assert.equal(f.readLocal().length,1);f.setUser("other-manager");assert.equal(f.readLocal().length,0);
});
test("reminders use shared authorized rows and account switch clears the cache",async()=>{
 const f=setup();f.read().push({id:"one",status:"waiting",follow_up_date:"2020-01-01",follow_up_time:"18:00",consent:true});
 await f.ready();assert.equal(f.window.__rdLeadDueCount(),1);
 f.setUser("other-manager");f.window.__rdLeadsSyncNav();assert.equal(f.window.__rdLeadDueCount(),0);
});
test("lead module uses mocked dbRequest rather than uncontrolled fetch",async()=>{
 const f=setup();await f.ready();assert.doesNotMatch(source,/\bfetch\s*\(/);
 assert.ok(f.calls.length>0);assert.ok(f.calls.every(c=>c.query.startsWith("rabota_leads")));
});
