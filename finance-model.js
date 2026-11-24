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
    const raul=roundMoney(gross*FINANCE_RAUL_PERCENT);
    const timur=FINANCE_TIMUR_FEE;
    const company=roundMoney(gross-raul-timur);
    return {gross,raul,timur,company};
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
  function createFinanceModel(deps){
    if(!deps||typeof deps.dbRequest!=="function"||
       typeof deps.getRole!=="function"||typeof deps.getMasterName!=="function"||
       typeof deps.getUserId!=="function"||typeof deps.nextGeneration!=="function"||
       typeof deps.isCurrentGeneration!=="function"||typeof deps.onSnapshot!=="function")
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
      if(!fresh&&operationsRead?.role===role&&operationsRead.userId===userId)
        return operationsRead.promise;
      const generation=operationsGeneration;
      const read={role,userId,promise:null};
      read.promise=(async()=>{
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
    async function loadFinance({fresh=true}={}){
      const currentRole=deps.getRole();
      if(currentRole!=="owner"&&currentRole!=="master")return;
      const generation=deps.nextGeneration();
      const [operations,masters]=await Promise.all([
        readOperations({fresh}),
        currentRole==="owner"
          ?deps.dbRequest("rabota_members?select=user_id,role,active,master_name&role=eq.master&limit=100","GET")
          :null
      ]);
      if(!deps.isCurrentGeneration(generation))return;
      let masterId=null;
      if(currentRole==="owner"){
        masterId=masters.find(m=>m.active&&String(m.master_name||"").trim().toLowerCase()==="рауль")?.user_id||null;
      }else{
        masterId=String(deps.getMasterName()||"").trim().toLowerCase()==="рауль"?deps.getUserId():null;
      }
      const collections=[];
      for(let offset=0;offset<100000;offset+=1000){
        const page=await deps.dbRequest("rabota_cash_collections?select=*&order=created_at.desc&limit=1000&offset="+offset,"GET");
        if(!Array.isArray(page))throw Error("Не удалось загрузить распределения");
        collections.push(...page);
        if(page.length<1000)break;
      }
      const uniqueCollections=new Map(collections.map(row=>[String(row.order_id),row]));
      const currentCollections=[...uniqueCollections.values()];
      const deposits=currentCollections.filter(c=>c.confirmed_amount==null&&c.confirmed_at)
        .map(c=>({id:c.order_id,amount:Number(c.company_amount),confirmed_at:c.confirmed_at}));
      if(currentRole==="owner"&&currentCollections.some(c=>Number(c.confirmed_amount)>0)){
        // One payment can be confirmed in separate instalments on different days.
        const seen=new Set();
        for(let offset=0;;offset+=1000){
          const page=await deps.dbRequest("rabota_cash_transfer_events?select=id,order_id,amount,created_at&kind=eq.confirmed&order=created_at.desc,id.desc&limit=1000&offset="+offset,"GET");
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
      if(!deps.isCurrentGeneration(generation))return;
      deps.onSnapshot({
        masterId,
        operations,
        collections:currentCollections,deposits
      });
    }
    return {loadFinance,readOperations,resetOperations,money,sumBy,roundMoney,collectionAmounts,financeSplit,calculateAccruals,
      calculateCompanyCash,TIMUR_FEE:FINANCE_TIMUR_FEE,RAUL_PERCENT:FINANCE_RAUL_PERCENT};
  }
  if(root){root.__rdCreateFinanceModel=createFinanceModel;root.__rdFinanceSplit=financeSplit;}
  if(typeof module!=="undefined"&&module.exports)
    module.exports={createFinanceModel,money,sumBy,roundMoney,collectionAmounts,financeSplit,
      calculateAccruals,calculateCompanyCash,TIMUR_FEE:FINANCE_TIMUR_FEE,
      RAUL_PERCENT:FINANCE_RAUL_PERCENT};
})(typeof window!=="undefined"?window:null);
