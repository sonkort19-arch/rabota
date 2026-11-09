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
