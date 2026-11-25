"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const alignment=[
  "ui-alignment.css",
  "ui-alignment-orders.css",
  "ui-alignment-home-calendar.css",
  "ui-alignment-mobile.css"
];
const master=[
  "master-dense.css",
  "master-dense-enhancements.css"
];
const gitBlobSha=value=>{
  const payload=Buffer.from(value,"utf8");
  return crypto.createHash("sha1")
    .update(Buffer.from("blob "+payload.length+"\0","utf8"))
    .update(payload).digest("hex");
};
function validCssBoundary(text){
  let depth=0,quote=null,comment=false,escaped=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],next=text[i+1];
    if(comment){if(c==="*"&&next==="/"){comment=false;i++}continue}
    if(quote){
      if(escaped){escaped=false;continue}
      if(c==="\\"){escaped=true;continue}
      if(c===quote)quote=null;
      continue;
    }
    if(c==="/"&&next==="*"){comment=true;i++;continue}
    if(c==="'"||c==='"'){quote=c;continue}
    if(c==="{")depth++;
    else if(c==="}")depth--;
    if(depth<0)return false;
  }
  return depth===0&&quote===null&&!comment;
}
test("ui-alignment: only the legacy staff rule narrows to the orders section",()=>{
  const css=alignment.map(read).join("");
  const scopedRule="#ordersArea > #teamPanel { display: none !important; }";
  assert.ok(css.includes(scopedRule));
  assert.doesNotMatch(css,/^#teamPanel\s*\{\s*display:\s*none/m);
  assert.equal(
    gitBlobSha(css.replace(scopedRule,"#teamPanel { display: none !important; }")),
    "1669695e03aaf519514fa89a054a39c897fa6eef"
  );
});
test("master-dense: preserves accepted CSS before the unified workspace",()=>{
  // Accepted main baseline 8710b5e; the unified workspace adds a separate
  // stylesheet and must not change these existing master/finance rules.
  assert.equal(
    gitBlobSha(master.map(read).join("")),
    "c13c2c1ecf5909f83a7718238b2487f28ababd61"
  );
});
test("no file cuts a CSS block, comment, or string",()=>{
  for(const css of [...alignment,...master]){
    assert.equal(validCssBoundary(read(css)),true,css);
  }
});
test("all six CSS parts are nonempty, named for their function",()=>{
  for(const css of [...alignment,...master]){
    assert.ok(read(css).length>1000,css);
  }
});
test("new CSS parts have no imports that could alter relative cascade",()=>{
  for(const css of [...alignment,...master]){
    assert.doesNotMatch(read(css),/@import\b/i,css);
  }
});
test("HTML links CSS parts adjacently and preserves downstream precedence",()=>{
  const html=read("index.html");
  const files=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\/[^"]+\.css(?:\?[^"]*)?)"/g)]
    .map(match=>match[1].split("?")[0].slice(1));
  assert.equal(files.length,35,"baseline styles, integrated modules, rescheduling and the shared screen layout");
  assert.equal(new Set(files).size,files.length,"each stylesheet is loaded once");
  const start=files.indexOf("ui-alignment.css");
  assert.deepEqual(files.slice(start,start+4),alignment);
  assert.equal(files[start+4],"master-dashboard.css");
  const masterStart=files.indexOf("master-dense.css");
  assert.deepEqual(files.slice(masterStart,masterStart+2),master);
  assert.deepEqual(files.slice(masterStart+2,masterStart+4),[
    "master-completed-day.css","money-workspace.css"
  ]);
  assert.deepEqual(files.slice(-4),["expenses.css","growth.css","orders-workspace.css","app-shell.css"],
    "shared screen layout follows module and orders styles");
  assert.equal(validCssBoundary(read("app-shell.css")),true);
  for(const file of files)assert.ok(fs.existsSync(path.join(root,file)),file);
});
test("core JS modules and PWA remain wired without behavior changes",()=>{
  const html=read("index.html");
  for(const js of ["order-model.js","calendar-model.js","finance-model.js",
    "master-ui.js","lead-ai-bridge.js"]){
    assert.ok(html.includes('src="/'+js+'?'),js);
  }
  const script=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(script));
});
