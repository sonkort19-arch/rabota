/* CRM «Работа»: учёт подтверждённых поступлений, выплат и прочих расходов.
 * Поступления и начисления подтверждает сервер. Записи и права контролируют RPC.
 */
"use strict";
(function(root){
  const money=amount=>Number(amount||0).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽";
  const sumBy=(rows,fn)=>rows.reduce((total,row)=>total+Number(fn(row)||0),0);
  const roundMoney=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
  function monetaryValue(value){
    if(typeof value!=="number"&&(typeof value!=="string"||!value.trim()))return null;
    const number=Number(value);
    return Number.isFinite(number)&&Number.isSafeInteger(Math.round(number*100))?roundMoney(number):null;
  }
  function fullyPaidAmount(order){
    if(order?.paid!==true||order.status!=="Выполнен")return null;
    const price=monetaryValue(order.price);
    const payment=monetaryValue(order.paymentAmount);
    return payment>0&&payment===price?payment:null;
  }
  function payrollSplitV3(actualPaid){
    const payment=monetaryValue(actualPaid);
    if(!(payment>0))return null;
    const cents=Math.round(payment*100);
    const raulCents=Math.round(cents/2)+150000;
    return {gross:payment,raul:raulCents/100,company:(cents-raulCents)/100};
  }
  function normalizeAccounting(snapshot){
    const hasRefunds=Object.hasOwn(snapshot,"accounting_refunds");
    if(snapshot.accounting_version==null){
      if(snapshot.accounting_receipts!=null||snapshot.accounting_payouts!=null||hasRefunds)
        throw Error("Сервер вернул учётные операции без версии расчёта.");
      return {};
    }
    if(snapshot.accounting_version!==1)
      throw Error("Неизвестная версия учёта поступлений.");
    const receiptsRaw=snapshot.accounting_receipts,payoutsRaw=snapshot.accounting_payouts;
    if(receiptsRaw==null&&payoutsRaw==null&&!hasRefunds)return {accountingVersion:1};
    if(!Array.isArray(receiptsRaw)||(payoutsRaw!=null&&!Array.isArray(payoutsRaw)))
      throw Error("Сервер вернул неполный журнал учёта.");
    const receiptAmounts=new Map();
    const receipts=receiptsRaw.map(row=>{
      const {order_id:orderId,master_id:masterId,payment_method:method,paid_at:paidAt,occurred_at:occurredAt}=row??{};
      const amount=monetaryValue(row?.amount);
      if(typeof orderId!=="string"||!orderId||receiptAmounts.has(orderId)||amount===null||amount<=0||
         !Object.hasOwn(row??{},"master_id")||
         (masterId!=null&&(typeof masterId!=="string"||!masterId)))
        throw Error("Сервер вернул неверную запись поступления.");
      receiptAmounts.set(orderId,amount);
      return {orderId,masterId:masterId??null,amount,method:method??null,paidAt:paidAt??null,occurredAt:occurredAt??null};
    });
    const payoutIds=new Set();
    const payouts=payoutsRaw?.map(row=>{
      const {id,order_id:orderId,payment_method:method,created_at:occurredAt,note}=row??{};
      const amount=monetaryValue(row?.amount);
      if(typeof id!=="string"||!id||payoutIds.has(id)||amount===null||amount<=0)
        throw Error("Сервер вернул неверную запись учтённой выплаты.");
      payoutIds.add(id);
      return {id,orderId:orderId??null,amount,method:method??null,occurredAt:occurredAt??null,note:note??""};
    })??null;
    const accounting={version:1,receipts,payouts};
    if(hasRefunds){
      if(!Array.isArray(snapshot.accounting_refunds))
        throw Error("Сервер вернул неверный список учтённых возвратов.");
      const orderIds=new Set();
      accounting.refunds=snapshot.accounting_refunds.map(row=>{
        const {order_id:orderId,refunded_at:occurredAt}=row??{};
        const amount=monetaryValue(row?.amount);
        if(typeof orderId!=="string"||!orderId||orderIds.has(orderId)||amount===null||amount<=0||
           typeof occurredAt!=="string"||!Number.isFinite(Date.parse(occurredAt)))
          throw Error("Сервер вернул неверную запись учтённого возврата.");
        if(receiptAmounts.get(orderId)!==amount)
          throw Error("Сервер вернул возврат без соответствующего поступления.");
        orderIds.add(orderId);
        return {orderId,amount,occurredAt};
      });
    }
    return {accountingVersion:1,accounting};
  }
  function normalizePayrollSnapshot(snapshot){
    const {version,state,master_id:masterId,activated_at:activatedAt}=snapshot??{};
    if(version!==3||!["active","inactive","not_applicable"].includes(state))
      throw Error("Неизвестный формат расчётов зарплаты.");
    const accounting=normalizeAccounting(snapshot);
    if(state!=="active")return {version,state,...accounting};
    if(typeof masterId!=="string"||!masterId||typeof activatedAt!=="string"||!activatedAt||
       !Array.isArray(snapshot.orders)||!Array.isArray(snapshot.payouts))
      throw Error("Сервер вернул неполный расчёт зарплаты.");
    const earned=monetaryValue(snapshot.earned),paid=monetaryValue(snapshot.paid),due=monetaryValue(snapshot.due);
    if(earned===null||paid===null||due===null||earned<0||paid<0||roundMoney(earned-paid)!==due)
      throw Error("Сервер вернул неверную сумму зарплаты.");
    const orderIds=new Set();
    const orders=snapshot.orders.map(row=>{
      const {order_id:orderId,earned_at:earnedAt,rule_version:ruleVersion}=row??{};
      const orderEarned=monetaryValue(row?.earned_amount);
      const actualPaid=monetaryValue(row?.paid_amount);
      const companyShare=monetaryValue(row?.company_share);
      if(typeof orderId!=="string"||!orderId||orderIds.has(orderId)||
         orderEarned===null||orderEarned<0||actualPaid===null||actualPaid<0||companyShare===null)
        throw Error("Сервер вернул неверное начисление по заказу.");
      orderIds.add(orderId);
      return {orderId,earned:orderEarned,actualPaid,companyShare,earnedAt:earnedAt??null,ruleVersion:ruleVersion??null};
    });
    const payoutIds=new Set();
    const payouts=snapshot.payouts.map(row=>{
      const {id,order_id:orderId,created_at:occurredAt,payment_method:method,note,kind}=row??{};
      const amount=monetaryValue(row?.amount);
      if(typeof id!=="string"||!id||payoutIds.has(id)||amount===null||amount<=0)
        throw Error("Сервер вернул неверную запись выплаты.");
      payoutIds.add(id);
      const entry={id,orderId:orderId??null,amount,occurredAt:occurredAt??null,method:method??null,note:note??"",kind:kind??null};
      if(row.recorded_amount!==undefined||row.held_amount!==undefined){
        const recorded=monetaryValue(row.recorded_amount),held=monetaryValue(row.held_amount);
        if(recorded===null||held===null||held<0||roundMoney(amount+held)>recorded)
          throw Error("Сервер вернул неверную сумму выплаты на сверке.");
        Object.assign(entry,{recorded,held});
      }
      return entry;
    });
    if(snapshot.refunds!==undefined&&!Array.isArray(snapshot.refunds))
      throw Error("Сервер вернул неверный список возвратов.");
    const refundedIds=new Set();
    const refunds=(snapshot.refunds??[]).map(row=>{
      const {order_id:orderId,refunded_at:occurredAt,earned_at:earnedAt}=row??{};
      const amount=monetaryValue(row?.amount);
      const earnedReversed=monetaryValue(row?.earned_reversed);
      if(typeof orderId!=="string"||!orderId||refundedIds.has(orderId)||orderIds.has(orderId)||
         amount===null||amount<=0||typeof occurredAt!=="string"||!occurredAt||
         (row?.earned_reversed!==undefined&&(earnedReversed===null||earnedReversed<0))||
         (earnedAt!=null&&typeof earnedAt!=="string"))
        throw Error("Сервер вернул неверную запись возврата.");
      refundedIds.add(orderId);
      return {orderId,amount,occurredAt,earnedReversed,earnedAt:earnedAt??null};
    });
    if(snapshot.holds!==undefined&&!Array.isArray(snapshot.holds))
      throw Error("Сервер вернул неверный список операций на сверке.");
    const heldIds=new Set();
    const holds=(snapshot.holds??[]).map(row=>{
      const {order_id:orderId,order_number:orderNumber,payroll_on_hold:payrollOnHold,
        cash_on_hold:cashOnHold,reason}=row??{};
      const heldEarned=monetaryValue(row?.earned_amount),credited=monetaryValue(row?.credited_amount);
      const linkedRecorded=monetaryValue(row?.linked_recorded_amount),paymentAmount=monetaryValue(row?.payment_amount);
      if(typeof orderId!=="string"||!orderId||heldIds.has(orderId)||refundedIds.has(orderId)||
         typeof payrollOnHold!=="boolean"||typeof cashOnHold!=="boolean"||!(payrollOnHold||cashOnHold)||
         typeof reason!=="string"||!reason.trim()||
         (payrollOnHold&&(orderIds.has(orderId)||[heldEarned,credited,linkedRecorded].some(n=>n===null||n<0)||credited>heldEarned))||
         (cashOnHold&&(paymentAmount===null||paymentAmount<=0)))
        throw Error("Сервер вернул неверную запись на сверке.");
      heldIds.add(orderId);
      return {orderId,orderNumber:orderNumber??null,payrollOnHold,cashOnHold,reason,
        earned:heldEarned,credited,linkedRecorded,paymentAmount};
    });
    if(accounting.accounting){
      const receiptsByOrder=new Map(accounting.accounting.receipts.map(row=>[row.orderId,row]));
      for(const refund of refunds)
        if(receiptsByOrder.get(refund.orderId)?.amount!==refund.amount)
          throw Error("Сервер вернул возврат без соответствующего поступления.");
      for(const order of orders){
        const receipt=receiptsByOrder.get(order.orderId);
        if(!receipt||receipt.amount!==order.actualPaid||receipt.masterId!==masterId)
          throw Error("Сервер вернул начисление без соответствующего поступления.");
      }
    }
    return {version,state,masterId,activatedAt,earned,paid,due,orders,payouts,refunds,holds,...accounting};
  }
  async function readPayrollSnapshot(dbRequest){
    let snapshot;
    try{snapshot=await dbRequest("rpc/rabota_payroll_snapshot_v3","GET");}
    catch(error){
      if(error?.code==="PGRST202"||(error?.code==="42883"&&
        /function\s+(?:(?:public|"public")\.)?"?rabota_payroll_snapshot_v3"?\(\)\s+does not exist/i.test(
          error.upstreamMessage||error.message||"")))return null;
      throw error;
    }
    return normalizePayrollSnapshot(snapshot);
  }
  function calculateRecordedCashFlow({payroll,operations=[],manualEntries=[]}){
    const account=payroll?.accounting;
    if(payroll?.state!=="active"||account?.version!==1||!Array.isArray(account.payouts))return null;
    const {receipts,payouts}=account;
    const receiptByOrder=new Map(receipts.map(row=>[row.orderId,row]));
    const payrollByOrder=new Map(payroll.orders.map(row=>[row.orderId,row]));
    const heldOrders=new Set(payroll.holds.filter(row=>row.payrollOnHold).map(row=>row.orderId));
    const refunds=(account.refunds??payroll.refunds).map(refund=>({
      ...refund,method:receiptByOrder.get(refund.orderId).method
    }));
    const refundedOrders=new Set(refunds.map(row=>row.orderId));
    const receiptByMethod={cash:0,card:0,unknown:0},refundByMethod={cash:0,card:0,unknown:0};
    const method=row=>row.method==="cash"||row.method==="card"?row.method:"unknown";
    for(const row of receipts)receiptByMethod[method(row)]=roundMoney(receiptByMethod[method(row)]+row.amount);
    for(const row of refunds)refundByMethod[method(row)]=roundMoney(refundByMethod[method(row)]+row.amount);
    const netReceiptByMethod={
      cash:roundMoney(receiptByMethod.cash-refundByMethod.cash),
      card:roundMoney(receiptByMethod.card-refundByMethod.card),
      unknown:roundMoney(receiptByMethod.unknown-refundByMethod.unknown)
    };
    const orderShares=[];
    for(const receipt of receipts){
      if(refundedOrders.has(receipt.orderId))continue;
      const projection=payrollByOrder.get(receipt.orderId);
      const companyShare=heldOrders.has(receipt.orderId)?null:
        projection?.companyShare??(receipt.masterId===payroll.masterId?null:receipt.amount);
      orderShares.push({orderId:receipt.orderId,companyShare,
        payrollCost:companyShare===null?null:roundMoney(receipt.amount-companyShare)});
    }
    const expenses=[];
    for(const row of new Map(operations.map(operation=>[operation.id,operation])).values()){
      if(row.kind!=="expense")continue;
      const amount=monetaryValue(row.amount);
      if(!row.id||amount===null||amount<=0)throw Error("Некорректная запись расхода.");
      expenses.push({id:row.id,amount,method:row.payment_method??null,occurredAt:row.created_at??null,
        voidedAt:row.voided_at??null,note:row.note??""});
    }
    let manualIncome=0,manualExpense=0;
    const manual=[];
    for(const row of new Map(manualEntries.map(entry=>[entry.id,entry])).values()){
      const amount=monetaryValue(row.amount);
      if(!row.id||amount===null||amount<=0||!["income","expense","transfer"].includes(row.kind))
        throw Error("Некорректная запись учётной кассы.");
      manual.push({id:row.id,kind:row.kind,amount,from:row.from_account??null,to:row.to_account??null,
        occurredAt:row.created_at??null,note:row.note??""});
      if(row.kind==="income")manualIncome=roundMoney(manualIncome+amount);
      if(row.kind==="expense")manualExpense=roundMoney(manualExpense+amount);
    }
    const receiptTotal=roundMoney(sumBy(receipts,row=>row.amount));
    const refundTotal=roundMoney(sumBy(refunds,row=>row.amount));
    const netReceiptTotal=roundMoney(receiptTotal-refundTotal);
    const payoutTotal=roundMoney(sumBy(payouts,row=>row.amount));
    const expenseTotal=roundMoney(sumBy(expenses,row=>row.voidedAt?0:row.amount));
    const companyShare=roundMoney(sumBy(orderShares,row=>row.companyShare));
    const unverifiedMarginCount=orderShares.filter(row=>row.companyShare===null).length;
    return {
      receipts,refunds,payouts,expenses,manualEntries:manual,orderShares,
      receiptTotal,refundTotal,netReceiptTotal,receiptByMethod,netReceiptByMethod,payoutTotal,expenseTotal,
      manualIncome,manualExpense,recordedNet:roundMoney(netReceiptTotal+manualIncome-payoutTotal-expenseTotal-manualExpense),
      companyShare,companyProfit:roundMoney(companyShare-expenseTotal-manualExpense),
      unverifiedMarginCount
    };
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
       typeof deps.getRole!=="function"||
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
          for(const row of page){
            if(typeof row?.id!=="string"||!row.id)throw Error("Сервер вернул неверную финансовую операцию.");
            rows.set(row.id,row);
          }
          if(page.length<1000)return [...rows.values()];
        }
        throw Error("История финансовых операций превышает лимит загрузки.");
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
      let operations;
      try{
        operations=currentRole==="owner"?(await (providedOperations||readOperations({fresh}))):[];
      }catch(error){
        if(current())throw error;
        return;
      }
      if(!current())return;
      const snapshot={operations};
      deps.onSnapshot?.(snapshot);
      return snapshot;
    }
    return {loadFinance,readOperations,resetOperations,readPayrollSnapshot:()=>readPayrollSnapshot(deps.dbRequest),
      calculateRecordedCashFlow,money,sumBy,roundMoney,payrollSplitV3,fullyPaidAmount};
  }
  if(root){root.__rdCreateFinanceModel=createFinanceModel;root.__rdCreateFinanceReader=createFinanceReader;}
  if(typeof module!=="undefined"&&module.exports)
    module.exports={createFinanceModel,createFinanceReader,money,sumBy,roundMoney,payrollSplitV3,fullyPaidAmount,
      normalizePayrollSnapshot,readPayrollSnapshot,calculateRecordedCashFlow};
})(typeof window!=="undefined"?window:null);
