"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const html=read("index.html");
const money=read("money-workspace.js");
const finance=read("finance-payroll.js");
const guard=read("sql/008-protect-paid-orders.sql");
const salary=read("sql/009-owner-only-salary-payout.sql");

test("the combined branch includes the eight architecture modules",()=>{
 for(const file of ["order-notes.js","order-sync.js","order-model.js","calendar-model.js","finance-model.js",
 "master-ui.js","lead-ai-bridge.js","app-services.js"]){
   assert.ok(fs.existsSync(path.join(root,file)),file);
   assert.ok(html.includes('src="/'+file),file);
 }
 assert.doesNotThrow(()=>new Function(html.split("<script>\n").at(-1).split("</script>")[0]));
});
test("Raul's salary screen remains read-only in the modular frontend",()=>{
 assert.doesNotThrow(()=>new Function(money));
 assert.match(money,/Моя зарплата/);
 assert.match(money,/Баланс к выплате/);
 assert.match(money,/Выплату проводит владелец/);
 assert.doesNotMatch(money,/openMasterPayout|Оформить выплату/);
 assert.match(money,/Начисления/);
 assert.match(money,/Выплаты/);
});
test("the owner payout UI is present and still calls the server RPC",()=>{
 assert.match(finance,/fp-balance-payout/);
 assert.match(finance,/Подтвердить выплату/);
 assert.match(html,/rpc\/rabota_salary_payout_v2/);
});
test("financial guard enforces RPC transitions, not client role labels",()=>{
 assert.match(guard,/CREATE OR REPLACE TRIGGER rabota_paid_order_guard_trigger/);
 assert.match(guard,/BEFORE INSERT OR UPDATE OR DELETE/);
 assert.match(guard,/current_user = v_payment_owner/);
 assert.match(guard,/current_user = v_cash_owner/);
 assert.match(guard,/Rabota financial RPC changed since audit/);
 assert.match(guard,/Прямое изменение оплаты запрещено/);
});
test("role and salary guard is owner-only without losing balance checks",()=>{
 assert.match(salary,/v_role is distinct from 'owner'/);
 assert.match(salary,/v_accrued-v_paid<p_amount/);
 assert.match(salary,/for update/);
 assert.match(salary,/request_id=p_request_id/);
 assert.match(salary,/Salary payout RPC changed since audit/);
});
test("no production credentials or real customer records in stage-4 sources",()=>{
 const sources=[guard,salary,read("tests/sql/roles-stage3-scenarios.sql"),
  read("tests/sql/paid-guard-scenarios.sql"),read("tests/step04-concurrency.sh")].join("\n");
 assert.doesNotMatch(sources,/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL=|sk_live_/);
 assert.doesNotMatch(sources,/yedzfmibceboncrytbqz|dezszhnbblqufwvgvpmo/);
});
