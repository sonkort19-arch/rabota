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
function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

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
  assert.match(html,/src="\/order-sync\.js\?v=20261124-stable-reads"/);
  assert.match(html,/select=id,updated_at&order=id\.asc/);
  assert.match(html,/select=\*&order=created_at\.desc,id\.desc&limit=/);
  assert.match(html,/async function reloadOrders\(\{background=false\}=\{\}\)/);
  assert.match(html,/await reloadOrders\(\);/); // user-initiated full refresh
  assert.equal((html.match(/reloadOrders\(\{background:true\}\)/g)||[]).length,1);
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline,"inline app script is present");
  assert.doesNotThrow(()=>new Function(inline[1]));
});

test("parallel background reads share one request and wait for a newer foreground read",async()=>{
  const sync=make(),result=deferred(),started=deferred(),published=[];
  const background=sync.runRead(true,async isCurrent=>{
    started.resolve();
    const previous=await result.promise;
    if(isCurrent())published.push(previous);
    return previous;
  });
  assert.equal(sync.runRead(true,()=>assert.fail("parallel poll")),background);
  await started.promise;
  const foreground=sync.runRead(false,isCurrent=>{
    if(isCurrent())published.push("after write");
    return "after write";
  });
  assert.equal(await foreground,"after write");
  result.resolve("previous");
  assert.equal(await background,"after write");
  assert.deepEqual(published,["after write"]);
});

test("reset invalidates an in-flight read without joining another account",async()=>{
  const sync=make(),result=deferred(),started=deferred();
  const old=sync.runRead(false,async isCurrent=>{
    started.resolve();
    await result.promise;
    assert.equal(isCurrent(),false);
    return "old account";
  });
  await started.promise;
  sync.reset();
  const next=sync.runRead(false,()=>"new account");
  result.resolve();
  assert.equal(await old,undefined);
  assert.equal(await next,"new account");
});

test("a full read checks every page and refuses a duplicated order",async()=>{
  const sync=make(),page=Array.from({length:1000},(_,i)=>({id:"id-"+i}));
  const offsets=[];
  await assert.rejects(sync.readFull((offset,limit)=>{
    offsets.push([offset,limit]);
    return offset===0?page:[page.at(-1)];
  }),/Список заказов изменился/);
  assert.deepEqual(offsets,[[0,1000],[1000,1000]]);
});

test("a complete full result at the supported limit does not silently truncate",async()=>{
  const sync=make(),read=(offset,limit)=>
    Array.from({length:Math.min(limit,100000-offset)},(_,i)=>({id:"id-"+(offset+i)}));
  assert.equal((await sync.readFull(read)).length,100000);
  await assert.rejects(sync.readFull((offset,limit)=>
    offset===100000?[{id:"overflow"}]:read(offset,limit)),/Превышен предел/);
});


test("exact 1000-row page requests the next page before trusting unchanged data",async()=>{
  const large=Array.from({length:1000},(_,i)=>({id:"id-"+i,updated_at:"v1"}));
  const checker=make();checker.rememberFull(large);
  const offsets=[];
  assert.equal(await checker.isUnchanged((offset,limit)=>{
    offsets.push(offset);return large.slice(offset,offset+limit);
  }),true);
  assert.deepEqual(offsets,[0,1000]);
});
test("order reordering does not cause unnecessary full refresh",async()=>{
  const checker=make();checker.rememberFull(rows);
  assert.equal(await checker.isUnchanged(()=>rows.slice().reverse()),true);
});
test("clock moving backwards forces full refresh without reading headers",async()=>{
  let clock=1000000;
  const checker=make(()=>clock);checker.rememberFull(rows);
  clock-=1000;
  assert.equal(await checker.isUnchanged(()=>{throw Error("unexpected headers");}),false);
});
test("network failure never becomes a false unchanged result",async()=>{
  const checker=make();checker.rememberFull(rows);
  await assert.rejects(checker.isUnchanged(()=>Promise.reject(new Error("network offline"))),/network offline/);
});
test("duplicate or removed metadata ID forces complete refresh",async()=>{
  const checker=make();checker.rememberFull(rows);
  assert.equal(await checker.isUnchanged(()=>[
    rows[0],{id:rows[0].id,updated_at:rows[1].updated_at}
  ]),false);
});
test("large collection over maximum metadata scan is never trusted as unchanged",async()=>{
  const large=Array.from({length:100001},(_,i)=>({id:"id-"+i,updated_at:"v1"}));
  const checker=make();checker.rememberFull(large);
  const offsets=[];
  assert.equal(await checker.isUnchanged((offset,limit)=>{
    offsets.push(offset);return large.slice(offset,offset+limit);
  }),false);
  assert.equal(offsets.length,100);
  assert.equal(offsets.at(-1),99000);
});
