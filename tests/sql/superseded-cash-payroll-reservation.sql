-- Reserve automatic payroll from already received master-held cash.
-- Accrued salaries and the 50% / 1500 ₽ split are unchanged.
-- All preflight checks and DDL run in one transaction. No business rows are edited.
BEGIN;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.rabota_cash_distribute(uuid)', '1189510649976d91381a4ed9317860b2'),
      ('public.rabota_finance_record(text,numeric,uuid,text)', '029b7512dd4b66149b0018e03d652afa'),
      ('public.rabota_salary_payout_v2(text,numeric,text,text,uuid,uuid)', 'e6ef6c66a77a7fb4b3c05139d6c4ab0f')
    ) AS baseline(signature, source_md5)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(baseline.signature)
    WHERE pg_catalog.md5(p.prosrc) IS DISTINCT FROM baseline.source_md5
      OR p.proowner IS DISTINCT FROM CURRENT_USER::regrole::oid
      OR NOT p.prosecdef
      OR ('search_path=""'=ANY(p.proconfig)) IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Rabota payroll RPCs differ from reviewed definitions. Re-audit before applying.';
  END IF;
END;
$preflight$;

-- The caller must hold the matching rabota_members row lock while changing
-- payroll. Use one statement snapshot for orders, distributions and the ledger.
CREATE FUNCTION private.rabota_manual_payroll_capacity(p_master_user_id uuid)
RETURNS TABLE(raul_available numeric, timur_available numeric)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $capacity$
  WITH payable_orders AS (
    SELECT o.price FROM public.rabota_orders o
    WHERE o.assigned_user_id=p_master_user_id AND o.status='Выполнен' AND o.paid
      AND (
        o.price>3000 AND o.payment_method='cash' AND o.payment_received_by='master'
        AND NOT EXISTS (
          SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id
        )
      ) IS NOT TRUE
  ), payable AS (
    SELECT coalesce(sum(round(price*0.5,2)),0) AS raul, count(*)*1500 AS timur
    FROM payable_orders
  ), recorded AS (
    SELECT coalesce(sum(amount) FILTER (WHERE kind='raul_payout'),0) AS raul,
           coalesce(sum(amount) FILTER (WHERE kind='timur_payout'),0) AS timur
    FROM public.rabota_finance_operations
    WHERE master_user_id=p_master_user_id AND voided_at IS NULL
      AND kind IN ('raul_payout','timur_payout')
  )
  SELECT payable.raul-recorded.raul, payable.timur-recorded.timur FROM payable,recorded;
$capacity$;

REVOKE ALL ON FUNCTION private.rabota_manual_payroll_capacity(uuid)
FROM PUBLIC,anon,authenticated;

-- An older ledger may already contain manual payouts backed by undistributed
-- cash. Its manual entries have no order IDs, so this migration cannot choose
-- which transactions to reconcile. Check it while holding the existing payout
-- lock to avoid basing activation on concurrent manual writes.
DO $existing_payroll$
BEGIN
  PERFORM 1 FROM public.rabota_members
  WHERE active AND role='master' AND lower(btrim(master_name))='рауль'
  ORDER BY user_id FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM public.rabota_members m
    CROSS JOIN LATERAL private.rabota_manual_payroll_capacity(m.user_id) AS cap
    WHERE m.active AND m.role='master' AND lower(btrim(m.master_name))='рауль'
      AND (cap.raul_available<0 OR cap.timur_available<0)
      AND EXISTS (
        SELECT 1 FROM public.rabota_orders o
        WHERE o.assigned_user_id=m.user_id AND o.status='Выполнен' AND o.paid
          AND o.price>3000 AND o.payment_method='cash' AND o.payment_received_by='master'
          AND NOT EXISTS (
            SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id
          )
      )
  ) THEN
    RAISE EXCEPTION 'Есть нераспределённые наличные и ручные выплаты в том же балансе. Нужна сверка перед включением защиты.';
  END IF;
END;
$existing_payroll$;

CREATE OR REPLACE FUNCTION public.rabota_cash_distribute(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_order public.rabota_orders%rowtype;
 v_raul numeric(12,2);
 v_company numeric(12,2);
 v_capacity record;
 v_timur constant numeric(12,2):=1500;
begin
 if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'master' then
  raise exception 'Доступ разрешён только мастеру';
 end if;
 -- Serialize automatic allocation with both owner payout RPCs.
 perform 1 from public.rabota_members
 where user_id=auth.uid() and role='master' and active=true
   and lower(btrim(master_name))='рауль'
 for update;
 if not found then
  raise exception 'Доступ к распределению не предоставлен';
 end if;
 select * into v_order from public.rabota_orders where id=p_order_id for update;
 if not found or v_order.assigned_user_id is distinct from auth.uid() then
  raise exception 'Заказ не назначен этому мастеру';
 end if;
 if v_order.status not in ('В работе','Выполнен') then
  raise exception 'Сначала примите заказ в работу';
 end if;
 if v_order.price is null or v_order.price<=3000 then
  raise exception 'Недостаточная сумма заказа для распределения. Обратитесь к администратору';
 end if;
 if v_order.paid and (v_order.payment_method is distinct from 'cash' or v_order.payment_received_by is distinct from 'master') then
  raise exception 'Распределение наличных недоступно для этого способа оплаты';
 end if;
 if exists(select 1 from public.rabota_cash_collections c where c.order_id=p_order_id) then
  raise exception 'Распределение уже записано';
 end if;
 -- A settled cash job that still awaits distribution already participates
 -- in accruals. Prevent an automatic payout if prior ledger entries already
 -- occupy reserved amounts. Manual entries do not identify specific orders.
 if v_order.paid and v_order.status='Выполнен' then
  select * into v_capacity from private.rabota_manual_payroll_capacity(auth.uid());
  if v_capacity.raul_available<0 or v_capacity.timur_available<0 then
   raise exception 'Перед распределением владелец должен сверить ранее проведённые выплаты'
    using errcode='23514';
  end if;
 end if;
 v_raul:=round(v_order.price*0.5,2);
 v_company:=v_order.price-v_raul-v_timur;
 perform pg_catalog.set_config('rabota.order_payment_intent','cash:'||p_order_id::text,true);
 update public.rabota_orders
 set status='Выполнен',paid=true, completed_at=coalesce(v_order.completed_at,now()),
   payment_method=coalesce(v_order.payment_method,'cash'),
   payment_amount=coalesce(v_order.payment_amount,v_order.price),
   payment_received_by=coalesce(v_order.payment_received_by,'master'),
   paid_at=coalesce(v_order.paid_at,now()),paid_by=coalesce(v_order.paid_by,auth.uid()),
   updated_at=now()
 where id=p_order_id;
 perform pg_catalog.set_config('rabota.order_payment_intent','',true);
 insert into public.rabota_cash_collections(
  order_id,master_user_id,gross,raul_amount,timur_amount,company_amount
 ) values (p_order_id,auth.uid(),v_order.price,v_raul,v_timur,v_company);
 insert into public.rabota_finance_operations(kind,amount,master_user_id,note,created_by,order_id)
 values
  ('raul_payout',v_raul,auth.uid(),'Рауль забрал долю за заказ '||coalesce(v_order.name,'клиента'),auth.uid(),p_order_id),
  ('timur_payout',v_timur,auth.uid(),'Тимуру выдано за заказ '||coalesce(v_order.name,'клиента'),auth.uid(),p_order_id);
 return jsonb_build_object('ok',true,'raul',v_raul,'timur',v_timur,'company',v_company,'completed',true);
end $function$;

CREATE OR REPLACE FUNCTION public.rabota_finance_record(p_kind text, p_amount numeric, p_master_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_available numeric;
  v_kind text := btrim(coalesce(p_kind,''));
  v_note text := btrim(coalesce(p_note,''));
begin
  if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
    raise exception 'Только администратор может проводить финансовые операции';
  end if;
  if v_kind not in ('raul_payout','timur_payout','expense') then
    raise exception 'Неверный тип операции';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000000 or round(p_amount,2)<>p_amount then
    raise exception 'Укажите корректную сумму';
  end if;
  if char_length(v_note)>240 then
    raise exception 'Примечание слишком длинное';
  end if;
  if v_kind <> 'expense' then
    if p_master_user_id is null then
      raise exception 'Не выбран мастер';
    end if;
    perform 1 from public.rabota_members m
      where m.user_id=p_master_user_id and m.role='master'
        and m.active=true and lower(btrim(m.master_name))='рауль'
      for update;
    if not found then raise exception 'Подключённый мастер Рауль не найден'; end if;

    select case when v_kind='raul_payout' then cap.raul_available else cap.timur_available end
      into v_available from private.rabota_manual_payroll_capacity(p_master_user_id) cap;
    if v_available < p_amount then
      raise exception 'Сумма больше доступной для ручной выплаты. Доступно: % ₽',greatest(0,v_available)
        using errcode='23514';
    end if;
  else
    p_master_user_id:=null;
  end if;

  insert into public.rabota_finance_operations(kind,amount,master_user_id,note,created_by)
  values(v_kind,p_amount,p_master_user_id,v_note,auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

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
 v_available numeric;
 v_existing public.rabota_finance_operations%rowtype;
 v_id uuid;
 v_note text:=btrim(coalesce(p_note,''));
begin
 if v_actor is null then raise exception 'Нужно войти в аккаунт'; end if;
 v_role:=(select private.rabota_my_role());
 if v_role is distinct from 'owner' then
  raise exception 'Зарплатные выплаты может проводить только владелец' using errcode='42501';
 end if;
 if p_kind not in ('raul_payout','timur_payout') then raise exception 'Недопустимый вид выплаты'; end if;
 if p_payment_method not in ('cash','card') then raise exception 'Выберите наличные или карту'; end if;
 if p_request_id is null then raise exception 'Не указан идентификатор операции'; end if;
 if p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) then
  raise exception 'Некорректная сумма выплаты';
 end if;
 if length(v_note)<1 or length(v_note)>240 then raise exception 'Укажите комментарий до 240 символов'; end if;
 -- Only the owner authorizes payout ledger changes. The master may read
 -- accruals and salary history but cannot mark a payment as received.
 v_master:=p_master_user_id;
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
 select case when p_kind='raul_payout' then cap.raul_available else cap.timur_available end
  into v_available from private.rabota_manual_payroll_capacity(v_master) cap;
 if v_available < p_amount then
  raise exception 'Сумма больше доступной для ручной выплаты. Доступно: % ₽',greatest(0,v_available)
   using errcode='23514';
 end if;
 insert into public.rabota_finance_operations
  (kind,amount,master_user_id,note,created_by,payment_method,request_id)
 values(p_kind,p_amount,v_master,v_note,v_actor,p_payment_method,p_request_id)
 returning id into v_id;
 return v_id;
end $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
