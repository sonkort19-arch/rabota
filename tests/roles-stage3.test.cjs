"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const migration=fs.readFileSync(path.join(root,"sql","009-owner-only-salary-payout.sql"),"utf8");
const master=fs.readFileSync(path.join(root,"money-workspace.js"),"utf8");
const owner=fs.readFileSync(path.join(root,"finance-payroll.js"),"utf8");
const home=fs.readFileSync(path.join(root,"index.html"),"utf8");
const fixture=fs.readFileSync(path.join(__dirname,"sql","roles-stage3-fixture.sql"),"utf8");
const scenarios=fs.readFileSync(path.join(__dirname,"sql","roles-stage3-scenarios.sql"),"utf8");

test("salary migration has drift and privilege preflight, transaction limits",()=>{
 assert.match(migration,/^BEGIN;/m);
 assert.match(migration,/^COMMIT;/m);
 assert.match(migration,/SET LOCAL lock_timeout='5s'/);
 assert.match(migration,/SET LOCAL statement_timeout='30s'/);
 assert.match(migration,/ffedbdc596808059ab7601c6527f9c44/);
 assert.match(migration,/Salary payout RPC changed since audit/);
 assert.match(migration,/PostgreSQL 17 required/);
 assert.match(migration,/p\.prosecdef AND pg_catalog\.pg_get_userbyid\(p\.proowner\)='postgres'/);
});
test("salary RPC authorizes only authenticated active owner via private role",()=>{
 assert.match(migration,/v_actor uuid:=auth\.uid\(\)/);
 assert.match(migration,/v_role:=\(select private\.rabota_my_role\(\)\)/);
 assert.match(migration,/v_role is distinct from 'owner'/);
 assert.doesNotMatch(migration,/v_role not in \('owner','master'\)/);
 assert.doesNotMatch(migration,/if v_role='master'/);
 assert.match(migration,/v_master:=p_master_user_id;/);
 assert.match(migration,/ERRCODE/i);
});
test("owner payout retains lock, balance check, and idempotent request",()=>{
 for(const token of [
  "for update","request_id=p_request_id","v_existing.created_by<>v_actor",
  "v_accrued-v_paid<p_amount","v_existing.payment_method<>p_payment_method",
  "insert into public.rabota_finance_operations","v_paid",
  "p_kind not in ('raul_payout','timur_payout')",
  "p_amount<>round(p_amount,2)"
 ]) assert.ok(migration.toLowerCase().includes(token.toLowerCase()),token);
});
test("migration changes no existing order/finance rows and touches no other apps",()=>{
 assert.doesNotMatch(migration,/\bDELETE FROM\b|\bINSERT INTO\b\s+public\.rabota_orders/i);
 assert.doesNotMatch(migration,/\bALTER TABLE\b|\bDROP\b|\bTRUNCATE\b/i);
 assert.doesNotMatch(migration,/ma_wallet_|ma_transactions|service_role/i);
});
test("master salary UI remains readable but cannot trigger self-payout",()=>{
 assert.doesNotThrow(()=>new Function(master));
 assert.doesNotMatch(master,/openMasterPayout|mw-salary-payout|mw-wallet-action|Оформить выплату/);
 assert.match(master,/Выплату проводит владелец/);
 assert.match(master,/Моя зарплата/);
 assert.match(master,/Баланс к выплате/);
 assert.match(master,/Начисления/);
 assert.match(master,/Выплаты/);
});
test("owner payroll form and server RPC remain connected",()=>{
 assert.match(owner,/Подтвердить выплату/);
 assert.match(owner,/fp-balance-payout/);
 assert.match(home,/rpc\/rabota_salary_payout_v2/);
 assert.doesNotThrow(()=>new Function(owner));
});
test("synthetic PostgreSQL tests cover all roles and replay/overpayment",()=>{
 assert.match(fixture,/CREATE POLICY finance_salary_read/);
 for(const word of [
  "owner payout missing",
  "master can record self payout",
  "manager can record salary payout",
  "anonymous can post salary",
  "other master can view Raul payouts",
  "same request not idempotent",
  "duplicate rows for same request",
  "payout exceeded accrued amount",
  "master salary history not readable"
 ])assert.ok(scenarios.includes(word),word);
 assert.match(scenarios,/ROLLBACK;/);
});
