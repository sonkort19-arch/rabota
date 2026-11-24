/* CRM «Работа»: финансовые отчёты и загрузка данных.
 * Stage 5: refactor only. Payment, payout and cash RPC calls remain in index.html.
 * Server remains authoritative for balances, role checks and payments.
 */
"use strict";
(function(root){
  const FINANCE_TIMUR_FEE=1500;
  const FINANCE_RAUL_PERCENT=0.5;
  const money=amount=>Number(amount||0).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽";
  const sumBy=(rows,fn)=>rows.reduce((total,row)=>total+Number(fn(row)||0),0);
  const roundMoney=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
  function collectionAmounts(row){
    const total=Number(row.company_amount)||0;
    // Rows created before partial handoffs record only full-order timestamps.
    const confirmedAmount=Number(row.confirmed_amount??(row.confirmed_at?total:0));
    const submittedAmount=Number(row.submitted_amount??(row.submitted_at||row.confirmed_at?total:0));
    return {confirmedAmount,submittedAmount,pendingAmount:roundMoney(submittedAmount-confirmedAmount),
      waitingAmount:roundMoney(total-submittedAmount)};
  }
  function financeSplit(price){
    const gross=roundMoney(price);
    const grossCents=Math.round(gross*100);
    const raulCents=Math.round(grossCents*FINANCE_RAUL_PERCENT);
    const companyCents=grossCents-raulCents-FINANCE_TIMUR_FEE*100;
    return {gross,raul:raulCents/100,timur:FINANCE_TIMUR_FEE,company:companyCents/100};
  }
  function calculateAccruals({orders,operations,collections,masterId}){
    const relevantOrders=masterId?orders.filter(o=>o.assignedUserId===masterId):[];
    const eligible=relevantOrders.filter(o=>o.status==="Выполнен"&&o.paid&&Number.isFinite(o.price)&&o.price>=0);
    const payments=operations.filter(o=>!o.voided_at);
    const teamPayments=payments.filter(o=>o.master_user_id===masterId);
    const raulAccrued=roundMoney(sumBy(eligible,o=>financeSplit(o.price).raul));
    const timurAccrued=eligible.length*FINANCE_TIMUR_FEE;
    const raulPaid=sumBy(teamPayments.filter(o=>o.kind==="raul_payout"),o=>o.amount);
    const timurPaid=sumBy(teamPayments.filter(o=>o.kind==="timur_payout"),o=>o.amount);
    const raulDue=roundMoney(raulAccrued-raulPaid);
    const timurDue=roundMoney(timurAccrued-timurPaid);
    const companyEarned=roundMoney(sumBy(eligible,o=>financeSplit(o.price).company));
    const eligibleGross=sumBy(eligible,o=>o.price);
    const bookedPending=relevantOrders.filter(o=>!o.paid||o.status!=="Выполнен");
    const unconfirmedCash=collections.filter(c=>collectionAmounts(c).confirmedAmount<Number(c.company_amount));
    const own=unconfirmedCash.filter(c=>c.master_user_id===masterId).map(collectionAmounts);
    const masterHeld=roundMoney(sumBy(own,c=>c.waitingAmount));
    const waitingOwner=roundMoney(sumBy(own,c=>c.pendingAmount));
    return {relevantOrders,eligible,payments,teamPayments,raulAccrued,timurAccrued,
      raulPaid,timurPaid,raulDue,timurDue,companyEarned,eligibleGross,
      bookedPending,unconfirmedCash,masterHeld,waitingOwner};
  }
  function calculateCompanyCash({orders,collections,payments,raulDue,timurDue}){
    const receivedOrders=orders.filter(o=>o.paid&&o.status!=="Отменён");
    const cashCollections=new Set(collections.map(c=>String(c.order_id)));
    const masterUnallocated=receivedOrders.filter(o=>
      o.paymentReceivedBy==="master"&&!cashCollections.has(String(o.id)));
    const directReceipts=sumBy(receivedOrders.filter(o=>
      !cashCollections.has(String(o.id))&&o.paymentReceivedBy!=="master"),o=>o.price);
    const confirmedDeposits=roundMoney(sumBy(collections,c=>collectionAmounts(c).confirmedAmount));
    const cashIn=roundMoney(directReceipts+confirmedDeposits);
    const allPayouts=sumBy(payments.filter(o=>
      (o.kind==="raul_payout"||o.kind==="timur_payout")&&!o.order_id),o=>o.amount);
    const expenses=sumBy(payments.filter(o=>o.kind==="expense"),o=>o.amount);
    const notCompletedPaid=sumBy(receivedOrders.filter(o=>o.status!=="Выполнен"),o=>o.price);
    const cashBalance=roundMoney(cashIn-allPayouts-expenses);
    const freeBalance=roundMoney(cashBalance-raulDue-timurDue-notCompletedPaid);
    const awaiting=collections.filter(c=>collectionAmounts(c).pendingAmount>0);
    return {receivedOrders,cashCollections,masterUnallocated,directReceipts,
      confirmedDeposits,cashIn,allPayouts,expenses,notCompletedPaid,
      cashBalance,freeBalance,awaiting};
  }
  // A confirmed write invalidates old reads. Readers share one request and
  // follow it with one new read if the data changed while it was in flight.
  function createFinanceReader({load,onUpdate=()=>{},equal=Object.is,now=Date.now}){
    let value=null,error=null,updatedAt=null,revision=0,account=0,sequence=0,dirty=false,request=null;
    function state(){
      const message=error?.message||"";
      return {
        value,revision,updatedAt,ready:value!==null,
        loading:value===null&&!error,refreshing:value!==null&&request!==null,
        stale:dirty||Boolean(value!==null&&error),
        error:value===null?message:"",refreshError:message
      };
    }
    function invalidate(){
      sequence++;
      dirty=true;
      onUpdate(state(),"invalidate");
    }
    function reset(){
      account++;
      revision++;
      request=null;value=null;error=null;updatedAt=null;dirty=false;sequence=0;
    }
    function refresh({maxAge=0}={}){
      if(request)return request;
      if(value!==null&&!dirty&&!error&&updatedAt!==null&&now()-updatedAt<maxAge)
        return Promise.resolve(value);
      const readerAccount=account;
      request=Promise.resolve().then(async()=>{
        try {
          while(readerAccount===account){
            const attempt=sequence;
            const isCurrent=()=>readerAccount===account&&attempt===sequence;
            try{
              const next=await load({fresh:dirty,isCurrent});
              if(!isCurrent())continue;
              if(next==null)throw Error("Не удалось получить финансовые данные.");
              if(value===null||!equal(value,next)){value=next;revision++;}
              updatedAt=now();dirty=false;error=null;
            }catch(reason){
              if(!isCurrent())continue;
              error=reason instanceof Error?reason:new Error(String(reason));
              if([401,403].includes(error.status)||error.code==="42501"){
                if(value!==null)revision++;
                value=null;updatedAt=null;
              }
            }
            return value;
          }
          return null;
        }finally{
          if(readerAccount===account){
            request=null;
            onUpdate(state(),"settle");
          }
        }
      });
      onUpdate(state(),"start");
      return request;
    }
    return {state,refresh,invalidate,reset};
  }
  function createFinanceModel(deps){
    if(!deps||typeof deps.dbRequest!=="function"||
       typeof deps.getRole!=="function"||typeof deps.getMasterName!=="function"||
       typeof deps.getUserId!=="function"||typeof deps.nextGeneration!=="function"||
       typeof deps.isCurrentGeneration!=="function")
      throw new TypeError("Неверные зависимости финансового модуля");
    let operationsRead=null;
    let operationsGeneration=0;
    function resetOperations(){
      operationsGeneration++;
      operationsRead=null;
    }
    function readOperations({fresh=false}={}){
      const role=deps.getRole(),userId=deps.getUserId();
      if(role!=="owner"&&role!=="master")
        return Promise.reject(new Error("Финансовые операции недоступны."));
      const previous=operationsRead?.role===role&&operationsRead.userId===userId?operationsRead:null;
      if(!fresh&&previous)return previous.promise;
      const generation=operationsGeneration;
      const read={role,userId,promise:null};
      read.promise=(async()=>{
        if(previous)await previous.promise.catch(()=>{});
        if(generation!==operationsGeneration)
          throw new Error("Аккаунт изменился во время загрузки операций.");
        const rows=new Map();
        for(let offset=0;offset<100000;offset+=1000){
          const page=await deps.dbRequest(
            "rabota_finance_operations?select=*&order=created_at.desc,id.desc&limit=1000&offset="+offset,"GET");
          if(generation!==operationsGeneration)
            throw new Error("Аккаунт изменился во время загрузки операций.");
          if(!Array.isArray(page))throw Error("Не удалось загрузить финансовые операции");
          for(const row of page)rows.set(String(row.id),row);
          if(page.length<1000)break;
        }
        return [...rows.values()];
      })().finally(()=>{
        if(operationsRead===read)operationsRead=null;
      });
      operationsRead=read;
      return read.promise;
    }
    async function loadFinance({fresh=true,operations:providedOperations,isCurrent=()=>true}={}){
      const currentRole=deps.getRole();
      if(currentRole!=="owner"&&currentRole!=="master")return;
      const generation=deps.nextGeneration();
      const current=()=>isCurrent()&&deps.isCurrentGeneration(generation);
      const reads=await Promise.allSettled([
        providedOperations||readOperations({fresh}),
        currentRole==="owner"
          ?deps.readMasters?.()||deps.dbRequest("rabota_members?select=user_id,role,active,master_name&role=eq.master&limit=100","GET")
          :null,
        readCollections(current)
      ]);
      if(!current())return;
      const rejected=reads.find(result=>result.status==="rejected");
      if(rejected)throw rejected.reason;
      const [operations,masters,currentCollections]=reads.map(result=>result.value);
      let masterId=null;
      if(currentRole==="owner"){
        if(!Array.isArray(masters))throw Error("Не удалось загрузить список мастеров.");
        masterId=masters.find(m=>m.role==="master"&&m.active&&String(m.master_name||"").trim().toLowerCase()==="рауль")?.user_id||null;
      }else{
        masterId=String(deps.getMasterName()||"").trim().toLowerCase()==="рауль"?deps.getUserId():null;
      }
      const uniqueCollections=new Map(currentCollections.map(row=>[String(row.order_id),row]));
      const deposits=currentCollections.filter(c=>c.confirmed_amount==null&&c.confirmed_at)
        .map(c=>({id:c.order_id,amount:Number(c.company_amount),confirmed_at:c.confirmed_at}));
      if(currentRole==="owner"&&currentCollections.some(c=>Number(c.confirmed_amount)>0)){
        // One payment can be confirmed in separate instalments on different days.
        const seen=new Set();
        for(let offset=0;;offset+=1000){
          const page=await deps.dbRequest("rabota_cash_transfer_events?select=id,order_id,amount,created_at&kind=eq.confirmed&order=created_at.desc,id.desc&limit=1000&offset="+offset,"GET");
          if(!current())return;
          if(!Array.isArray(page))throw Error("Не удалось загрузить подтверждённые передачи");
          for(const row of page){
            const collection=uniqueCollections.get(String(row.order_id));
            // A receipt may have been posted since the collections request.
            if(!collection?.last_confirmed_at||row.created_at>collection.last_confirmed_at||seen.has(row.id))continue;
            seen.add(row.id);
            deposits.push({id:row.id,amount:Number(row.amount),confirmed_at:row.created_at});
          }
          if(page.length<1000)break;
        }
      }
      if(!current())return;
      const snapshot={
        masterId,
        operations,
        collections:currentCollections,deposits
      };
      deps.onSnapshot?.(snapshot);
      return snapshot;
    }
    async function readCollections(isCurrent){
      const collections=new Map();
      for(let offset=0;offset<100000;offset+=1000){
        const page=await deps.dbRequest("rabota_cash_collections?select=*&order=created_at.desc,order_id.desc&limit=1000&offset="+offset,"GET");
        if(!isCurrent())return null;
        if(!Array.isArray(page))throw Error("Не удалось загрузить распределения");
        for(const row of page)collections.set(String(row.order_id),row);
        if(page.length<1000)break;
      }
      return [...collections.values()];
    }
    return {loadFinance,readOperations,resetOperations,money,sumBy,roundMoney,collectionAmounts,financeSplit,calculateAccruals,
      calculateCompanyCash,TIMUR_FEE:FINANCE_TIMUR_FEE,RAUL_PERCENT:FINANCE_RAUL_PERCENT};
  }
  if(root){root.__rdCreateFinanceModel=createFinanceModel;root.__rdCreateFinanceReader=createFinanceReader;root.__rdFinanceSplit=financeSplit;}
  if(typeof module!=="undefined"&&module.exports)
    module.exports={createFinanceModel,createFinanceReader,money,sumBy,roundMoney,collectionAmounts,financeSplit,
      calculateAccruals,calculateCompanyCash,TIMUR_FEE:FINANCE_TIMUR_FEE,
      RAUL_PERCENT:FINANCE_RAUL_PERCENT};
})(typeof window!=="undefined"?window:null);
