/* Raul's compact new-order form: synthetic UI-only regression checks.
 * No Supabase writes, no external calls and no price calculations. */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"master-quick-order.css"),"utf8");
const availability=fs.readFileSync(path.join(root,"order-availability.js"),"utf8");
const code=fs.readFileSync(path.join(root,"master-quick-order.js"),"utf8");
const {steppedCount,createHandler}=require("../master-quick-order.js");

test("approved mock has one real input for every original order field",()=>{
  for(const id of ["clientName","clientPhone","clientAddress","radiators","floorLoops",
    "price","master","orderDate","orderTime","orderStatus","radiatorType","orderDetails",
    "orderMasterNote"]){
    assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
  }
  assert.match(html,/id="clientName"[^>]*required/);
  assert.match(html,/id="clientPhone"[^>]*required/);
  assert.match(html,/id="orderTime"[^>]*required/);
  assert.match(html,/id="orderAdvanced"/);
  assert.equal((html.match(/class="order-submit-bar"/g)||[]).length,1);
  assert.match(html,/id="formStatus" role="status" aria-live="polite"/);
});

test("only Raul sees icon fields, work steppers and premium bottom sheet",()=>{
  assert.match(html,/mq-client-heading/);
  assert.match(html,/mq-quantity-field/);
  assert.match(html,/mq-price-wrap/);
  assert.match(html,/mq-booking-heading/);
  assert.match(css,/#orderOverlay:not\(\.master-quick\) \.mq-master-only\{display:none!important\}/);
  assert.match(css,/#orderOverlay\.master-quick \.mq-owner-only\{display:none!important\}/);
  assert.match(css,/body\.rd #orderOverlay\.master-quick > \.sheet\{/);
  assert.match(css,/scroll-padding-block/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/body\.rd #orderOverlay\.master-quick #orderForm \.order-submit-bar/);
  assert.match(css,/background:linear-gradient\(105deg,#2879ff/);
});

test("four time suggestions for Raul are still checked, others unchanged",()=>{
  assert.match(availability,/const suggestedTimes=\["10:00","15:00","18:00"\]/);
  assert.match(availability,/const times=raulQuick\?\["10:00","12:30","15:00","18:00"\]:suggestedTimes/);
  assert.match(availability,/const state=timeState\(time,date,master\)/);
  assert.match(availability,/button\.disabled=!selectable/);
  assert.match(availability,/timeInput\.dispatchEvent\(new Event\("change"/);
  assert.match(html,/src="\/order-availability\.js\?v=20261117-raul4-v1"/);
  assert.match(html,/src="\/master-quick-order\.js\?v=20261117-mock-v1"/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test("step controls allow zero and blank initial values without changing prices",()=>{
  for(const [initial,delta,expected] of [
    ["",1,1],["", -1,0],[0,-1,0],[0,1,1],[4,1,5],[4,-1,3],[1,-1,0]
  ])assert.equal(steppedCount(initial,delta),expected);
  assert.doesNotMatch(code,/getElementById\("price"\)/);
  assert.match(code,/if\(field!=="radiators"&&field!=="floorLoops"\)return false/);
});

test("step events update only authorized inputs and emit native input/change",()=>{
  const input={value:"4",disabled:false,events:[],dispatchEvent(event){this.events.push(event.type)}};
  const overlay={hidden:false,classList:{contains:x=>x==="master-quick"}};
  const doc={getElementById:id=>id==="orderOverlay"?overlay:id==="radiators"?input:null};
  const handler=createHandler(doc);
  const button={dataset:{mqStep:"1",mqTarget:"radiators"}};
  const clicked={target:{closest:()=>button}};
  assert.equal(handler(clicked),true);
  assert.equal(input.value,"5");
  assert.deepEqual(input.events,["input","change"]);
  overlay.hidden=true;assert.equal(handler(clicked),false);
  overlay.hidden=false;overlay.classList.contains=()=>false;
  assert.equal(handler(clicked),false);
  assert.equal(input.value,"5");
});

test("saving, conflicts, confirmation, finance guard and role restrictions remain original",()=>{
  assert.match(html,/const raulCreating=raulCanCreateOrder\(\)/);
  assert.match(html,/if\(orderSaving\)return/);
  assert.match(html,/if\(status!=="Отменён"&&hasConflict/);
  assert.match(html,/const busy=findTightBookings/);
  assert.match(html,/if\(!confirm\("Внимание:/);
  assert.match(html,/await persistOrder\(order\)/);
  assert.match(html,/price:controls\.price\.value===""\?null:Number\(controls\.price\.value\)/);
  assert.match(html,/advanced\.open=Boolean\(existing\)/);
  assert.match(html,/controls\.master\.readOnly=raulCreating/);
});
