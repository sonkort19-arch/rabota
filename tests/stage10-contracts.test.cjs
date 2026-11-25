"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const html=read("index.html");
const beforeInline=html.indexOf("<script>\n");
const scripts=[...html.matchAll(/<script\s+src="(\/[^"]+\.js(?:\?[^"]*)?)"/g)].map(m=>m[1].split("?")[0].slice(1));
const modules=[
 "order-notes.js","order-sync.js","order-model.js","calendar-load.js","calendar-model.js",
 "finance-model.js","master-ui.js","lead-ai-bridge.js","app-services.js"
];
test("all extracted modules load before the main application",()=>{
  assert.ok(beforeInline>0);
  for(const name of modules){
    assert.ok(scripts.includes(name),name);
    assert.ok(html.indexOf('src="/'+name)<beforeInline,name);
    assert.ok(fs.existsSync(path.join(root,name)),name);
  }
  assert.deepEqual(scripts.slice(0,modules.length),modules);
});
test("all external JavaScript and stylesheets exist in the current branch",()=>{
  const css=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)]
    .map(m=>m[1].split("?")[0].slice(1));
  assert.ok(css.length>=20);
  for(const name of [...scripts,...css])assert.ok(fs.existsSync(path.join(root,name)),name);
});
test("standalone AI page and server endpoint still exist",()=>{
  assert.ok(fs.existsSync(path.join(root,"ai.html")));
  assert.ok(fs.existsSync(path.join(root,"api","ai-chat.js")));
  assert.match(read("ai.html"),/rabota_ai_prepare_order_v2/);
  assert.match(read("ai.html"),/rabota_ai_confirm_order_v2/);
  assert.match(read("api/ai-chat.js"),/\/v1\/responses/);
});
test("one order form, calendar and master summary remain wired",()=>{
  assert.equal((html.match(/id="orderForm"/g)||[]).length,1);
  assert.equal((html.match(/id="masterTodaySummary"/g)||[]).length,1);
  assert.equal((html.match(/id="calendarDate"/g)||[]).length,1);
  assert.equal((html.match(/id="formStatus"/g)||[]).length,1);
  assert.match(html,/window\.__rdOrderSync/);
  assert.match(html,/calendarModule\.renderCalendar\(\)/);
  assert.match(html,/function renderMasterSchedule\(rows,options\)\{return masterUI\.renderMasterSchedule\(rows,options\);\}/);
});
test("payment, refund and master actions use current server-side RPCs",()=>{
  const orders=read("order-model.js"),expenses=read("expenses.js");
  assert.match(orders,/dbRequest\("rpc\/rabota_record_order_payment","POST"/);
  assert.match(orders,/dbRequest\("rpc\/rabota_payroll_refund_v3","POST"/);
  assert.match(html,/dbRequest\("rpc\/rabota_master_action","POST"/);
  assert.match(html,/dbRequest\("rpc\/rabota_payroll_payout_v3","POST"/);
  assert.match(html,/dbRequest\("rpc\/rabota_cashbook_record_v1","POST"/);
  assert.match(expenses,/dbRequest\("rpc\/rabota_finance_void","POST"/);
  assert.doesNotMatch([html,orders,read("money-workspace.js")].join("\n"),
    /rpc\/rabota_(?:cash_distribute|cash_submit(?:_amount)?|cash_confirm(?:_amount)?|salary_payout_v2)/);
  const finance=read("finance-model.js");
  assert.match(finance,/dbRequest\("rpc\/rabota_payroll_snapshot_v3","GET"/);
  assert.doesNotMatch(finance,/fetch\(/);
});
test("public client never embeds secret role keys or dangerous runtime code",()=>{
  const frontend=[html,...modules.map(read),read("ai.html")].join("\n");
  assert.doesNotMatch(frontend,/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sk_(?:test|live)_[a-zA-Z0-9]+/);
  assert.doesNotMatch(frontend,/\beval\s*\(/);
});
test("service worker does not cache order JSON or payment data",()=>{
  const worker=read("sw.js");
  assert.doesNotMatch(worker,/caches\.open|CacheStorage|cache\.put/i);
  assert.match(worker,/addEventListener\("push"/);
});
test("lead preview and AI bridge are read-only until explicit confirmation",()=>{
  assert.match(read("lead-ai-bridge.js"),/preventPreviewSubmit/);
  assert.match(read("lead-ai-bridge.js"),/event\.preventDefault/);
  assert.match(read("ai.html"),/rabota_ai_confirm_order_v2/);
});
test("main application JavaScript and extracted modules parse",()=>{
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
  for(const name of modules)assert.doesNotThrow(()=>new Function(read(name)),name);
});
test("no SQL migration silently became part of the browser runtime",()=>{
  for(const file of scripts)assert.ok(!file.startsWith("sql/"),file);
  assert.ok(html.includes("rabota_orders"));
});
