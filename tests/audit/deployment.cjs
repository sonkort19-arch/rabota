'use strict';
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
const {test}=require('node:test');
if(process.env.RABOTA_DISPOSABLE_DB!=='YES'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='rabota_audit')throw Error('Disposable local DB required');
const sql=s=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const apply=file=>sql(fs.readFileSync(file,'utf8'));
sql('drop schema if exists public cascade;drop schema if exists auth cascade;drop schema if exists private cascade;create schema public;');
apply('tests/audit/baseline.sql');apply('tests/audit/remaining-schema.sql');
const owner='10000000-0000-4000-8000-000000000001',master='10000000-0000-4000-8000-000000000002',
 stranger='10000000-0000-4000-8000-000000000003',other='10000000-0000-4000-8000-000000000004',
 manager='10000000-0000-4000-8000-000000000005',inactive='10000000-0000-4000-8000-000000000006';
const id='20000000-0000-4000-8000-000000000001';
const seed=`insert into auth.users(id) values ('${owner}'),('${master}'),('${stranger}'),('${other}'),('${manager}'),('${inactive}');
insert into public.rabota_members(user_id,role,master_name,active) values ('${owner}','owner','',true),('${master}','master','Рауль',true),('${other}','master','Другой',true),('${manager}','manager','',true),('${inactive}','owner','',false);
insert into public.rabota_orders(id,name,phone,master,status,appointment_date,appointment_time,price) values ('${id}','Тест','79990000001','Рауль','В работе',current_date+7,'10:00',20000);
insert into public.rabota_finance_operations(kind,amount,note,created_by) values ('expense',11,'Историческая запись без request_id','${owner}');`;
sql(seed);
const act=(user,body,headers={})=>`set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true);select set_config('request.headers','${JSON.stringify(headers)}',true);${body}`;
const run=s=>sql('begin;'+s+';rollback;');
const denied=(s,regex)=>assert.throws(()=>run(s),e=>regex.test(String(e.stderr)));
const pay=`select public.rabota_record_order_payment('${id}',20000,'cash')`;

test('release prerequisites match the production-derived core fixture',()=>apply('sql/000-preflight.sql'));
test('standalone C1 changes no rows and is repeatable',()=>{
 const before=sql('select md5(to_jsonb(o)::text) from public.rabota_orders o');
 apply('sql/001-c1-emergency.sql');apply('sql/001-c1-emergency.sql');
 assert.equal(sql('select md5(to_jsonb(o)::text) from public.rabota_orders o'),before);
 apply('sql/000-preflight.sql');
});
test('C1: missing/inactive membership and foreign master are denied',()=>{
 for(const user of [stranger,inactive,other])denied(act(user,pay),/Нет прав|другому мастеру/);
 denied(`set local role anon;${pay}`,/permission denied/);
 denied(`select set_config('request.jwt.claim.sub','',true);${pay}`,/Нет прав/);
});
test('C1: active owner and manager retain company payment; assigned master retains master payment',()=>{
 for(const user of [owner,manager])assert.ok(run(act(user,pay)).includes('"receiver": "company"'));
 assert.ok(run(act(master,pay)).includes('"receiver": "master"'));
 denied(`update public.rabota_orders set status='Записан';${act(master,pay)}`,/принятый в работу/);
 denied(`update public.rabota_orders set status='Отменён';${act(owner,pay)}`,/Отменённый/);
});
test('preflight rejects schema drift before any migration',()=>{
 sql('alter table public.rabota_orders rename column payment_amount to amount_drift');
 try{assert.throws(()=>apply('sql/000-preflight.sql'),e=>String(e.stderr).includes('Column drift'));}
 finally{sql('alter table public.rabota_orders rename column amount_drift to payment_amount');}
});
const hashes=()=>sql(`select string_agg(table_name||':'||digest,',' order by table_name) from (
 ${['rabota_orders','rabota_leads','rabota_members','rabota_cash_collections','rabota_finance_operations'].map(t=>`select '${t}' table_name,md5(coalesce(jsonb_agg(to_jsonb(t)-'request_id' order by to_jsonb(t)::text)::text,'[]')) digest from public.${t} t`).join(' union all ')}
) x`);
test('002 changes schema only; empty request_id is the only additional row field',()=>{
 const before=hashes();apply('sql/002-reliability.sql');
 // Remove the added nullable metadata column from comparison, without changing stored rows.
 const without=sql(`select count(*) from public.rabota_finance_operations where request_id is not null`);
 assert.equal(without,'0');assert.equal(hashes(),before);
});
test('003 closes old finance RPC while v2 still works and replays one operation',()=>{
 apply('sql/003-client-cutover.sql');
 denied(act(owner,"select public.rabota_finance_record('expense',100,null,'Тест')"),/permission denied/);
 const call="select public.rabota_finance_record_v2('40000000-0000-4000-8000-000000000001','expense',100,null,'Тест');";
 assert.ok(run(act(owner,call+call+'select count(*) from public.rabota_finance_operations')).endsWith('2'));
 for(const user of [manager,master,stranger,inactive])denied(act(user,call),/Только владелец/);
});
test('old tabs cannot insert/update orders, new versioned writes work',()=>{
 const update=`update public.rabota_orders set details='Правка' where id='${id}';`;
 denied(act(owner,update),/устарела/);
 denied(act(owner,update,{'x-rabota-client':'2'}),/Нет версии/);
 const version=sql(`select updated_at from public.rabota_orders where id='${id}'`);
 const headers={'x-rabota-client':'2','x-rabota-order-version':version};
 assert.ok(run(act(owner,update+'select details from public.rabota_orders',headers)).endsWith('Правка'));
 denied(act(owner,update,{'x-rabota-client':'2','x-rabota-order-version':'2000-01-01T00:00:00Z'}),/другом устройстве/);
 const insert="insert into public.rabota_orders(name) values ('Новый заказ');";
 denied(act(owner,insert),/устарела/);
 assert.ok(run(act(owner,insert+'select count(*) from public.rabota_orders',{'x-rabota-client':'2'})).endsWith('2'));
 assert.ok(run(act(master,pay)).includes('"ok": true'),'legitimate SECURITY DEFINER payment bypasses REST version header gate');
});
test('stale version remains rejected after another committed edit',()=>{
 const version=sql(`select updated_at from public.rabota_orders where id='${id}'`);
 sql(`update public.rabota_orders set details='Новее' where id='${id}'`);
 denied(act(owner,`update public.rabota_orders set details='Старая форма' where id='${id}'`,{'x-rabota-client':'2','x-rabota-order-version':version}),/другом устройстве/);
});
test('safe rollback retains C1, idempotency and obsolete-client blockade',()=>{
 const before=hashes();apply('sql/rollback-readonly.sql');assert.equal(hashes(),before);
 denied(act(stranger,pay),/Нет прав/);
 denied(act(owner,"select public.rabota_finance_record('expense',1,null,'Тест')"),/permission denied/);
 denied(act(owner,`update public.rabota_orders set details='Старая' where id='${id}'`),/только для чтения/);
 denied(act(owner,"select public.rabota_finance_record_v2('40000000-0000-4000-8000-000000000099','expense',1,null,'Тест')"),/только для чтения/);
 // Return to the intended release state for backup/restore rehearsal.
 apply('sql/resume-reviewed-release.sql');
});
test('logical archive restores row fingerprints, RLS, RPC guards and retry keys',()=>{
 const req='40000000-0000-4000-8000-000000000009';
 sql(`begin;${act(owner,`select public.rabota_finance_record_v2('${req}','expense',77,null,'Тест архива')`)};commit;`);
 const fingerprintQuery=`select string_agg(table_name||':'||digest,',' order by table_name) from (${['rabota_orders','rabota_leads','rabota_members','rabota_cash_collections','rabota_finance_operations'].map(t=>`select '${t}' table_name,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) digest from public.${t} t`).join(' union all ')}) x`;
 const before=sql(fingerprintQuery);
 const dir=fs.mkdtempSync('/tmp/rabota-restore-');
 execFileSync('bash',['scripts/backup-db.sh',dir],{env:{...process.env,RABOTA_BACKUP_ACK:'READ_ONLY'},stdio:'pipe'});
 try{execFileSync('dropdb',['--if-exists','rabota_restore'],{stdio:'pipe'});execFileSync('createdb',['rabota_restore']);
 execFileSync('bash',['scripts/restore-local.sh',dir],{env:{...process.env,PGDATABASE:'rabota_restore'},stdio:'pipe'});
 const restored=s=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGDATABASE:'rabota_restore'},input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 // Exact per-row content, not just counts, is compared for core business tables.
 assert.equal(restored(fingerprintQuery),before);
 assert.equal(restored("select count(*) from pg_tables where schemaname='public' and tablename like 'rabota_%' and rowsecurity"),'10');
 assert.equal(restored(`select count(*) from public.rabota_finance_operations where request_id='${req}'`),'1');
 assert.throws(()=>restored('begin;'+act(stranger,pay)),e=>String(e.stderr).includes('Нет прав'));
 assert.equal(restored("select has_function_privilege('authenticated','public.rabota_finance_record(text,numeric,uuid,text)','execute')"),'f');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
