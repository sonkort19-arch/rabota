"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const get=x=>fs.readFileSync(path.join(root,x),"utf8");

const shell=get("tests/step05-backup-restore.sh");
const seed=get("tests/sql/step05-backup-seed.sql");
const fp=get("tests/sql/step05-restore-fingerprint.sql");
const checks=get("tests/sql/step05-restored-security.sql");

test("backup script can run only on disposable local CI Postgres",()=>{
 for(const name of ["CI","PGHOST","PGPORT","PGUSER","PGDATABASE","PGPASSWORD"])
   assert.ok(shell.includes("$"+name),name);
 assert.match(shell,/REFUSED: backup\/restore drill is restricted to disposable CI PostgreSQL/);
 assert.match(shell,/PGHOST.*127\.0\.0\.1/);
 assert.doesNotMatch(shell,/db\.[a-z0-9]+\.supabase\.co|yedzfmibceboncrytbqz/);
});
test("backup is a verified custom format archive and not a git artifact",()=>{
 assert.match(shell,/pg_dump --format=custom/);
 assert.match(shell,/sha256sum --check/);
 assert.match(shell,/pg_restore --list/);
 assert.match(shell,/pg_restore --exit-on-error --single-transaction/);
 assert.match(shell,/trap 'rm -rf "\$WORK"' EXIT/);
 assert.doesNotMatch(shell,/actions\/upload-artifact|git add|curl|scp|rsync/);
});
test("restore writes only to a distinct disposable test database",()=>{
 assert.match(shell,/RESTORE_DB="rabota_stage5_restored"/);
 assert.match(shell,/createdb "\$RESTORE_DB"/);
 assert.ok(shell.includes('--dbname="$RESTORE_DB"'));
 assert.match(shell,/--dbname="\$PGDATABASE"/);
 assert.match(shell,/diff -u "\$WORK\/before\.fingerprint" "\$WORK\/after\.fingerprint"/);
});
test("fingerprint covers rows, RLS, policy, trigger and function definitions",()=>{
 for(const name of ["rabota_members","rabota_orders","rabota_cash_collections",
    "rabota_finance_operations","rabota_cashbook_entries",
    "pg_policies","pg_trigger","pg_get_functiondef","relrowsecurity"]){
   assert.ok(fp.includes(name),name);
 }
 assert.doesNotMatch(fp,/\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|TRUNCATE|CREATE)\s+(?:TABLE|INTO|FROM|FUNCTION)\b/i);
});
test("backup seed contains only synthetic customers and payments",()=>{
 assert.match(seed,/Synthetic backup payout/);
 assert.match(seed,/Synthetic data, ephemeral PostgreSQL 17 ONLY/);
 assert.match(seed,/rabota_record_order_payment/);
 assert.match(seed,/rabota_cash_distribute/);
 assert.match(seed,/rabota_salary_payout_v2/);
 assert.doesNotMatch(seed,/SUPABASE_SECRET_KEY|service_role|DATABASE_URL/);
});
test("restored guard still forbids direct paid edits and master salary payout",()=>{
 assert.match(checks,/rabota_paid_order_guard_trigger/);
 assert.match(checks,/rabota_cash_order_guard_trigger/);
 assert.match(checks,/relrowsecurity/);
 assert.match(checks,/restored paid order can be edited directly/);
 assert.match(checks,/Raul can self-record payout after restore/);
 assert.match(checks,/ROLLBACK;/);
});
