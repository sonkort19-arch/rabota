'use strict';
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
if(process.env.RABOTA_DISPOSABLE_DB!=='YES'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='rabota_audit')
 throw Error('Refusing non-disposable/non-local database');
const fixed=process.env.AUDIT_FIXED==='1';
const sql=s=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
sql('drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists private cascade; create schema public;');
sql(fs.readFileSync('tests/audit/baseline.sql','utf8'));
if(fixed)sql(fs.readFileSync('sql/audit-reliability-fixes.sql','utf8'));
const owner='10000000-0000-4000-8000-000000000001',master='10000000-0000-4000-8000-000000000002',
 stranger='10000000-0000-4000-8000-000000000003',other='10000000-0000-4000-8000-000000000004';
const seed=`
insert into auth.users(id) values ('${owner}'),('${master}'),('${stranger}'),('${other}') on conflict do nothing;
insert into public.rabota_members(user_id,role,master_name) values
 ('${owner}','owner',''),('${master}','master','Рауль'),('${other}','master','Другой') on conflict do nothing;
select set_config('request.jwt.claim.sub','${owner}',true);
`;
const order=(id,extra='')=>`insert into public.rabota_orders(id,name,phone,master,status,appointment_date,appointment_time,price ${extra}) values ('${id}','Синтетический клиент','79990000001','Рауль','В работе',current_date+7,'10:00',20000`;
function run(body){return sql('begin;'+seed+body+';rollback;')}
const id='20000000-0000-4000-8000-000000000001';
function rejected(body,pattern){assert.throws(()=>run(body),e=>pattern.test(String(e.stderr)),pattern.toString())}
test((fixed?'FIXED':'BASELINE')+': unassigned authenticated user cannot pay another order',()=>{
 const body=order(id)+`);set local role authenticated;select set_config('request.jwt.claim.sub','${stranger}',true);
 select public.rabota_record_order_payment('${id}',20000,'cash')`;
 if(fixed)rejected(body,/Нет прав/);
 else assert.ok(run(body).includes('"ok": true'),'baseline confirms NULL role bypass');
});
test('active owner can pay; paid order cannot be paid twice',()=>{
 const body=order(id)+`);set local role authenticated;select public.rabota_record_order_payment('${id}',20000,'card');`;
 assert.ok(run(body).includes('"receiver": "company"'));
 rejected(body+`select public.rabota_record_order_payment('${id}',20000,'cash')`,/уже оплачен/);
});
test('paid financial snapshot is immutable, nonfinancial notes remain editable',()=>{
 const body=order(id)+`);select public.rabota_record_order_payment('${id}',20000,'card');`;
 if(fixed)rejected(body+`update public.rabota_orders set price=40000 where id='${id}'`,/защищены/);
 else assert.ok(run(body+`update public.rabota_orders set price=40000 where id='${id}';select price from public.rabota_orders`).endsWith('40000.00'));
 assert.ok(run(body+`update public.rabota_orders set details='Исправлен адрес подъезда' where id='${id}';select details from public.rabota_orders`).endsWith('Исправлен адрес подъезда'));
});
test('manual then automatic payout cannot pay the same earned balance twice',()=>{
 const body=order(id)+`);select set_config('request.jwt.claim.sub','${master}',true);
 select public.rabota_record_order_payment('${id}',20000,'cash');
 select set_config('request.jwt.claim.sub','${owner}',true);
 select public.rabota_finance_record('raul_payout',10000,'${master}','Тест');
 select set_config('request.jwt.claim.sub','${master}',true);
 select public.rabota_cash_distribute('${id}')`;
 if(fixed)rejected(body,/переплате/);else assert.ok(run(body).includes('"raul": 10000.00'));
});
test('cash split conserves gross, duplicate distribution and confirmation are rejected',()=>{
 const body=order(id)+`);select set_config('request.jwt.claim.sub','${master}',true);
 select public.rabota_cash_distribute('${id}');`;
 assert.ok(run(body+`select gross=raul_amount+timur_amount+company_amount from public.rabota_cash_collections`).endsWith('t'));
 rejected(body+`select public.rabota_cash_distribute('${id}')`,/уже записано/);
 const submitted=body+`select public.rabota_cash_submit('${id}');select set_config('request.jwt.claim.sub','${owner}',true);select public.rabota_cash_confirm('${id}');`;
 assert.ok(run(submitted).endsWith('t'));
 rejected(submitted+`select public.rabota_cash_confirm('${id}')`,/не найдена/);
});
test('one lead cannot create two live orders at different times',()=>{
 const lead='30000000-0000-4000-8000-000000000001';
 const body=`insert into public.rabota_leads(id,name,phone,phone_normalized,status)
 values ('${lead}','Тестовый лид','79990000001','79990000001','ready');
 `+order(id,',lead_id')+`,'${lead}');
 insert into public.rabota_orders(name,phone,master,status,appointment_date,appointment_time,lead_id)
 values ('Второй заказ','79990000001','Рауль','Записан',current_date+8,'15:00','${lead}');`;
 if(fixed)rejected(body,/уже создан заказ|rabota_orders_one_active_order_per_lead/);else assert.ok(run(body+'select count(*) from public.rabota_orders').endsWith('2'));
});
test('AI can prepare and confirm a different master at the same time',()=>{
 const query=order(id)+`);
 select public.rabota_ai_confirm_order_v2((public.rabota_ai_prepare_order_v2(
 'create','Новый клиент',(current_date+7)::text,'10:00','Другой','79990000002')->>'draft_id')::uuid)`;
 if(fixed)assert.ok(run(query).includes('"ok": true'));else rejected(query,/уже есть запись/);
});
test('daily capacity rejects third job but cancellation releases a slot',()=>{
 const body=order(id)+`);insert into public.rabota_orders(name,master,appointment_date,appointment_time)
 values ('Второй','Рауль',current_date+7,'15:00');`;
 rejected(body+`insert into public.rabota_orders(name,master,appointment_date,appointment_time)
 values ('Третий','Рауль',current_date+7,'19:00')`,/уже два заказа/);
 assert.ok(run(body+`update public.rabota_orders set status='Отменён' where id='${id}';
 insert into public.rabota_orders(name,master,appointment_date,appointment_time) values ('Замена','Рауль',current_date+7,'10:00');
 select count(*) from public.rabota_orders where status<>'Отменён'`).endsWith('2'));
});
test('retry key returns original finance operation, mismatched payload rejected',()=>{
 const request='40000000-0000-4000-8000-000000000001';
 if(!fixed){
   assert.ok(run(`select public.rabota_finance_record('expense',100,null,'Тест');
    select public.rabota_finance_record('expense',100,null,'Тест');select count(*) from public.rabota_finance_operations`).endsWith('2'));return;
 }
 const call=`select public.rabota_finance_record_v2('${request}','expense',100,null,'Тест');`;
 assert.ok(run(call+call+'select count(*) from public.rabota_finance_operations').endsWith('1'));
 rejected(call+`select public.rabota_finance_record_v2('${request}','expense',101,null,'Тест')`,/другими данными/);
});

test('RLS hides orders and finance from unrelated authenticated users',()=>{
 const body=order(id)+`);set local role authenticated;
 select set_config('request.jwt.claim.sub','${stranger}',true);
 select count(*) from public.rabota_orders;`;
 assert.ok(run(body).endsWith('0'));
 assert.ok(run(body+'select count(*) from public.rabota_finance_operations').endsWith('0'));
});
test('RLS assigned master reads own orders but cannot directly change them',()=>{
 const body=order(id)+`);set local role authenticated;
 select set_config('request.jwt.claim.sub','${master}',true);`;
 assert.ok(run(body+'select count(*) from public.rabota_orders').endsWith('1'));
 assert.ok(run(body+`update public.rabota_orders set price=1 returning id;select price from public.rabota_orders`).endsWith('20000.00'));
});
test('two concurrent identical finance requests produce one row',async t=>{
 if(!fixed){t.skip('v2 is added by the patch');return}
 const {execFile}=require('node:child_process'),{promisify}=require('node:util'),exec=promisify(execFile);
 // All these writes stay inside the disposable localhost database.
 sql('begin;'+seed+'commit;');
 const req='40000000-0000-4000-8000-000000000002';
 const query=`begin;select set_config('request.jwt.claim.sub','${owner}',true);
 select public.rabota_finance_record_v2('${req}','expense',123,null,'Параллельный тест');commit;`;
 const results=await Promise.all([1,2].map(()=>exec('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-c',query])));
 assert.equal(results[0].stdout.trim(),results[1].stdout.trim());
 assert.equal(sql(`select count(*) from public.rabota_finance_operations where request_id='${req}'`),'1');
});
