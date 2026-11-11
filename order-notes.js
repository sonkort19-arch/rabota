/* CRM "Работа": two notes in the existing rabota_orders.details field.
 * No schema migration and no automatic migration or forwarding of old notes.
 * Legacy free-text notes are internal until the owner explicitly classifies them.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root&&root.document)root.__rdOrderNotes=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const PREFIX="[rabota-notes:1]";
  const MAX_LENGTH=1000;
  function parse(value){
    const raw=String(value??"");
    if(raw.startsWith(PREFIX)){
      try {
        const obj=JSON.parse(raw.slice(PREFIX.length));
        if(obj&&typeof obj==="object"&&!Array.isArray(obj)&&
          typeof obj.m==="string"&&typeof obj.i==="string"){
          return {master:obj.m,internal:obj.i,legacy:false};
        }
      }catch(_){}
    }
    return {master:"",internal:raw,legacy:Boolean(raw.trim())};
  }
  function pack(master,internal){
    const m=String(master??"").trim(),i=String(internal??"").trim();
    if(!m&&!i)return "";
    const result=PREFIX+JSON.stringify({m,i});
    if(result.length>MAX_LENGTH)throw new Error(
      "Два комментария вместе слишком длинные (максимум 1000 символов с учётом служебного формата). Сократите текст."
    );
    return result;
  }
  function display(value,role){
    const notes=parse(value),parts=[];
    if(notes.master.trim())parts.push("Мастеру: "+notes.master);
    if(role!=="master"&&notes.internal.trim())
      parts.push((notes.legacy?"Старый комментарий (ещё не распределён): ":"Внутренний комментарий: ")+notes.internal);
    return parts.join("\n\n");
  }
  return {parse,pack,display,isLegacy:value=>parse(value).legacy};
});
