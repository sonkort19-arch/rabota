/* CRM «Работа» — общие сервисы, этап 9.
 * Supabase transport and pure display/error helpers only.
 * Session lifecycle, token refresh, RLS, RPC and business decisions remain unchanged.
 */
"use strict";
(function(root){
  function phoneForDisplay(phone){return String(phone||"").trim();}
  function normalizePhone(phone){
    let number=String(phone||"").replace(/\D/g,"");
    if(number.length===11&&number[0]==="8")number="7"+number.slice(1);
    if(number.length===10)number="7"+number;
    return number.length>=10&&number.length<=15?number:"";
  }
  function friendlyError(error){
    if(error&&error.code==="23505")return "В это время у выбранного мастера уже есть заказ либо запись дублируется.";
    return error instanceof Error?error.message:String(error);
  }
  function createSharedServices(deps){
    if(!deps||typeof deps.url!=="string"||!deps.url.startsWith("https://")||
      typeof deps.key!=="string"||
      typeof deps.getSession!=="function"||
      typeof deps.ensureSession!=="function"||
      typeof deps.fetch!=="function")
      throw new TypeError("Неверные зависимости сетевого сервиса");
    const SUPABASE_URL=deps.url;
    const SUPABASE_KEY=deps.key;
    const requestFetch=deps.fetch;
    const getSession=deps.getSession;
    const ensureSession=deps.ensureSession;

    async function authRequest(path,method,payload,authenticated){
      const session=getSession();
      const headers={apikey:SUPABASE_KEY,"Content-Type":"application/json"};
      if(authenticated&&session&&session.access_token)
        headers.Authorization="Bearer "+session.access_token;
      const response=await requestFetch(SUPABASE_URL+"/auth/v1/"+path,{
        method:method||"GET",headers,body:payload?JSON.stringify(payload):undefined
      });
      const value=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(value.msg||value.error_description||value.message||value.error||"Ошибка авторизации");
      return value;
    }
    async function dbRequest(path,method,payload){
      await ensureSession();
      const session=getSession();
      const headers={apikey:SUPABASE_KEY,Authorization:"Bearer "+session.access_token,Accept:"application/json"};
      if(payload!==undefined)headers["Content-Type"]="application/json";
      if(method!=="GET")headers.Prefer="return=representation";
      const response=await requestFetch(SUPABASE_URL+"/rest/v1/"+path,{
        method,headers,body:payload===undefined?undefined:JSON.stringify(payload)
      });
      const value=await response.json().catch(()=>null);
      if(!response.ok){
        const err=new Error(value&&(value.message||value.error)||"Ошибка базы данных ("+response.status+")");
        err.code=value&&value.code;
        throw err;
      }
      return value;
    }
    return {authRequest,dbRequest,phoneForDisplay,normalizePhone,friendlyError};
  }
  if(root)root.__rdCreateSharedServices=createSharedServices;
  if(typeof module!=="undefined"&&module.exports)
    module.exports={createSharedServices,phoneForDisplay,normalizePhone,friendlyError};
})(typeof window!=="undefined"?window:null);
