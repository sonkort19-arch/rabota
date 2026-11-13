/* CRM «Работа»: компактная фоновая проверка обновлений заказов.
 * Первичная загрузка и действия пользователя по-прежнему получают полный список.
 * История не скрывается, удаления обнаруживаются по набору ID.
 */
"use strict";
(()=>{
  const PAGE_SIZE=1000;
  const MAX_OFFSET=100000;
  const FULL_RECONCILE_MS=5*60*1000;
  const fingerprint=rows=>JSON.stringify(rows.map(row=>[
    String(row.id),String(row.updated_at||"")
  ]).sort((a,b)=>a[0].localeCompare(b[0])));
  function createOrderSync({now=()=>Date.now(),reconcileMs=FULL_RECONCILE_MS}={}){
    let lastFullAt=0;
    let fullFingerprint=null;
    return {
      reset(){lastFullAt=0;fullFingerprint=null;},
      rememberFull(rows){
        if(!Array.isArray(rows))throw new TypeError("Неверный список заказов");
        fullFingerprint=fingerprint(rows);
        lastFullAt=now();
      },
      async isUnchanged(loadPage){
        const age=now()-lastFullAt;
        if(fullFingerprint===null || age<0 || age>=reconcileMs)return false;
        const headers=[];
        for(let offset=0;offset<MAX_OFFSET;offset+=PAGE_SIZE){
          const page=await loadPage(offset,PAGE_SIZE);
          if(!Array.isArray(page))throw new Error("Не удалось проверить изменения заказов");
          headers.push(...page);
          if(page.length<PAGE_SIZE)return fingerprint(headers)===fullFingerprint;
        }
        // Never trust an incomplete list as unchanged.
        return false;
      }
    };
  }
  if(typeof window!=="undefined")window.__rdOrderSync=createOrderSync();
  if(typeof module!=="undefined"&&module.exports){
    module.exports={createOrderSync};
  }
})();
