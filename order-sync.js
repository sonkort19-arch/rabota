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
    let account=0;
    let latestRead=null;
    return {
      reset(){
        lastFullAt=0;fullFingerprint=null;
        account++;latestRead=null;
      },
      runRead(background,load){
        if(background&&latestRead?.pending)return latestRead.promise;
        const generation=account;
        const read={pending:true,promise:null};
        latestRead=read;
        const isCurrent=()=>latestRead===read;
        // A foreground read after a write needs its own authoritative result.
        // Older callers may wait for that result within the same account.
        const newerRead=()=>generation===account?latestRead?.promise:undefined;
        read.promise=Promise.resolve()
          .then(()=>{if(isCurrent())return load(isCurrent);})
          .then(
            result=>isCurrent()?result:newerRead(),
            error=>{
              if(isCurrent())throw error;
              return newerRead();
            }
          )
          .finally(()=>{read.pending=false;});
        return read.promise;
      },
      rememberFull(rows){
        if(!Array.isArray(rows))throw new TypeError("Неверный список заказов");
        fullFingerprint=fingerprint(rows);
        lastFullAt=now();
      },
      async isUnchanged(loadPage,isCurrent=()=>true){
        const age=now()-lastFullAt;
        if(fullFingerprint===null || age<0 || age>=reconcileMs)return false;
        const headers=[];
        for(let offset=0;offset<MAX_OFFSET;offset+=PAGE_SIZE){
          const page=await loadPage(offset,PAGE_SIZE);
          if(!isCurrent())return false;
          if(!Array.isArray(page))throw new Error("Не удалось проверить изменения заказов");
          headers.push(...page);
          if(page.length<PAGE_SIZE)return fingerprint(headers)===fullFingerprint;
        }
        // Never trust an incomplete list as unchanged.
        return false;
      },
      async readFull(loadPage,isCurrent=()=>true){
        const rows=[],ids=new Set();
        for(let offset=0;offset<=MAX_OFFSET;offset+=PAGE_SIZE){
          const limit=offset===MAX_OFFSET?1:PAGE_SIZE;
          const page=await loadPage(offset,limit);
          if(!isCurrent())return null;
          if(!Array.isArray(page)||page.length>limit)
            throw new Error("Неверный ответ базы данных.");
          if(offset===MAX_OFFSET&&page.length)
            throw new Error("Превышен предел загрузки заказов.");
          for(const row of page){
            const id=String(row?.id??"");
            if(!id||ids.has(id))throw new Error("Список заказов изменился во время загрузки. Повторите обновление.");
            ids.add(id);rows.push(row);
          }
          if(page.length<limit)return rows;
        }
      }
    };
  }
  if(typeof window!=="undefined")window.__rdOrderSync=createOrderSync();
  if(typeof module!=="undefined"&&module.exports){
    module.exports={createOrderSync};
  }
})();
