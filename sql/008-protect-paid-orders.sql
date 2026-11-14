-- CRM "Работа": repaired PR #58 security migration (staging-only until approval).
-- Reuses verified live RPC definitions, with transaction-local intent around their
-- existing order UPDATE. No row data is modified by installing this migration.
-- Deployment prerequisite: replay against isolated PostgreSQL 17 and verify roles.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';


-- Abort before changing any function if production RPCs drift since audit.
-- This prevents replacing newer business logic with an old captured definition.
DO $preflight$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 170000
     OR pg_catalog.current_setting('server_version_num')::integer >= 180000 THEN
    RAISE EXCEPTION 'Expected PostgreSQL 17: review migration for this server';
  END IF;
  IF (
    SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.rabota_record_order_payment(uuid,numeric,text)'::pg_catalog.regprocedure
  ) IS DISTINCT FROM 'd44bada20981d77a9922fe28f383ab10'
  OR (
    SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.rabota_cash_distribute(uuid)'::pg_catalog.regprocedure
  ) IS DISTINCT FROM '75dbf74b2e70cfc6d3b73012ae66baaf' THEN
    RAISE EXCEPTION 'Rabota financial RPC changed since audit: STOP, re-audit before applying';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.rabota_orders'::pg_catalog.regclass
      AND t.tgname='rabota_cash_order_guard_trigger' AND t.tgenabled='O'
  ) THEN
    RAISE EXCEPTION 'Original cash guard missing or disabled: STOP';
  END IF;
  -- The original cash guard is part of the migration safety boundary.
  -- Merely finding the trigger is insufficient if its function was changed.
  IF (
    SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
    WHERE p.oid='private.rabota_cash_order_guard()'::pg_catalog.regprocedure
  ) IS DISTINCT FROM '27e721f9909f2ab0e7d08dcea1a3225c' THEN
    RAISE EXCEPTION 'Original cash guard source changed since audit: STOP';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.rabota_orders'::pg_catalog.regclass
      AND t.tgname='rabota_paid_order_guard_trigger'
  ) THEN
    RAISE EXCEPTION 'Paid guard already exists: do not apply same migration twice';
  END IF;
END;
$preflight$;


CREATE OR REPLACE FUNCTION public.rabota_record_order_payment(p_order_id uuid, p_amount numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.rabota_orders%rowtype;
  v_role text;
  v_receiver text;
begin
  v_role := (select private.rabota_my_role());
  if auth.uid() is null or coalesce(v_role,'') not in ('owner','manager','master') then
    raise exception 'Нет прав для оплаты заказа';
  end if;
  if p_method is null or p_method not in ('cash','card') then
    raise exception 'Выберите наличные или карту';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000000 or round(p_amount,2)<>p_amount then
    raise exception 'Укажите корректную сумму оплаты';
  end if;
  select * into v_order from public.rabota_orders where id=p_order_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_role='master' then
    if v_order.assigned_user_id is distinct from auth.uid() then
      raise exception 'Заказ назначен другому мастеру';
    end if;
    if v_order.status not in ('В работе','Выполнен') then
      raise exception 'Мастер может завершить только принятый в работу заказ';
    end if;
  end if;
  if v_order.status='Отменён' then raise exception 'Отменённый заказ нельзя оплатить'; end if;
  if v_order.paid then raise exception 'Заказ уже оплачен'; end if;
  if exists(select 1 from public.rabota_cash_collections where order_id=p_order_id) then
    raise exception 'По этому заказу уже создано финансовое распределение';
  end if;
  v_receiver := case when v_role='master' then 'master' else 'company' end;
  -- Authorize exactly this paid transition for the paired row guard.
  perform pg_catalog.set_config('rabota.order_payment_intent','payment:'||p_order_id::text,true);
  update public.rabota_orders
    set status='Выполнен', paid=true,
        price=p_amount, payment_method=p_method, payment_amount=p_amount,
        payment_received_by=v_receiver, paid_at=now(), paid_by=auth.uid(),
        completed_at=coalesce(v_order.completed_at,now()), updated_at=now()
    where id=p_order_id;
  perform pg_catalog.set_config('rabota.order_payment_intent','',true);
  return jsonb_build_object('ok',true,'amount',p_amount,'method',p_method,'receiver',v_receiver);
end $function$;

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
 v_timur constant numeric(12,2):=1500;
begin
 if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'master' then
  raise exception 'Доступ разрешён только мастеру';
 end if;
 if not exists (
  select 1 from public.rabota_members
  where user_id=auth.uid() and role='master' and active=true
    and lower(btrim(master_name))='рауль'
 ) then
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

CREATE OR REPLACE FUNCTION private.rabota_paid_order_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $guard$
DECLARE
  v_actor uuid;
  v_role text;
  v_intent text;
  v_payment_owner name;
  v_cash_owner name;
  v_structural_same boolean;
  v_payment_allowed boolean := false;
  v_cash_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- No direct REST INSERT may start a financial record as paid.
    IF NEW.paid IS TRUE OR NEW.payment_method IS NOT NULL
      OR NEW.payment_amount IS NOT NULL OR NEW.payment_received_by IS NOT NULL
      OR NEW.paid_at IS NOT NULL OR NEW.paid_by IS NOT NULL THEN
      RAISE EXCEPTION 'Оплата создаётся только через утверждённую процедуру'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.paid IS TRUE OR OLD.payment_method IS NOT NULL
      OR OLD.payment_amount IS NOT NULL OR OLD.payment_received_by IS NOT NULL
      OR OLD.paid_at IS NOT NULL OR OLD.paid_by IS NOT NULL THEN
      RAISE EXCEPTION 'Оплаченный заказ нельзя удалить'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- This guard never relies on a caller-provided role or payload flag.
  -- The short-lived intent is set only inside the verified SECURITY DEFINER RPCs.
  -- In addition, the invoking effective DB role must be the owner of that RPC.
  v_actor := (SELECT auth.uid());
  v_role := (SELECT private.rabota_my_role());
  v_intent := pg_catalog.current_setting('rabota.order_payment_intent',true);
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_payment_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.rabota_record_order_payment(uuid,numeric,text)'::pg_catalog.regprocedure;
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_cash_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.rabota_cash_distribute(uuid)'::pg_catalog.regprocedure;

  -- Client, calendar and assignment facts cannot be silently changed by
  -- a privileged payment procedure or by ordinary updates of paid rows.
  v_structural_same := ROW(
    NEW.id,NEW.name,NEW.phone,NEW.address,NEW.radiator_type,
    NEW.radiators,NEW.floor_loops,NEW.master,NEW.appointment_date,
    NEW.appointment_time,NEW.details,NEW.legacy_id,NEW.created_by,
    NEW.created_at,NEW.assigned_user_id,NEW.lead_id
  ) IS NOT DISTINCT FROM ROW(
    OLD.id,OLD.name,OLD.phone,OLD.address,OLD.radiator_type,
    OLD.radiators,OLD.floor_loops,OLD.master,OLD.appointment_date,
    OLD.appointment_time,OLD.details,OLD.legacy_id,OLD.created_by,
    OLD.created_at,OLD.assigned_user_id,OLD.lead_id
  );

  v_payment_allowed :=
    v_actor IS NOT NULL
    AND current_user = v_payment_owner
    AND v_intent = 'payment:'||OLD.id::text
    AND v_role IN ('owner','manager','master')
    AND OLD.paid IS FALSE
    AND OLD.status <> 'Отменён'
    AND OLD.payment_method IS NULL AND OLD.payment_amount IS NULL
    AND OLD.payment_received_by IS NULL AND OLD.paid_at IS NULL AND OLD.paid_by IS NULL
    AND (v_role <> 'master' OR
      (OLD.assigned_user_id = v_actor AND OLD.status IN ('В работе','Выполнен')))
    AND v_structural_same
    AND NEW.paid IS TRUE AND NEW.status = 'Выполнен'
    AND NEW.completed_at IS NOT NULL
    AND NEW.price IS NOT NULL AND NEW.price > 0 AND NEW.price <= 10000000
    AND NEW.payment_method IN ('cash','card')
    AND NEW.payment_amount = NEW.price
    AND NEW.payment_received_by =
      CASE WHEN v_role='master' THEN 'master' ELSE 'company' END
    AND NEW.paid_at IS NOT NULL AND NEW.paid_by = v_actor;

  v_cash_allowed :=
    v_actor IS NOT NULL
    AND current_user = v_cash_owner
    AND v_intent = 'cash:'||OLD.id::text
    AND v_role = 'master'
    AND OLD.assigned_user_id = v_actor
    AND OLD.status IN ('В работе','Выполнен')
    AND OLD.price IS NOT NULL AND OLD.price > 3000
    AND v_structural_same
    AND NEW.price IS NOT DISTINCT FROM OLD.price
    AND NEW.paid IS TRUE AND NEW.status = 'Выполнен'
    AND NEW.completed_at IS NOT NULL
    AND NEW.payment_method = 'cash'
    AND NEW.payment_amount = OLD.price
    AND NEW.payment_received_by = 'master'
    AND NEW.paid_at IS NOT NULL AND NEW.paid_by = v_actor
    AND NOT EXISTS (SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=OLD.id)
    AND (
      (OLD.paid IS FALSE
        AND OLD.payment_method IS NULL AND OLD.payment_amount IS NULL
        AND OLD.payment_received_by IS NULL AND OLD.paid_at IS NULL AND OLD.paid_by IS NULL)
      OR
      (OLD.paid IS TRUE AND OLD.payment_method = 'cash'
        AND OLD.payment_received_by = 'master'
        AND NEW.payment_amount = COALESCE(OLD.payment_amount,OLD.price)
        AND NEW.paid_at = COALESCE(OLD.paid_at,now())
        AND NEW.paid_by = COALESCE(OLD.paid_by,v_actor))
    );

  IF OLD.paid IS TRUE OR OLD.payment_method IS NOT NULL
    OR OLD.payment_amount IS NOT NULL OR OLD.payment_received_by IS NOT NULL
    OR OLD.paid_at IS NOT NULL OR OLD.paid_by IS NOT NULL THEN
    -- Intent alone is never sufficient: the cash RPC may only finish the
    -- existing, master-collected cash receipt, not edit its commercial terms.
    IF v_cash_allowed THEN RETURN NEW; END IF;

    IF NOT v_structural_same
      OR NEW.price IS DISTINCT FROM OLD.price
      OR NEW.paid IS DISTINCT FROM OLD.paid
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
      OR NEW.payment_received_by IS DISTINCT FROM OLD.payment_received_by
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
      OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
    THEN
      RAISE EXCEPTION 'Оплаченный заказ защищён от редактирования'
        USING ERRCODE = '23514';
    END IF;
    -- A technical updated_at refresh alone remains supported.
    RETURN NEW;
  END IF;

  IF NEW.paid IS TRUE OR NEW.payment_method IS NOT NULL
    OR NEW.payment_amount IS NOT NULL OR NEW.payment_received_by IS NOT NULL
    OR NEW.paid_at IS NOT NULL OR NEW.paid_by IS NOT NULL THEN
    IF NOT (COALESCE(v_payment_allowed,FALSE) OR COALESCE(v_cash_allowed,FALSE)) THEN
      RAISE EXCEPTION 'Прямое изменение оплаты запрещено: используйте RPC'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE OR REPLACE TRIGGER rabota_paid_order_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.rabota_orders
  FOR EACH ROW EXECUTE FUNCTION private.rabota_paid_order_guard();

COMMENT ON FUNCTION private.rabota_paid_order_guard()
  IS 'Rabota: blocks direct paid flags; authorizes only exact payment and cash-distribution RPC transitions; freezes paid rows.';
COMMIT;
