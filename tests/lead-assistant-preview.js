/* Isolated shared leads regression with synthetic Supabase responses. */
"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../lead-assistant.js"),"utf8");
class Element {
  constructor(tag){
    this.tagName=tag.toUpperCase();this.children=[];this.events={};this.className="";this._text="";
    this.dataset={};this.attrs={};this.value="";this.checked=false;this.hidden=false;this.type="";this.id="";
  }
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join("");}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(key,fn){(this.events[key]??=[]).push(fn);}
  fire(event){return Promise.all((this.events[event]||[]).map(fn=>fn({target:this,preventDefault(){}})));}
  click(){return this.disabled?Promise.resolve():this.fire("click");}
  querySelectorAll(selector){
    const matches=node=>selector.split(",").some(part=>{
      if(part.startsWith("#"))return node.id===part.slice(1);
      if(part.startsWith("."))return node.className.split(" ").includes(part.slice(1));
      return node.tagName===part.toUpperCase();
    });
    const found=[];
    function visit(node){for(const child of node.children){if(matches(child))found.push(child);visit(child);}}
    visit(this);
    return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const stamp="2026-11-20T10:00:00+00:00";
const row=(id,name,phone="79000000000",updated_at=stamp)=>({id,name,phone,updated_at,status:"new"});
function deferred(){
  let resolve;const promise=new Promise(done=>{resolve=done});
  return {promise,resolve};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup({initialRows=[],role="manager",user="manager-a"}={}){
  const root=new Element("div");root.id="rdLeadsMount";
  const app=new Element("main"),leads=new Element("section");
  const lookup={rdLeadsMount:root,appScreen:app,rdLeads:leads};
  const document={hidden:false,createElement:tag=>new Element(tag),
    getElementById:id=>lookup[id]||root.querySelector("#"+id),querySelectorAll:()=>[]};
  const storage=new Map(),events={},calls=[];
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const window={addEventListener:(event,fn)=>{events[event]=fn},setInterval(){},confirm(){return true},
    __rdLeadContext:()=>({role,userId:user,orders:[]})};
  let rows=initialRows,get=null,sequence=0;
  async function dbRequest(query,method,body){
    const url=new URL(query,"https://test.invalid/");
    calls.push({query,method,body,user});
    if(method==="GET")return get?get(user):rows.map(value=>({...value}));
    const old=rows.find(value=>url.searchParams.get("id")==="eq."+value.id);
    if(method!=="POST"&&(!old||url.searchParams.get("updated_at")!=="eq."+old.updated_at))return [];
    if(method==="DELETE"){rows=rows.filter(value=>value!==old);return [old];}
    const saved={...old,...body,id:old?.id||"created-"+(++sequence),updated_at:"2026-11-22T11:22:33Z"};
    rows=[saved,...rows.filter(value=>value!==old)];
    return [saved];
  }
  vm.runInNewContext(source,{document,window,localStorage,dbRequest,Intl,Date,Number,String,Array,Math});
  const button=label=>root.querySelectorAll("button").find(node=>node.textContent===label);
  function field(placeholder){return root.querySelectorAll("input").find(node=>node.placeholder===placeholder);}
  async function type(placeholder,value){
    const input=field(placeholder);assert.ok(input,"missing "+placeholder);
    input.value=value;await input.fire("input");
  }
  const getLeads=()=>calls.filter(call=>call.method==="GET");
  return {window,root,button,type,field,storage,calls,getLeads,
    get rows(){return rows;}, setRows(value){rows=value;}, setRead(read){get=read;},
    setUser(value){user=value;}, setRole(value){role=value;},
    online:()=>events.online(), focus:()=>events.focus()};
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
  assert.equal(logic.needsCall({...lead,consent:false},"2026-11-18","09:00"),false);
  assert.equal(logic.needsCall({...lead,status:"lost"},"2026-11-18","09:00"),false);
});
test("relative month keeps the callback in the intended month at month end",()=>{
  assert.equal(logic.dueFromText("через 1 месяц","2026-01-31").date,"2026-02-28");
  assert.equal(logic.dueFromText("через 1 месяц","2028-01-31").date,"2028-02-29");
});
test("saving a new lead uses the shared REST table and restores the list",async()=>{
  const f=setup();
  await f.window.__rdLeadsRender();
  await f.button("+ Новый лид").click();
  await f.type("Имя клиента","Тестовый клиент");
  await f.type("+7...","89990000000");
  await f.button("Сохранить лид").click();
  assert.equal(f.rows.length,1);
  assert.equal(f.rows[0].phone_normalized,"79990000000");
  assert.match(f.root.textContent,/Лид сохранён в общей базе/);
  assert.equal(f.calls.filter(call=>call.method==="POST").length,1);

  await f.button("+ Новый лид").click();
  await f.type("Имя клиента","Дубль");
  await f.type("+7...","+7 (999) 000-00-00");
  await f.button("Сохранить лид").click();
  assert.equal(f.calls.filter(call=>call.method==="POST").length,1);
  assert.match(f.root.textContent,/Телефон уже принадлежит лиду/);
});
test("same in-flight lead read is shared and cannot overwrite a saved lead",async()=>{
  const f=setup();
  await f.window.__rdLeadsRender();
  const stale=deferred();
  f.setRead(()=>stale.promise);
  f.online();f.online();
  assert.equal(f.getLeads().length,2);
  await f.button("+ Новый лид").click();
  await f.type("Имя клиента","Только что сохранённый лид");
  await f.type("+7...","89990001111");
  await f.button("Сохранить лид").click();
  stale.resolve([]);
  await settle();
  assert.match(f.root.textContent,/Только что сохранённый лид/);
  assert.match(f.root.textContent,/Лид сохранён в общей базе/);
});
test("editing keeps the exact version shown to the user even after background refresh",async()=>{
  const f=setup({initialRows:[row("initial","Видимая версия")]});
  await f.window.__rdLeadsRender();
  await f.button("Открыть").click();
  await f.type("Имя клиента","Локальное изменение");
  f.setRows([row("initial","Изменение другого менеджера","79000000000","2026-11-21T11:00:00+00:00")]);
  f.online();
  await settle();
  assert.equal(f.field("Имя клиента").value,"Локальное изменение");
  await f.button("Сохранить изменения").click();
  const patch=f.calls.find(call=>call.method==="PATCH");
  assert.equal(new URL(patch.query,"https://test.invalid/").searchParams.get("updated_at"),"eq."+stamp);
  assert.equal(f.rows[0].name,"Изменение другого менеджера");
  assert.match(f.root.textContent,/Карточка изменилась на другом устройстве/);
});
test("a previous account result is ignored after switching accounts",async()=>{
  const f=setup();
  const old=deferred(),current=deferred();
  f.setRead(user=>user==="manager-a"?old.promise:current.promise);
  const oldRender=f.window.__rdLeadsRender();
  f.window.__rdResetLeads();
  assert.equal(f.root.textContent,"");
  f.setUser("manager-b");
  const render=f.window.__rdLeadsRender();
  old.resolve([row("old","Чужой результат")]);
  await oldRender;
  f.online();
  assert.equal(f.getLeads().length,2);
  current.resolve([row("new","Текущий результат")]);
  await render;
  assert.match(f.root.textContent,/Текущий результат/);
  assert.doesNotMatch(f.root.textContent,/Чужой результат/);
});
test("a master cannot fetch or retain the lead list",async()=>{
  const f=setup({initialRows:[row("private","Доступный лиду текст")]});
  await f.window.__rdLeadsRender();
  f.setRole("master");
  await f.window.__rdLeadsRender();
  assert.equal(f.getLeads().length,1);
  assert.equal(f.root.textContent,"");
});
test("search includes records beyond the first 100 visible results",async()=>{
  const records=Array.from({length:101},(_,index)=>row(String(index),"Клиент "+index,"79001234567"));
  records[100]=row("last","Дальний результат","79130001234");
  const f=setup({initialRows:records});
  await f.window.__rdLeadsRender();
  assert.match(f.root.textContent,/Показаны первые 100 из 101/);
  assert.doesNotMatch(f.root.textContent,/Дальний результат/);
  f.window.__rdLeadsSearch("8 (913) 000-12-34");
  assert.match(f.root.textContent,/Дальний результат/);
  assert.match(f.root.textContent,/Найдено: 1/);
});
test("both conversion actions pass only an agreed full lead price",async()=>{
  for(const [material,radiators,loops,price_agreed,expected] of [
    ["Чугунные",8,0,false,null],
    ["Чугунные",8,0,true,null],
    ["Биметаллические",8,0,false,null],
    ["Биметаллические",8,null,true,null],
    ["Биметаллические",8,0,true,16000]
  ]){
    const f=setup({initialRows:[{...row("ready","Тестовый лид"),status:"ready",material,radiators,loops,price_agreed}]});
    const emitted=[];
    f.window.__rdLeadOpenOrder=lead=>emitted.push(lead);
    await f.window.__rdLeadsRender();
    await f.button("В заказ").click();
    await f.button("Открыть").click();
    await f.button("Перевести в заказ").click();
    assert.deepEqual(emitted.map(lead=>lead.price),[expected,expected]);
    assert.deepEqual(emitted.map(lead=>lead.loops),Array(2).fill(loops??""));
    assert.equal(f.calls.filter(call=>call.method!=="GET").length,0);
  }
});
test("changing lead pricing inputs invalidates the earlier agreement until confirmed again",async()=>{
  const f=setup({initialRows:[{...row("ready","Тестовый лид"),status:"ready",material:"Биметаллические",
    radiators:8,loops:0,price_agreed:true}]});
  const emitted=[];
  f.window.__rdLeadOpenOrder=lead=>emitted.push(lead);
  await f.window.__rdLeadsRender();
  await f.button("В заказ").click();
  assert.equal(emitted.at(-1).price,16000);
  await f.button("Открыть").click();

  const checkbox=()=>f.root.querySelector("#laPriceAgreed");
  assert.equal(checkbox().checked,true);
  await f.type("5","8");
  await f.type("Имя клиента","Уточнённое имя");
  assert.equal(checkbox().checked,true,"same count and unrelated fields preserve confirmation");
  await f.type("5","10");
  assert.equal(checkbox().checked,false);
  await f.button("Перевести в заказ").click();
  assert.equal(emitted.at(-1).price,null);
  await f.button("Сохранить изменения").click();
  assert.equal(f.rows[0].radiators,10);
  assert.equal(f.rows[0].price_agreed,false);
  await f.button("В заказ").click();
  assert.equal(emitted.at(-1).price,null);

  await f.button("Открыть").click();
  checkbox().checked=true;
  await checkbox().fire("change");
  await f.button("Перевести в заказ").click();
  assert.equal(emitted.at(-1).price,20000);
  await f.type("1","2");
  assert.equal(checkbox().checked,false);
  checkbox().checked=true;
  await checkbox().fire("change");
  const material=f.root.querySelectorAll("select").find(select=>select.value==="Биметаллические");
  material.value="Алюминиевые";
  await material.fire("change");
  assert.equal(checkbox().checked,false);
});
test("filling absent price inputs from lead notes needs a fresh agreement",async()=>{
  const f=setup({initialRows:[{...row("ready","Тестовый лид"),status:"ready",material:"Биметаллические",
    radiators:8,loops:null,price_agreed:true,notes:"2 контура"}]});
  const emitted=[];
  f.window.__rdLeadOpenOrder=lead=>emitted.push(lead);
  await f.window.__rdLeadsRender();
  await f.button("Открыть").click();
  await f.button("Разобрать заметку").click();
  assert.equal(f.root.querySelector("#laPriceAgreed").checked,false);
  await f.button("Перевести в заказ").click();
  assert.equal(emitted.at(-1).loops,"2");
  assert.equal(emitted.at(-1).price,null);
});
test("failed background read retains the list and retries without another render when unchanged",async()=>{
  const f=setup({initialRows:[row("one","Сохранённый список")]});
  await f.window.__rdLeadsRender();
  const original=f.root.children[0];
  f.online();await settle();
  assert.equal(f.root.children[0],original);
  f.setRead(async()=>{throw Error("offline");});
  f.online();await settle();
  assert.match(f.root.textContent,/Сохранённый список/);
  assert.match(f.root.textContent,/Показаны сохранённые данные/);
  f.setRead(null);
  await f.button("Повторить загрузку").click();
  assert.doesNotMatch(f.root.textContent,/Повторить загрузку/);
  assert.match(f.root.textContent,/Сохранённый список/);
});
