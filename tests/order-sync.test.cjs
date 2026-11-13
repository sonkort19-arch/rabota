"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createOrderSync}=require("../order-sync.js");

const rows=[
  {id:"order-a",updated_at:"2026-11-13T09:00:00Z"},
  {id:"order-b",updated_at:"2026-11-13T10:00:00Z"}
];
function make(now=()=>1000000){return createOrderSync({now,reconcileMs:300000});}

test("first load must fetch complete orders",async()=>{
  const checker=make();
  assert.equal(await checker.isUnchanged(()=>{throw Error("unexpected header fetch");}),false);
});
test("unchanged headers skip complete order download",async()=>{
  const checker=make();checker.rememberFull(rows);
  assert.equal(await checker.isUnchanged(()=>rows.slice().reverse()),true);
});
test("updated order requires complete download",async()=>{
  const checker=make();checker.rememberFull(rows);
  assert.equal(await checker.isUnchanged(()=>[
    {...rows[0],updated_at:"2026-11-13T11:00:00Z"},rows[1]
  ]),false);
});
test("new order requires complete download",async()=>{
  const checker=make();checker.rememberFull(rows);
  assert.equal(await checker.isUnchanged(()=>[...rows,{id:"order-c",updated_at:"new"}]),false);
});
test("deleted order requires complete download",async()=>{
  const checker=make();checker.rememberFull(rows);
  assert.equal(await checker.isUnchanged(()=>rows.slice(1)),false);
});
test("after five minutes force full reconcile even if timestamps are stale",async()=>{
  let timestamp=1000000;
  const checker=make(()=>timestamp);checker.rememberFull(rows);
  timestamp+=300000;
  assert.equal(await checker.isUnchanged(()=>{throw Error("should not query headers");}),false);
});
test("logout clears the saved fingerprint",async()=>{
  const checker=make();checker.rememberFull(rows);checker.reset();
  assert.equal(await checker.isUnchanged(()=>{throw Error("should not query headers");}),false);
});
test("headers are paginated and a 1000-row boundary is handled",async()=>{
  const large=Array.from({length:1001},(_,i)=>({id:"id-"+i,updated_at:"v1"}));
  const checker=make();checker.rememberFull(large);
  const offsets=[];
  assert.equal(await checker.isUnchanged((offset,limit)=>{
    offsets.push(offset);return large.slice(offset,offset+limit);
  }),true);
  assert.deepEqual(offsets,[0,1000]);
});
test("invalid metadata response cannot be treated as unchanged",async()=>{
  const checker=make();checker.rememberFull(rows);
  await assert.rejects(checker.isUnchanged(()=>null),/Не удалось проверить/);
});
test("index.html wires background reads without weakening deliberate full refresh",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/order-sync\.js\?v=20261113-stage2"/);
  assert.match(html,/select=id,updated_at&order=id\.asc/);
  assert.match(html,/async function reloadOrders\(\{background=false\}=\{\}\)/);
  assert.match(html,/await reloadOrders\(\);/); // user-initiated full refresh
  assert.equal((html.match(/await reloadOrders\(\{background:true\}\)/g)||[]).length,2);
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline,"inline app script is present");
  assert.doesNotThrow(()=>new Function(inline[1]));
});
