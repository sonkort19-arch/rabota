"use strict";
// Static review checks; integration scenarios run in isolated PostgreSQL 17 CI.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const sql=fs.readFileSync(path.join(__dirname,"..","sql","008-protect-paid-orders.sql"),"utf8");
const fixture=fs.readFileSync(path.join(__dirname,"sql","paid-guard-fixture.sql"),"utf8");
const scenarios=fs.readFileSync(path.join(__dirname,"sql","paid-guard-scenarios.sql"),"utf8");

test("migration is transactional and has short lock/statement limits",()=>{
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/SET LOCAL lock_timeout\s*=\s*'5s'/);
 assert.match(sql,/SET LOCAL statement_timeout\s*=\s*'30s'/);
 assert.match(sql,/COMMIT;\s*$/);
});
test("the paid guard blocks direct INSERT, UPDATE and DELETE",()=>{
 for(const op of ["INSERT","UPDATE","DELETE"]){
   if(op!=="UPDATE")assert.match(sql,new RegExp("IF TG_OP = '"+op+"'"));
 }
 assert.match(sql,/BEFORE INSERT OR UPDATE OR DELETE ON public\.rabota_orders/);
 assert.match(sql,/NEW\.paid IS TRUE/);
 assert.match(sql,/NEW\.payment_amount IS NOT NULL/);
 assert.match(sql,/Прямое изменение оплаты запрещено/);
});
test("payment/cash RPCs must set and clear transaction-local scoped intent",()=>{
 for(const intent of ["payment:","cash:"])assert.match(sql,new RegExp("'"+intent+"'\\|\\|p_order_id::text"));
 const occurrences=sql.match(/set_config\('rabota\.order_payment_intent'/g)||[];
 assert.equal(occurrences.length,4);
 assert.match(sql,/current_user = v_payment_owner/);
 assert.match(sql,/current_user = v_cash_owner/);
 assert.match(sql,/v_actor := \(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/v_role := \(SELECT private\.rabota_my_role\(\)\)/);
});
test("original RPC role, cash and double-payment safeguards remain",()=>{
 for(const needle of [
  "Заказ уже оплачен","Нет прав для оплаты заказа",
  "Мастер может завершить только принятый в работу заказ",
  "Распределение уже записано","Заказ не назначен этому мастеру",
  "Доступ к распределению не предоставлен",
  "v_order.payment_method is distinct from 'cash'",
  "v_order.payment_received_by is distinct from 'master'"
 ]) assert.ok(sql.includes(needle),needle);
 assert.match(sql,/CREATE OR REPLACE FUNCTION private\.rabota_paid_order_guard/);
 assert.doesNotMatch(sql,/INSERT INTO public\.rabota_orders/i);
});
test("abort before writes when audited RPC code or original cash guard drift",()=>{
 assert.match(sql,/Rabota financial RPC changed since audit/);
 assert.match(sql,/d44bada20981d77a9922fe28f383ab10/);
 assert.match(sql,/75dbf74b2e70cfc6d3b73012ae66baaf/);
 assert.match(sql,/Original cash guard missing or disabled/);
 assert.match(sql,/Paid guard already exists/);
 assert.match(sql,/Expected PostgreSQL 17/);
});
test("no data writes, weakening RLS or unrelated table changes in migration",()=>{
 assert.doesNotMatch(sql,/\bDELETE FROM\s+public\.rabota_orders\b/i);
 assert.doesNotMatch(sql,/\bDROP\s+(?:TABLE|TRIGGER|POLICY|FUNCTION)\b/i);
 assert.doesNotMatch(sql,/\bDISABLE\s+(?:TRIGGER|ROW LEVEL SECURITY)\b/i);
 assert.doesNotMatch(sql,/\bALTER\s+TABLE\s+public\.(?!rabota_orders)/i);
});
test("already-paid rows are immutable except cash RPC and updated_at",()=>{
 assert.match(sql,/OLD\.paid IS TRUE/);
 assert.match(sql,/v_structural_same/);
 assert.match(sql,/v_cash_allowed/);
 assert.match(sql,/NEW\.status = 'Выполнен'/);
 assert.match(sql,/OLD\.payment_method = 'cash'/);
 assert.match(sql,/OLD\.payment_received_by = 'master'/);
 assert.match(sql,/NEW\.price IS NOT DISTINCT FROM OLD\.price/);
});
test("real PostgreSQL tests include owner manager Raul legacy and anonymous",()=>{
 for(const expected of [
  "direct paid INSERT accepted","direct paid UPDATE accepted",
  "manager direct paid=true accepted","normal unpaid edit",
  "legitimate payment RPC","duplicate payment permitted",
  "cash distribution order update","legacy partial master cash completion",
  "fabricated legacy cash distribution accepted",
  "master paid another master order","anon payment accepted",
  "paid order deleted"
 ])assert.ok(scenarios.includes(expected),expected);
 assert.match(fixture,/CREATE TABLE public\.rabota_orders/);
 assert.match(fixture,/ALTER TABLE public\.rabota_orders ENABLE ROW LEVEL SECURITY/);
});
