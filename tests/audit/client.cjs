'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const extract=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const persist=extract('async function persistOrder(order)','function hasConflict');
function context(overrides={}){
 const c={crypto:{randomUUID:()=> 'new-id'},cloudOrders:[],serializeOrder:o=>({...o}),
 readOrder:o=>o,reloadOrders:async()=>{},reportSync:()=>{},render:()=>{},...overrides};
 vm.createContext(c);vm.runInContext(persist,c);return c;
}
test('committed create remains successful when list refresh fails',async()=>{
 let reports=0;
 const c=context({dbRequest:async(p,m,d)=>[d],reloadOrders:async()=>{throw Error('offline')},reportSync:()=>reports++});
 const row=await c.persistOrder({name:'Тест'});
 assert.equal(row.id,'new-id');assert.equal(reports,1);assert.equal(c.cloudOrders.length,1);
});
test('lost create response is recovered by reading the same ID',async()=>{
 const methods=[];let inserted;
 const c=context({dbRequest:async(p,m,d)=>{methods.push(m);if(m==='POST'){inserted=d;throw Error('lost response')}return [inserted]}});
 const row=await c.persistOrder({id:'stable-form-id',name:'Тест'});
 assert.equal(row.id,'stable-form-id');assert.deepEqual(methods,['POST','GET']);
});
test('an ambiguous failed create keeps its ID for retry',async()=>{
 const ids=[],order={name:'Тест'};
 const c=context({dbRequest:async(p,m,d)=>{if(m==='POST')ids.push(d.id);throw Error('offline')}});
 await assert.rejects(c.persistOrder(order));await assert.rejects(c.persistOrder(order));
 assert.deepEqual(ids,['new-id','new-id']);
});
test('stale editor uses its captured version even if background cache is newer',async()=>{
 let requested;
 const c=context({cloudOrders:[{id:'one',updatedAt:'new-version'}],
 dbRequest:async(p)=>{requested=p;return []}});
 await assert.rejects(c.persistOrder({id:'one',expectedUpdatedAt:'editor-version'}),/другом устройстве/);
 assert.match(requested,/updated_at=eq.editor-version/);
});
test('finance lost response retries the same persisted key across reloads',async()=>{
 const saved=new Map(),payloads=[];
 const c={currentRole:'owner',currentUser:{id:'owner'},crypto:{randomUUID:()=> 'request-one'},
 localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
 dbRequest:async(p,m,d)=>{payloads.push(d);throw Error('response lost')}};
 vm.createContext(c);const code=extract('async function recordFinanceOperation(','window.__rdRecordPayrollPayout=');
 vm.runInContext(code,c);
 const data={kind:'expense',amount:100,masterId:null,note:'Тест'};
 await assert.rejects(c.recordFinanceOperation(data));
 vm.runInContext(code,c);
 await assert.rejects(c.recordFinanceOperation(data));
 assert.equal(payloads[0].p_request_id,payloads[1].p_request_id);
 await assert.rejects(c.recordFinanceOperation({...data,amount:200}),/предыдущей операции/);
 c.dbRequest=async()=> 'operation-one';
 assert.equal(await c.recordFinanceOperation(data),'operation-one');assert.equal(saved.size,0);
});
test('all executable JavaScript parses',()=>{
 for(const file of ['index.html','ai.html']){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:file});
 }
 for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.js')))new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
 new vm.Script(fs.readFileSync('api/ai-chat.js','utf8'));
});

test('AI cash excludes unallocated money held by master and excludes voided expenses',async()=>{
 const source=fs.readFileSync('api/ai-chat.js','utf8');
 const c={process:{env:{}},Date,Intl};
 vm.createContext(c);vm.runInContext(source.slice(0,source.indexOf('module.exports')),c);
 const rows={
 rabota_orders:[
  {id:'held',paid:true,status:'Выполнен',price:20000,payment_amount:20000,payment_received_by:'master',master:'Рауль',assigned_user_id:'master'},
  {id:'direct',paid:true,status:'Выполнен',price:10000,payment_amount:10000,payment_received_by:'company'},
  {id:'collected',paid:true,status:'Выполнен',price:12000,payment_received_by:'master'}],
 rabota_members:[{user_id:'master',role:'master',active:true,master_name:'Рауль'}],
 rabota_cash_collections:[{order_id:'collected',confirmed_at:'2026-01-01',company_amount:4500}],
 rabota_finance_operations:[{kind:'expense',amount:500},{kind:'expense',amount:999,voided_at:'2026-01-01'}]};
 c.readRows=async(table)=>rows[table];
 const s=await c.businessSnapshot({},'финансы');
 assert.equal(s.accounting_rub.direct_receipts,10000);
 assert.equal(s.accounting_rub.master_unallocated_receipts,20000);
 assert.equal(s.accounting_rub.recorded_cash_in,14500);
 assert.equal(s.accounting_rub.recorded_cash_balance,14000);
 assert.equal(s.accounting_rub.raul_accrued,10000);
 assert.equal(s.accounting_rub.timur_accrued,1500);
});

function aiFixture(member=true){
 const calls=[],c={module:{exports:{}},process:{env:{OPENAI_API_KEY:'synthetic-test-key'}},AbortSignal,Date,Intl};
 c.fetch=async(url,options={})=>{
  calls.push({url,method:options.method||'GET'});
  const pathname=new URL(url).pathname;
  let value=[];
  if(pathname==='/auth/v1/user')value={id:'owner'};
  else if(pathname.endsWith('/rabota_members'))value=member?[{user_id:'owner',role:'owner',active:true}]:[];
  else if(url==='https://api.openai.com/v1/responses')value={output:[{type:'function_call',name:'prepare_order_action',
   arguments:JSON.stringify({action:'create',client_name:'Фото клиент',date:'2026-12-01',time:'10:00',master:'Рауль',phone:'79990000001'})}]};
  return {ok:true,status:200,json:async()=>value};
 };
 vm.createContext(c);vm.runInContext(fs.readFileSync('api/ai-chat.js','utf8'),c);
 return {c,calls};
}
async function apiCall(f,body,authorization='Bearer synthetic'){
 let status,result;const res={setHeader(){},status(n){status=n;return this},json(v){result=v;return this}};
 await f.c.module.exports({method:'POST',headers:{authorization},body},res);
 return {status,result};
}
test('AI endpoint requires authentication and active owner',async()=>{
 assert.equal((await apiCall(aiFixture(),{},'')).status,401);
 assert.equal((await apiCall(aiFixture(false),{messages:[{role:'user',content:'Привет'}]})).status,403);
});
test('AI endpoint validates image format and prepares proposal without writing orders',async()=>{
 const f=aiFixture();
 assert.equal((await apiCall(f,{messages:[{role:'user',content:'Заказ по фото'}],image:'data:text/html;base64,AAAA'})).status,413);
 const result=await apiCall(f,{messages:[{role:'user',content:'Добавь заказ по фото'}],image:'data:image/jpeg;base64,AAAA'});
 assert.equal(result.status,200);assert.equal(result.result.proposal.client_name,'Фото клиент');
 assert.ok(f.calls.filter(c=>new URL(c.url).hostname.includes('supabase')).every(c=>c.method==='GET'));
 assert.equal(f.calls.filter(c=>c.url.includes('/rpc/')).length,0,'proposal cannot execute an order');
});

test('long AI chat sends newest user message instead of first 200 messages',async()=>{
 const source=fs.readFileSync('ai.html','utf8');
 const start=source.indexOf('async function loadRecentMessages('),end=source.indexOf('async function openChat(',start);
 const all=Array.from({length:231},(_,i)=>({id:i,role:i%2?'assistant':'user',content:'Сообщение '+i}));
 let requested;
 const c={db:async query=>{
  requested=query;
  return query.includes('order=created_at.desc')?all.slice().reverse().slice(0,200):all.slice(0,200);
 }};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 const rows=await c.loadRecentMessages('test-chat');
 assert.equal(rows.length,200);assert.equal(rows.at(-1).content,'Сообщение 230');
 assert.equal(rows.at(-1).role,'user');assert.equal(rows[0].id,31);
 assert.match(requested,/created_at.desc,id.desc/);
});

test('REST order writes carry client generation and expected version',async()=>{
 const c={ensureSession:async()=>{},SUPABASE_KEY:'synthetic',SUPABASE_URL:'https://crm.test',
 session:{access_token:'synthetic'},fetch:async(url,options)=>{
  assert.equal(options.headers['X-Rabota-Client'],'2');
  assert.equal(options.headers['X-Rabota-Order-Version'],'expected');
  return {ok:true,json:async()=>[{id:'one'}]};
 }};
 vm.createContext(c);vm.runInContext(extract('async function dbRequest(','function readOrder('),c);
 await c.dbRequest('rabota_orders?id=eq.one','PATCH',{}, {'X-Rabota-Order-Version':'expected'});
});

test('finance keeps retry key after 5xx but discards it after explicit rollback error',async()=>{
 const saved=new Map();
 const c={currentRole:'owner',currentUser:{id:'owner'},crypto:{randomUUID:()=> 'same-request'},
 localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
 dbRequest:async()=>{throw Object.assign(new Error('unknown result'),{status:503})}};
 vm.createContext(c);vm.runInContext(extract('async function recordFinanceOperation(','window.__rdRecordPayrollPayout='),c);
 const data={kind:'expense',amount:100,masterId:null,note:'Тест'};
 await assert.rejects(c.recordFinanceOperation(data));assert.equal(saved.size,1);
 c.dbRequest=async()=>{throw Object.assign(new Error('transaction rejected'),{status:400})};
 await assert.rejects(c.recordFinanceOperation(data));assert.equal(saved.size,0);
});

test('UI and AI agree on direct receipts, held cash, deposits, payouts and expenses',async()=>{
 const raw=[
  {id:'held',paid:true,status:'Выполнен',price:20000,payment_amount:20000,payment_received_by:'master'},
  {id:'direct',paid:true,status:'Выполнен',price:99999,payment_amount:10000,payment_received_by:'company'},
  {id:'collected',paid:true,status:'Выполнен',price:12000,payment_received_by:'master'}];
 const collections=[{order_id:'collected',confirmed_at:'2026-01-01',company_amount:4500}];
 const operations=[{kind:'expense',amount:500},{kind:'expense',amount:999,voided_at:'2026-01-01'},
  {kind:'raul_payout',amount:100,order_id:null},{kind:'raul_payout',amount:6000,order_id:'collected'}];
 const ui={getOrders:()=>raw.map(o=>({...o,paymentAmount:o.payment_amount,paymentReceivedBy:o.payment_received_by})),
  financeCollections:collections,payments:operations.filter(o=>!o.voided_at),raulDue:0,timurDue:0,
  sumBy:(rows,fn)=>rows.reduce((sum,o)=>sum+Number(fn(o)||0),0),roundMoney:n=>Math.round(n*100)/100};
 vm.createContext(ui);
 const start=html.indexOf('const receivedOrders=getOrders().filter'),end=html.indexOf('root.append(make("h2","finance-title","Касса компании"))',start);
 vm.runInContext(html.slice(start,end)+';globalThis.actual={directReceipts,cashIn,cashBalance};',ui);
 const source=fs.readFileSync('api/ai-chat.js','utf8'),ai={process:{env:{}},Date,Intl};
 vm.createContext(ai);vm.runInContext(source.slice(0,source.indexOf('module.exports')),ai);
 ai.readRows=async table=>({rabota_orders:raw,rabota_members:[],rabota_cash_collections:collections,rabota_finance_operations:operations})[table];
 const snapshot=await ai.businessSnapshot({},'касса');
 assert.equal(ui.actual.directReceipts,snapshot.accounting_rub.direct_receipts);
 assert.equal(ui.actual.cashIn,snapshot.accounting_rub.recorded_cash_in);
 assert.equal(ui.actual.cashBalance,snapshot.accounting_rub.recorded_cash_balance);
 assert.equal(ui.actual.cashBalance,13900);
});

test('an empty success response keeps the financial retry key',async()=>{
 const saved=new Map();
 const c={currentRole:'owner',currentUser:{id:'owner'},crypto:{randomUUID:()=> 'same-request'},
 localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},dbRequest:async()=>null};
 vm.createContext(c);vm.runInContext(extract('async function recordFinanceOperation(','window.__rdRecordPayrollPayout='),c);
 await assert.rejects(c.recordFinanceOperation({kind:'expense',amount:1,masterId:null,note:'Тест'}),/Нет подтверждения/);
 assert.equal(saved.size,1);
});

test('a create retry never overwrites a saved order that appeared in background refresh',async()=>{
 let writes=0;
 const c=context({cloudOrders:[{id:'saved',name:'Правки другого пользователя',updatedAt:'latest'}],dbRequest:async()=>{writes++;return []}});
 await assert.rejects(c.persistOrder({id:'saved',creationIntent:true,name:'Старая форма создания'}),/уже сохранён/);
 assert.equal(writes,0);
});
