/* CRM «Работа» — этап 7: связка лидов, формы заказа и входа в ИИ-чат.
 * UI bridge only. No direct writes, RPC calls, OpenAI or Supabase keys.
 * Existing lead-assistant.js, ai.html and api/ai-chat.js remain authoritative.
 */
"use strict";
(function(root){
  const MASTER_MATERIALS=["Алюминиевые","Биметаллические","Чугунные","Другие"];
  const ALLOWED_RETURN_PAGES=new Set(["home","orders","calendar","leads","clients","finance"]);
  const PREVIEW_HOST=/^rabota-[a-z0-9]{7,}-sonkort19-6069s-projects\.vercel\.app$/i;
  const isAllowedRole=role=>role==="owner"||role==="manager";
  const safeText=value=>String(value||"");
  const safeLeadId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value)?value:null;
  function createLeadAIBridge(deps){
    if(!deps||typeof deps.getRole!=="function"||typeof deps.getUserId!=="function"||
      typeof deps.getOrders!=="function"||typeof deps.openForm!=="function"||
      typeof deps.refreshAvailability!=="function"||typeof deps.getCurrentPage!=="function"||
      !deps.form||!deps.formStatus||!deps.controls||!deps.aiChatLink||
      typeof deps.hostname!=="function")throw new TypeError("Неверные зависимости лидов и ИИ");
    const {getRole,getUserId,getOrders,openForm,refreshAvailability,
      getCurrentPage,form,formStatus,controls,aiChatLink,hostname}=deps;
    function context(){
      return {
        role:getRole(),userId:getUserId()||null,
        orders:getOrders().map(o=>({date:o.date,time:o.time,master:o.master,status:o.status}))
      };
    }
    function openLeadOrder(lead){
      if(!isAllowedRole(getRole())||!lead)return;
      openForm();
      const id=safeLeadId(lead.id);
      if(id)form.dataset.leadId=id;
      controls.name.value=safeText(lead.name);
      controls.phone.value=safeText(lead.phone);
      controls.address.value=safeText(lead.address);
      controls.type.value=MASTER_MATERIALS.includes(lead.material)?lead.material:"Другие";
      controls.radiators.value=lead.radiators??"";
      controls.loops.value=lead.loops??"";
      controls.price.value=lead.price??"";
      controls.details.value=safeText(lead.notes).slice(0,1000);
      // A proposed time is never a confirmed booking.
      controls.date.value="";
      controls.time.value="";
      refreshAvailability(getOrders());
      if(PREVIEW_HOST.test(hostname())){
        form.dataset.leadPreview="1";
        formStatus.textContent="Черновик из лида. В Preview запись заказа отключена.";
      }
    }
    function preventPreviewSubmit(event){
      if(form.dataset.leadPreview!=="1")return;
      event.preventDefault();
      event.stopImmediatePropagation();
      formStatus.textContent="Тестовый режим: данные из лида подставлены, но сохранять заказ в общей базе нельзя.";
    }
    function prepareChatLink(event){
      // Preserve a trusted internal CRM route, never copy an external URL.
      const current=getCurrentPage();
      const origin=ALLOWED_RETURN_PAGES.has(current)?current:"home";
      event.currentTarget.href="/ai.html?"+new URLSearchParams({from:origin}).toString();
    }
    return {context,openLeadOrder,preventPreviewSubmit,prepareChatLink};
  }
  if(root)root.__rdCreateLeadAIBridge=createLeadAIBridge;
  if(typeof module!=="undefined"&&module.exports)
    module.exports={createLeadAIBridge};
})(typeof window!=="undefined"?window:null);
