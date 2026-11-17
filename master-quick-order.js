/* CRM Работа: stepper controls in Raul's create-order form.
 * Display/input assistance only. No calculation of prices or appointment authority.
 */
"use strict";
(function(root){
  function steppedCount(value,delta){
    const n=Number(value);
    const initial=String(value??"").trim()!==""&&Number.isFinite(n)&&n>=0
      ?Math.trunc(n):0;
    return Math.max(0,initial+(delta===1?1:-1));
  }
  function createHandler(doc){
    return function onStepClick(event){
      const button=event.target?.closest?.("button[data-mq-step][data-mq-target]");
      if(!button)return false;
      const overlay=doc.getElementById("orderOverlay");
      if(!overlay||overlay.hidden||!overlay.classList.contains("master-quick"))return false;
      const field=button.dataset.mqTarget;
      if(field!=="radiators"&&field!=="floorLoops")return false;
      const delta=Number(button.dataset.mqStep);
      if(delta!==1&&delta!==-1)return false;
      const input=doc.getElementById(field);
      if(!input||input.disabled)return false;
      input.value=String(steppedCount(input.value,delta));
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));
      return true;
    };
  }
  if(root?.document){
    const overlay=root.document.getElementById("orderOverlay");
    if(overlay)overlay.addEventListener("click",createHandler(root.document));
  }
  if(typeof module!=="undefined"&&module.exports)module.exports={steppedCount,createHandler};
})(typeof window!=="undefined"?window:null);
