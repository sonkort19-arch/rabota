/* Read-only source regression checks for the collapsible order date picker.
   Run: node tests/order-calendar-collapse.js */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const js=fs.readFileSync(path.join(root,"order-availability.js"),"utf8");
const css=fs.readFileSync(path.join(root,"order-availability.css"),"utf8");
assert.doesNotThrow(()=>new Function(js),"calendar JavaScript parses");
for(const id of ["oaToggle","oaCalendarBody","oaDayLoad","oaMonthGrid","oaToday","oaSlotSuggestions"]){
  assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,"unique "+id);
}
assert.match(html,/id="oaCalendarBody" class="oa-calendar-body" hidden/,"month grid starts folded");
assert.match(html,/aria-expanded="false" aria-controls="oaCalendarBody"/,"accessible toggle");
assert.match(js,/toggle.addEventListener\("click"/,"toggle is interactive");
assert.match(js,/setExpanded\(false\);\s*if\(document.activeElement/,"date selection folds calendar");
assert.match(js,/visible=true;\s*setMonthFromDate\(dayInput.value\);\s*setExpanded\(false\)/,"new form starts folded");
assert.match(js,/dayLoad.textContent=count===null/,"availability badge derives from live orders");
assert.match(js,/if\(!stats.canBook\)return "full"/,"full-day time conflict remains blocked");
assert.match(css,/\.oa-calendar-body\[hidden\] \{ display:none!important; \}/,"hidden calendar stays hidden in CSS");
console.log("Collapsible order calendar: source checks PASS");
