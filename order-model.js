/* CRM «Работа»: модель заявок и записи в Supabase.
 * Extracted from index.html in stage 3, without business-rule changes.
 * Database authorization and final booking constraints remain in Supabase.
 */
"use strict";
(function(root){
  // Display-only rendering of the database-assigned unique order_number.
  // UUID remains the relational key for RPCs, payments and authorization.
  const orderReference={
    code(orderNumber){
      if(orderNumber==null||orderNumber==="")return "";
      const number=Number(orderNumber);
      if(!Number.isSafeInteger(number)||number<1||number>99999)return "";
      return "№"+String(number).padStart(5,"0");
    },
    normalize(query){
      return String(query||"").trim().replace(/^[№#]\s*/,"").toLocaleLowerCase("ru-RU");
    },
    createRow(orderNumber,doc){
      const code=this.code(orderNumber);
      if(!code||!doc)return null;
      const row=doc.createElement("div");
      row.className="rd-order-reference-row";
      const value=doc.createElement("span");
      value.className="rd-order-reference-value";
      value.textContent="Код заказа "+code;
      const copy=doc.createElement("button");
      copy.type="button";
      copy.className="rd-order-reference-copy";
      copy.textContent="Копировать";
      copy.setAttribute("aria-label","Скопировать код заказа "+code);
      copy.addEventListener("click",async()=>{
        if(copy.disabled)return;
        copy.disabled=true;
        try{
          if(!navigator.clipboard?.writeText)throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(code);
          copy.textContent="Скопировано";
        }catch(error){
          copy.textContent="Не удалось скопировать";
        }finally{copy.disabled=false;}
      });
      row.append(value,copy);
      return row;
    }
  };
  function payableAmount(value){
    if(typeof value!=="number"&&typeof value!=="string")return null;
    const amount=Number(value);
    return Number.isFinite(amount)&&amount>0&&amount<=10000000&&
      Math.round(amount*100)/100===amount?amount:null;
  }
  function createOrdersModel(deps){
    if(!deps||!Array.isArray(deps.statuses)||
       typeof deps.dbRequest!=="function"||typeof deps.reloadOrders!=="function"||
       typeof deps.getOrders!=="function"||typeof deps.getCurrentUserId!=="function"||
       typeof deps.getFinanceOperations!=="function"||typeof deps.getFinanceCollections!=="function"){
      throw new TypeError("Неверные зависимости модуля заказов");
    }
    const STATUSES=deps.statuses;
    const dbRequest=deps.dbRequest;
    const reloadOrders=deps.reloadOrders;
    const getOrders=deps.getOrders;
    const getCurrentUserId=deps.getCurrentUserId;
    const getFinanceOperations=deps.getFinanceOperations;
    const getFinanceCollections=deps.getFinanceCollections;
    const paymentAttempts=new Map(),unconfirmedPayments=new Set(),confirmedPayments=new Map();
    const refundAttempts=new Map();
    let paymentGeneration=0;

function readOrder(row) {
      return {
        id: row.id, orderNumber:row.order_number??null,
         referenceCode:orderReference.code(row.order_number), createdAt: row.created_at, leadId:row.lead_id||null,
        completedAt: row.completed_at, legacyId: row.legacy_id,
        name:row.name || "",phone:row.phone || "",address:row.address || "",
        clientSource:row.client_source || "",
        radiatorType:row.radiator_type || "",radiators:row.radiators == null ? "" : row.radiators,
        floorLoops:row.floor_loops == null ? "" : row.floor_loops,
        master:row.master || "",date:row.appointment_date || "",
        time:row.appointment_time ? row.appointment_time.slice(0,5) : "",
        price:row.price == null ? null : Number(row.price),assignedUserId:row.assigned_user_id || null,
        paid:Boolean(row.paid),status:row.status || "Записан",details:row.details || "",
        paymentMethod:row.payment_method||"",paymentAmount:row.payment_amount==null?null:Number(row.payment_amount),
        paymentReceivedBy:row.payment_received_by||"",paidAt:row.paid_at||null,paidBy:row.paid_by||null
      };
    }

function serializeOrder(order) {
      const obj = {
        name:String(order.name || "").trim(),phone:String(order.phone || "").trim(),
        address:String(order.address || ""),client_source:String(order.clientSource || "").slice(0,40),
        radiator_type:order.radiatorType || "",
        radiators:order.radiators === "" || order.radiators == null ? null : Number(order.radiators),
        floor_loops:order.floorLoops === "" || order.floorLoops == null ? null : Number(order.floorLoops),
        master:order.master || "", appointment_date:order.date || null,
        appointment_time:order.time || null,
        price:order.price === "" || order.price == null ? null : Number(order.price),
        paid:Boolean(order.paid),status:STATUSES.includes(order.status) ? order.status : "Записан",
        details:order.details || "",completed_at:order.completedAt || null,
        updated_at:new Date().toISOString()
      };
      if (order.paymentMethod && order.paid) {
        obj.payment_method=order.paymentMethod;
        obj.payment_amount=order.paymentAmount??order.price;
        obj.payment_received_by=order.paymentReceivedBy||"company";
        obj.paid_at=order.paidAt||new Date().toISOString();
        obj.paid_by=order.paidBy||getCurrentUserId();
      }
      if (order.legacyId) obj.legacy_id = order.legacyId;
      if (order.leadId) obj.lead_id = order.leadId;
      return obj;
    }

function orderHasFinancialHistory(order){
      if(!order)return false;
      return Boolean(order.paid||order.paymentMethod||order.paymentAmount!=null||
        order.paymentReceivedBy||order.paidAt||order.paidBy||
        getFinanceOperations().some(row=>String(row.order_id)===String(order.id))||
        getFinanceCollections().some(row=>String(row.order_id)===String(order.id)));
    }

async function persistOrder(order,{refresh=true}={}) {
      const existing = getOrders().some(o => String(o.id) === String(order.id));
      const data = serializeOrder(order);
      const path=existing?"rabota_orders?id=eq."+encodeURIComponent(order.id):"rabota_orders";
      const result=await dbRequest(path,existing?"PATCH":"POST",data);
      if(!Array.isArray(result)||!result.length)
        throw new Error(existing?"Заказ не обновлён.":"Заказ не сохранён.");
      const orderId=result[0]?.id??null;
      if(!refresh)return {orderId,refreshError:null};
      // A rejected read after an acknowledged write can only fail the refresh.
      try{
        await reloadOrders();
        return {orderId,refreshError:null};
      }catch(refreshError){
        return {orderId,refreshError};
      }
    }

    function resetPaymentAttempts(){
      paymentGeneration++;
      paymentAttempts.clear();
      unconfirmedPayments.clear();
      confirmedPayments.clear();
      refundAttempts.clear();
    }
    function recordFullPayment(order,{amount,method},receiver){
      const id=String(order?.id??""),expected=payableAmount(order?.price),actor=getCurrentUserId();
      if(!id||!actor)throw new Error("Перед оплатой сохраните заказ и войдите в CRM.");
      if(order.status==="Отменён")throw new Error("Отменённый заказ нельзя оплатить.");
      if(expected===null||payableAmount(amount)!==expected)
        throw new Error("Оплатить можно только полную сохранённую стоимость заказа.");
      if(!["cash","card"].includes(method)||!["company","master"].includes(receiver))
        throw new Error("Не указан допустимый способ или получатель оплаты.");
      const key=JSON.stringify([actor,expected,method,receiver]);
      if(confirmedPayments.has(id)){
        if(confirmedPayments.get(id)===key)return Promise.resolve();
        throw new Error("Оплата уже записана с другими реквизитами.");
      }
      const pending=paymentAttempts.get(id);
      if(pending){
        if(pending.key===key)return pending.promise;
        throw new Error("Подождите завершения предыдущей операции с оплатой.");
      }
      const generation=paymentGeneration;
      const ensureAccount=()=>{
        if(generation!==paymentGeneration||actor!==getCurrentUserId())
          throw new Error("Сеанс изменился. Проверьте оплату в заказе.");
      };
      const readReceipt=async()=>{
        const rows=await dbRequest(
          "rabota_orders?select=id,status,price,paid,payment_amount,payment_method,payment_received_by,paid_by&id=eq."+
          encodeURIComponent(id)+"&limit=1","GET");
        ensureAccount();
        const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
        if(!row||String(row.id)!==id)throw new Error("Не удалось проверить запись оплаты.");
        if(row.paid===false&&row.payment_amount==null)return false;
        if(row.paid===true&&row.status==="Выполнен"&&payableAmount(row.price)===expected&&
          payableAmount(row.payment_amount)===expected&&row.payment_method===method&&
          row.payment_received_by===receiver&&row.paid_by===actor)return true;
        throw new Error("В заказе уже есть платёж с другими реквизитами. Проверьте карточку.");
      };
      const attempt={key,promise:null};
      attempt.promise=(async()=>{
        if(unconfirmedPayments.has(id)){
          const recorded=await readReceipt();
          unconfirmedPayments.delete(id);
          if(recorded){
            confirmedPayments.set(id,key);
            return;
          }
        }
        try{
          const result=await dbRequest("rpc/rabota_record_order_payment","POST",{
            p_order_id:id,p_amount:expected,p_method:method
          });
          ensureAccount();
          if(result?.ok!==true)throw new Error("Сервер не подтвердил запись оплаты.");
          confirmedPayments.set(id,key);
        }catch(error){
          ensureAccount();
          // A 4xx rejection is conclusive except for a request timeout.
          if(error.status>=400&&error.status<500&&error.status!==408)throw error;
          unconfirmedPayments.add(id);
          if(await readReceipt()){
            unconfirmedPayments.delete(id);
            confirmedPayments.set(id,key);
            return;
          }
          throw new Error("Запись оплаты не подтверждена. Проверьте заказ перед повтором.");
        }
      })().finally(()=>{
        if(paymentAttempts.get(id)===attempt)paymentAttempts.delete(id);
      });
      paymentAttempts.set(id,attempt);
      return attempt.promise;
    }

    function recordFullRefund(order,note){
      const id=String(order?.id??""),amount=payableAmount(order?.paymentAmount),actor=getCurrentUserId();
      if(!id||!actor||order.paid!==true||order.status!=="Выполнен"||
        amount===null||amount!==payableAmount(order.price)||order.paymentReceivedBy!=="company")
        throw new Error("Можно учесть только полный возврат по завершённому заказу, оплаченному компании.");
      note=String(note??"").trim();
      if(!note||Array.from(note).length>240)throw new Error("Укажите причину возврата до 240 символов.");
      let attempt=refundAttempts.get(id);
      if(attempt){
        if(attempt.actor!==actor||attempt.note!==note||attempt.amount!==amount)
          throw new Error("Повторите проверку возврата с теми же реквизитами.");
        if(attempt.receipt)return Promise.resolve(attempt.receipt);
        if(attempt.promise)return attempt.promise;
      }else{
        attempt={requestId:crypto.randomUUID(),actor,note,amount,promise:null,receipt:null};
        refundAttempts.set(id,attempt);
      }
      const generation=paymentGeneration;
      attempt.promise=Promise.resolve().then(async()=>{
        try{
          if(generation!==paymentGeneration||actor!==getCurrentUserId())
            throw new Error("Сеанс изменился. Проверьте возврат в заказе.");
          const receipt=await dbRequest("rpc/rabota_payroll_refund_v3","POST",{
            p_order_id:id,p_amount:amount,p_note:note,p_request_id:attempt.requestId
          });
          if(generation!==paymentGeneration||actor!==getCurrentUserId())
            throw new Error("Сеанс изменился. Проверьте возврат в заказе.");
          if(String(receipt?.order_id)!==id||payableAmount(receipt.amount)!==amount||!receipt.refunded_at)
            throw new Error("Сервер пока не подтвердил возврат. Проверьте его с теми же реквизитами.");
          attempt.receipt=receipt;
          return receipt;
        }catch(error){
          if(generation===paymentGeneration&&error.status>=400&&error.status<500&&error.status!==408)
            refundAttempts.delete(id);
          throw error;
        }
      }).finally(()=>{attempt.promise=null;});
      return attempt.promise;
    }

function hasConflict(date, time, master, excludeId) {
      const selectedMaster=String(master||"").trim().toLocaleLowerCase("ru");
      return getOrders().some(order => String(order.id) !== String(excludeId) &&
        order.status !== "Отменён" && order.date === date && order.time === time &&
        String(order.master||"").trim().toLocaleLowerCase("ru") === selectedMaster);
    }

function findTightBookings(date,time,master,excludeId) {
      const minutes=t=>{
        const p=String(t||"").split(":");
        return p.length>=2 ? Number(p[0])*60+Number(p[1]) : NaN;
      };
      const target=minutes(time),name=String(master||"").trim().toLowerCase();
      if(!date||!Number.isFinite(target)||!name)return [];
      return getOrders().filter(o=>
        String(o.id)!==String(excludeId) && o.status!=="Отменён" &&
        o.date===date && String(o.master||"").trim().toLowerCase()===name &&
        Number.isFinite(minutes(o.time)) && Math.abs(minutes(o.time)-target)<200);
    }

    return {readOrder,serializeOrder,orderHasFinancialHistory,persistOrder,recordFullPayment,recordFullRefund,
      resetPaymentAttempts,hasConflict,findTightBookings};
  }

  if(root){
    root.__rdCreateOrdersModel=createOrdersModel;root.__rdOrderReference=orderReference;
    root.__rdPayableOrderAmount=payableAmount;
  }
  if(typeof module!=="undefined"&&module.exports)module.exports={createOrdersModel,orderReference,payableAmount};
})(typeof window!=="undefined"?window:null);
