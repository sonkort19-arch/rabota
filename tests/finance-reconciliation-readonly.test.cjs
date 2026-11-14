"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const sql=fs.readFileSync(path.join(__dirname,"..","qa","finance_reconciliation_readonly.sql"),"utf8");
const withoutComments=sql.replace(/--[^\n]*/g,"");
test("audit runs as explicit read-only repeatable-read transaction",()=>{
 assert.match(withoutComments,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/i);
 assert.match(withoutComments,/ROLLBACK;\s*$/i);
});
test("audit contains SELECT-only SQL and no write-capable statements",()=>{
 assert.doesNotMatch(withoutComments,/\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|COPY|CALL|GRANT|REVOKE|DO|EXECUTE|VACUUM|ANALYZE|REFRESH|SET|RESET)\b/i);
 assert.match(withoutComments,/^\s*BEGIN TRANSACTION /);
 assert.equal((withoutComments.match(/\bSELECT\b/gi)||[]).length>3,true);
});
test("query never returns client identity, details, or full IDs",()=>{
 assert.doesNotMatch(withoutComments,/\bo\.(?:name|phone|address|details|created_by|lead_id)\b/i);
 assert.match(withoutComments,/right\(o\.id::text,8\)/i);
 assert.doesNotMatch(withoutComments,/\bSELECT\s+\*/i);
});
test("covers missing ledger, master cash, old payments, and owner confirmation",()=>{
 for(const column of [
 "legacy_paid","master_no_collection","collection_no_automatic_ledger",
 "awaiting_owner","cashbook_entries","manual_payouts","raul_recorded_due",
 "timur_recorded_due"
 ])assert.ok(sql.includes(column),column);
});
test("never creates or amends missing historic ledger entries",()=>{
 assert.doesNotMatch(withoutComments,/set_config\(|pg_sleep\(|dblink\(|http_/i);
 assert.doesNotMatch(withoutComments,/\/\*.*?\*\//s);
});
