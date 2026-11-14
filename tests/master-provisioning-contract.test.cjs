"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=x=>fs.readFileSync(path.join(root,x),"utf8");
const sql=read("sql/010-master-provisioning-paid-order-compat.sql");
const fixture=read("tests/sql/master-provisioning-fixture.sql");
const scenario=read("tests/sql/master-provisioning-scenarios.sql");
test("master provisioning compatibility is fail closed and transactional",()=>{
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/COMMIT;\s*$/);
 assert.match(sql,/Master provisioning source drift/);
 assert.match(sql,/Paid order guard from SQL 008 is required/);
 assert.ok((sql.match(/paid is not true/gi)||[]).length>=2);
 assert.match(sql,/o\.paid is true/);
 assert.match(sql,/rabota_cash_collections/);
 assert.match(sql,/owner \/ SECURITY DEFINER drift/);
});
test("synthetic master tests cover owner, manager, legacy and regular workflows",()=>{
 const all=sql+fixture+scenario;
 assert.doesNotMatch(all,/yedzfmibceboncrytbqz|DATABASE_URL=|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
 for(const phrase of ["manager provisioned master","paid Raul history reassigned","normal unpaid approval broken","normal unpaid provision broken","historic paid order changed"]){
  assert.ok(scenario.includes(phrase),phrase);
 }
});
