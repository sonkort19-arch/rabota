-- Disposable PostgreSQL 17 fixture: synthetic users, artificial payments only.
-- Reuses reviewed stage-1 fixture. NEVER apply to a Supabase project.
\set ON_ERROR_STOP on
\i tests/sql/paid-guard-fixture.sql
ALTER TABLE public.rabota_finance_operations ADD COLUMN payment_method text;
ALTER TABLE public.rabota_finance_operations ADD COLUMN request_id uuid UNIQUE;
CREATE OR REPLACE FUNCTION public.rabota_salary_payout_v2(p_kind text, p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=auth.uid();
 v_role text;
 v_master uuid;
 v_accrued numeric(14,2);
 v_paid numeric(14,2);
 v_existing public.rabota_finance_operations%rowtype;
 v_id uuid;
 v_note text:=btrim(coalesce(p_note,''));
begin
 if v_actor is null then raise exception 'Нужно войти в аккаунт'; end if;
 v_role:=(select private.rabota_my_role());
 if v_role not in ('owner','master') then raise exception 'Нет доступа к зарплате'; end if;
 if p_kind not in ('raul_payout','timur_payout') then raise exception 'Недопустимый вид выплаты'; end if;
 if p_payment_method not in ('cash','card') then raise exception 'Выберите наличные или карту'; end if;
 if p_request_id is null then raise exception 'Не указан идентификатор операции'; end if;
 if p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) then
  raise exception 'Некорректная сумма выплаты';
 end if;
 if length(v_note)<1 or length(v_note)>240 then raise exception 'Укажите комментарий до 240 символов'; end if;
 if v_role='master' then
  if p_kind<>'raul_payout' or (p_master_user_id is not null and p_master_user_id<>v_actor) then
    raise exception 'Мастер может получать только собственную зарплату';
  end if;
  v_master:=v_actor;
 else
  v_master:=p_master_user_id;
 end if;
 if v_master is null then raise exception 'Не выбран мастер'; end if;
 -- Same lock as existing owner payout RPC: serializes concurrent payouts.
 perform 1 from public.rabota_members m where m.user_id=v_master and m.role='master'
  and m.active=true and lower(btrim(m.master_name))='рауль' for update;
 if not found then raise exception 'Мастер Рауль не найден или не активен'; end if;
 select * into v_existing from public.rabota_finance_operations where request_id=p_request_id;
 if found then
  if v_existing.created_by<>v_actor or v_existing.master_user_id<>v_master
     or v_existing.kind<>p_kind or v_existing.amount<>p_amount
     or v_existing.payment_method<>p_payment_method then
   raise exception 'Идентификатор использован другой операцией';
  end if;
  return v_existing.id;
 end if;
 if p_kind='raul_payout' then
  select coalesce(sum(round(o.price*0.5,2)),0) into v_accrued
   from public.rabota_orders o where o.assigned_user_id=v_master and o.status='Выполнен' and o.paid=true;
 else
  select coalesce(count(*)*1500,0) into v_accrued
   from public.rabota_orders o where o.assigned_user_id=v_master and o.status='Выполнен' and o.paid=true;
 end if;
 select coalesce(sum(f.amount),0) into v_paid from public.rabota_finance_operations f
  where f.master_user_id=v_master and f.kind=p_kind and f.voided_at is null;
 if v_accrued-v_paid<p_amount then
  raise exception 'Недостаточно начислений. Доступно к выплате: % ₽', greatest(0,v_accrued-v_paid);
 end if;
 insert into public.rabota_finance_operations
  (kind,amount,master_user_id,note,created_by,payment_method,request_id)
 values(p_kind,p_amount,v_master,v_note,v_actor,p_payment_method,p_request_id)
 returning id into v_id;
 return v_id;
end $function$;
GRANT EXECUTE ON FUNCTION public.rabota_salary_payout_v2(text,numeric,text,text,uuid,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rabota_salary_payout_v2(text,numeric,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT SELECT ON public.rabota_finance_operations TO authenticated;
ALTER TABLE public.rabota_finance_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_salary_read ON public.rabota_finance_operations
 FOR SELECT TO authenticated USING (
  (SELECT private.rabota_my_role())='owner'
  OR ((SELECT private.rabota_my_role())='master'
   AND master_user_id=(SELECT auth.uid())
   AND kind IN ('raul_payout','timur_payout'))
 );
