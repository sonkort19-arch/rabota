-- Travel allowances are payable to the configured payroll master independently
-- of the wash wage. No historical order or ledger entries are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('private.rabota_accounting_receipts_v1(uuid)', 'd1067c8cc9ab66212f65c68899034119', false),
      ('public.rabota_record_order_payment(uuid,numeric,text)', '4476ea54b47407a8a73069f5632edc33', true),
      ('private.rabota_capture_payroll_payment_v3()', 'ac0180a17a9af239b638e14278dbe9b8', true),
      ('private.rabota_paid_order_guard()', '22d3d608e3c8dcb2f4565ae443333204', false),
      ('private.rabota_payroll_totals_v3(uuid,timestamptz)', '44699735608920c138d34db2a765cabd', false),
      ('public.rabota_payroll_payout_v3(numeric,text,text,uuid,uuid)', 'c59a08432b3828c59559454403ecb844', true),
      ('public.rabota_payroll_refund_v3(uuid,numeric,text,uuid)', '8b2e83cdf0fda9627cfbe0086f00d262', true),
      ('public.rabota_payroll_snapshot_v3()', 'fc1ca94b9e8d2d8a447ac953d8c5c93e', true)
    ) AS baseline(signature, source_md5, security_definer)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(baseline.signature)
    WHERE pg_catalog.md5(p.prosrc) IS DISTINCT FROM baseline.source_md5
       OR p.prosecdef IS DISTINCT FROM baseline.security_definer
       OR ('search_path=""'=ANY(p.proconfig)) IS DISTINCT FROM true
       OR p.proowner IS DISTINCT FROM CURRENT_USER::regrole::oid
  ) THEN
    RAISE EXCEPTION 'Order payment or payroll definitions have changed. Re-audit before installing travel.';
  END IF;
END;
$preflight$;

ALTER TABLE public.rabota_orders
  ADD COLUMN travel_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN travel_taken boolean,
  ADD CONSTRAINT rabota_orders_travel_amount_check CHECK (
    travel_amount BETWEEN 0 AND 10000000
    AND travel_amount = round(travel_amount,2)
    AND (travel_amount = 0 OR price IS NULL OR price + travel_amount <= 10000000)
  ),
  ADD CONSTRAINT rabota_orders_travel_taken_check CHECK (
    CASE WHEN travel_amount > 0 AND status = 'Отменён'
      THEN travel_taken IS NOT NULL
      ELSE travel_taken IS NULL
    END
  );

CREATE TABLE private.rabota_payroll_travel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rabota_orders(id),
  order_number integer,
  master_user_id uuid NOT NULL REFERENCES public.rabota_members(user_id),
  delta numeric(14,2) NOT NULL CHECK (delta <> 0 AND abs(delta) <= 10000000),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rabota_payroll_travel_events_master_idx
  ON private.rabota_payroll_travel_events(master_user_id,occurred_at DESC,id);
CREATE INDEX rabota_payroll_travel_events_order_idx
  ON private.rabota_payroll_travel_events(order_id);
ALTER TABLE private.rabota_payroll_travel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.rabota_payroll_travel_events FROM PUBLIC,anon,authenticated,service_role;

-- Updates take row locks before running row-level triggers. Take the existing
-- payroll member lock at statement level so direct edits serialize with payouts
-- and refunds without inverting the payroll-member/order lock order.
CREATE FUNCTION private.rabota_lock_travel_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $lock$
BEGIN
  PERFORM 1 FROM public.rabota_members m
  JOIN private.rabota_payroll_policy_v3 p ON p.master_user_id=m.user_id FOR UPDATE OF m;
  RETURN NULL;
END;
$lock$;

CREATE TRIGGER rabota_lock_travel_payroll
BEFORE INSERT OR UPDATE OF travel_amount,travel_taken ON public.rabota_orders
FOR EACH STATEMENT EXECUTE FUNCTION private.rabota_lock_travel_payroll();

CREATE FUNCTION private.rabota_capture_travel_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $capture$
DECLARE
  previous_amount numeric := 0;
  current_amount numeric;
  payroll_master uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM private.rabota_payroll_travel_events e WHERE e.order_id=OLD.id) THEN
      RAISE EXCEPTION 'Заказ с начислениями за дорогу нельзя удалить. Отмените его с сохранением истории'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM 'Отменён' OR OLD.travel_taken IS TRUE) THEN
    previous_amount := OLD.travel_amount;
  END IF;
  current_amount := CASE WHEN NEW.status IS DISTINCT FROM 'Отменён' OR NEW.travel_taken IS TRUE
                         THEN NEW.travel_amount ELSE 0 END;
  IF current_amount = previous_amount THEN RETURN NULL; END IF;

  SELECT master_user_id INTO payroll_master FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Для начисления дороги сначала настройте зарплату Рауля' USING ERRCODE='23514';
  END IF;
  INSERT INTO private.rabota_payroll_travel_events(order_id,order_number,master_user_id,delta)
  VALUES(NEW.id,NEW.order_number,payroll_master,current_amount-previous_amount);
  RETURN NULL;
END;
$capture$;

-- Changing the status without a travel operation cannot change the effective
-- allowance: the table requires a trip decision on cancellation, and NULL again
-- on reopening. Both transitions therefore set the travel_taken column.
CREATE TRIGGER rabota_capture_travel_payroll
AFTER INSERT OR UPDATE OF travel_amount,travel_taken ON public.rabota_orders
FOR EACH ROW EXECUTE FUNCTION private.rabota_capture_travel_payroll();

CREATE TRIGGER rabota_keep_travel_payroll_history
BEFORE DELETE ON public.rabota_orders
FOR EACH ROW EXECUTE FUNCTION private.rabota_capture_travel_payroll();

REVOKE ALL ON FUNCTION private.rabota_lock_travel_payroll(),private.rabota_capture_travel_payroll()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.rabota_accounting_receipts_v1(p_master_user_id uuid)
RETURNS TABLE(order_id uuid,master_id uuid,amount numeric,payment_method text,
  paid_at timestamptz,occurred_at timestamptz)
LANGUAGE sql STABLE SET search_path TO ''
AS $receipts$
  SELECT o.id,o.assigned_user_id,
    coalesce(o.payment_amount,e.paid_amount),o.payment_method,o.paid_at,
    coalesce(o.paid_at,e.earned_at,o.completed_at)
  FROM public.rabota_orders o
  LEFT JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=o.id AND e.rule_version='legacy_verified'
  LEFT JOIN private.rabota_payroll_refunds_v3 r ON r.order_id=o.id
  WHERE o.paid IS TRUE AND (o.status='Выполнен' OR r.order_id IS NOT NULL)
    AND (p_master_user_id IS NULL OR o.assigned_user_id=p_master_user_id)
    AND coalesce(o.payment_amount,e.paid_amount)>0
    AND coalesce(o.payment_amount,e.paid_amount)=o.price+o.travel_amount
$receipts$;

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
  v_assigned uuid;
  v_payroll_active boolean;
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
  -- Lock the master before the order, in the same order as payouts,
  -- activation and reversals. Verify the assignment again after locking.
  select assigned_user_id into v_assigned from public.rabota_orders where id=p_order_id;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_assigned is not null then
    perform 1 from public.rabota_members where user_id=v_assigned for update;
  end if;
  select * into v_order from public.rabota_orders where id=p_order_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_order.assigned_user_id is distinct from v_assigned then
    raise exception 'Назначение заказа изменилось. Заново откройте заказ' using errcode='40001';
  end if;
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
  v_payroll_active := exists(select 1 from private.rabota_payroll_policy_v3);
  if (v_payroll_active or v_order.travel_amount>0)
    and v_order.price+v_order.travel_amount is distinct from p_amount then
    raise exception 'Оплата должна совпадать с полной стоимостью заказа. Сначала согласуйте и сохраните цену'
      using errcode='23514';
  end if;
  v_receiver := case when v_role='master' then 'master' else 'company' end;
  -- Authorize exactly this paid transition for the paired row guard.
  perform pg_catalog.set_config('rabota.order_payment_intent','payment:'||p_order_id::text,true);
  update public.rabota_orders
    set status='Выполнен', paid=true,
        price=case when v_payroll_active or v_order.travel_amount>0 then v_order.price else p_amount end,
        payment_method=p_method, payment_amount=p_amount,
        payment_received_by=v_receiver, paid_at=now(), paid_by=auth.uid(),
        completed_at=coalesce(v_order.completed_at,now()), updated_at=now()
    where id=p_order_id;
  perform pg_catalog.set_config('rabota.order_payment_intent','',true);
  return jsonb_build_object('ok',true,'amount',p_amount,'method',p_method,'receiver',v_receiver);
end $function$;

CREATE OR REPLACE FUNCTION private.rabota_capture_payroll_payment_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $capture$
DECLARE
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_earned numeric(14,2);
BEGIN
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND OR NEW.paid IS NOT TRUE OR NEW.status<>'Выполнен'
    OR NEW.payment_amount IS NULL OR NEW.payment_amount<=0
    OR NEW.payment_amount IS DISTINCT FROM NEW.price+NEW.travel_amount THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_user_id=v_policy.master_user_id THEN
    v_earned:=round(NEW.price*v_policy.rate,2)+v_policy.bonus;
    INSERT INTO private.rabota_payroll_earnings_v3(
      order_id,master_user_id,paid_amount,earned_amount,company_share,earned_at,rule_version
    ) VALUES(
      NEW.id,NEW.assigned_user_id,NEW.price,v_earned,NEW.price-v_earned,
      clock_timestamp(),v_policy.rule_version
    );
  END IF;
  RETURN NEW;
END;
$capture$;

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
  v_refund_owner name;
  v_structural_same boolean;
  v_payment_allowed boolean := false;
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

  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_refund_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.rabota_payroll_refund_v3(uuid,numeric,text,uuid)'::pg_catalog.regprocedure;

  -- Client, calendar and assignment facts cannot be silently changed by
  -- a privileged payment procedure or by ordinary updates of paid rows.
  v_structural_same := ROW(
    NEW.id,NEW.name,NEW.phone,NEW.address,NEW.radiator_type,
    NEW.radiators,NEW.floor_loops,NEW.master,NEW.appointment_date,
    NEW.appointment_time,NEW.details,NEW.legacy_id,NEW.created_by,
    NEW.created_at,NEW.assigned_user_id,NEW.lead_id,NEW.travel_amount
  ) IS NOT DISTINCT FROM ROW(
    OLD.id,OLD.name,OLD.phone,OLD.address,OLD.radiator_type,
    OLD.radiators,OLD.floor_loops,OLD.master,OLD.appointment_date,
    OLD.appointment_time,OLD.details,OLD.legacy_id,OLD.created_by,
    OLD.created_at,OLD.assigned_user_id,OLD.lead_id,OLD.travel_amount
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
    AND NEW.payment_amount = NEW.price+NEW.travel_amount
    AND NEW.payment_received_by =
      CASE WHEN v_role='master' THEN 'master' ELSE 'company' END
    AND NEW.paid_at IS NOT NULL AND NEW.paid_by = v_actor;

  IF OLD.paid IS TRUE OR OLD.payment_method IS NOT NULL
    OR OLD.payment_amount IS NOT NULL OR OLD.payment_received_by IS NOT NULL
    OR OLD.paid_at IS NOT NULL OR OLD.paid_by IS NOT NULL THEN
    -- The scoped refund RPC records evidence before changing the status.
    -- Keep the original payment, assignment, price and completion immutable.
    IF current_user=v_refund_owner AND v_actor IS NOT NULL AND v_role='owner'
      AND v_intent='refund-v3:'||OLD.id::text AND v_structural_same
      AND OLD.paid IS TRUE AND OLD.status='Выполнен' AND NEW.status='Отменён'
      AND ROW(NEW.price,NEW.paid,NEW.completed_at,NEW.payment_method,NEW.payment_amount,
              NEW.payment_received_by,NEW.paid_at,NEW.paid_by)
       IS NOT DISTINCT FROM ROW(OLD.price,OLD.paid,OLD.completed_at,OLD.payment_method,OLD.payment_amount,
                                OLD.payment_received_by,OLD.paid_at,OLD.paid_by)
    THEN
      IF EXISTS (SELECT 1 FROM private.rabota_payroll_refunds_v3 r
        WHERE r.order_id=OLD.id AND r.refunded_by=v_actor AND r.amount=OLD.payment_amount) THEN
        RETURN NEW;
      END IF;
    END IF;

    IF NOT v_structural_same
      OR NEW.price IS DISTINCT FROM OLD.price
      OR NEW.paid IS DISTINCT FROM OLD.paid
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.travel_taken IS DISTINCT FROM OLD.travel_taken
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
    IF NOT COALESCE(v_payment_allowed,FALSE) THEN
      RAISE EXCEPTION 'Прямое изменение оплаты запрещено: используйте RPC'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE OR REPLACE FUNCTION private.rabota_payroll_totals_v3(p_master_user_id uuid, p_activated_at timestamptz)
RETURNS TABLE(earned numeric, paid numeric)
LANGUAGE sql STABLE SET search_path TO ''
AS $totals$
  SELECT
    (SELECT coalesce(sum(e.earned_amount),0)
     FROM private.rabota_payroll_earnings_v3 e
     WHERE e.master_user_id=p_master_user_id
       AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h
                      WHERE h.order_id=e.order_id AND h.payroll_on_hold)
       AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_refunds_v3 r WHERE r.order_id=e.order_id))
    + (SELECT coalesce(sum(e.delta),0) FROM private.rabota_payroll_travel_events e
       WHERE e.master_user_id=p_master_user_id),
    (SELECT coalesce(sum(p.amount),0) FROM private.rabota_payroll_operations_v3(p_master_user_id,p_activated_at) p)
$totals$;

CREATE OR REPLACE FUNCTION public.rabota_payroll_payout_v3(
  p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $payout$
DECLARE
  v_actor uuid:=auth.uid();
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_existing public.rabota_finance_operations%rowtype;
  v_totals record;
  v_id uuid;
  v_note text:=btrim(coalesce(p_note,''));
  v_replayed boolean:=false;
BEGIN
  IF v_actor IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Зарплату может выплачивать только владелец' USING ERRCODE='42501';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>10000000 OR p_amount<>round(p_amount,2)
    OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card')
    OR p_request_id IS NULL OR length(v_note) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Некорректные реквизиты выплаты' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND OR p_master_user_id IS DISTINCT FROM v_policy.master_user_id THEN
    RAISE EXCEPTION 'Правила выплат или мастер не подтверждены' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.rabota_members
  WHERE user_id=p_master_user_id AND active AND role='master'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Мастер не активен' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_existing FROM public.rabota_finance_operations WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.master_user_id IS DISTINCT FROM p_master_user_id
      OR v_existing.created_by IS DISTINCT FROM v_actor OR v_existing.kind<>'raul_payout'
      OR v_existing.amount<>p_amount OR v_existing.payment_method IS DISTINCT FROM p_payment_method
      OR v_existing.note IS DISTINCT FROM v_note OR v_existing.created_at<v_policy.activated_at
      OR v_existing.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Идентификатор уже использован другой операцией' USING ERRCODE='23505';
    END IF;
    v_id:=v_existing.id;
    v_replayed:=true;
  ELSE
    SELECT * INTO v_totals FROM private.rabota_payroll_totals_v3(p_master_user_id,v_policy.activated_at);
    IF p_amount>v_totals.earned-v_totals.paid THEN
      RAISE EXCEPTION 'Сумма больше задолженности по зарплате' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.rabota_finance_operations(
      kind,amount,master_user_id,note,created_by,payment_method,request_id,created_at
    ) VALUES ('raul_payout',p_amount,p_master_user_id,v_note,v_actor,p_payment_method,p_request_id,clock_timestamp())
    RETURNING id INTO v_id;
  END IF;
  SELECT * INTO v_totals FROM private.rabota_payroll_totals_v3(p_master_user_id,v_policy.activated_at);
  RETURN jsonb_build_object('id',v_id,'amount',p_amount,'earned',v_totals.earned,'paid',v_totals.paid,
    'due',greatest(v_totals.earned-v_totals.paid,0),
    'balance',v_totals.earned-v_totals.paid,'overpaid',greatest(v_totals.paid-v_totals.earned,0),
    'replayed',v_replayed);
END;
$payout$;

CREATE FUNCTION public.rabota_payroll_refund_v3(
  p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid, p_travel_taken boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $refund$
DECLARE
  v_actor uuid:=auth.uid();
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_existing private.rabota_payroll_refunds_v3%rowtype;
  v_order public.rabota_orders%rowtype;
  v_earning private.rabota_payroll_earnings_v3%rowtype;
  v_totals record;
  v_note text:=btrim(coalesce(p_note,''));
BEGIN
  IF v_actor IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Возврат может подтвердить только владелец' USING ERRCODE='42501';
  END IF;
  IF p_order_id IS NULL OR p_request_id IS NULL OR p_amount IS NULL OR p_amount<=0
    OR p_amount>10000000 OR p_amount<>round(p_amount,2)
    OR length(v_note) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Некорректные реквизиты возврата' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN RAISE EXCEPTION 'Новый учёт ещё не активен' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.rabota_members WHERE user_id=v_policy.master_user_id FOR UPDATE;
  SELECT * INTO v_existing FROM private.rabota_payroll_refunds_v3 WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id OR v_existing.amount<>p_amount
      OR v_existing.note<>v_note OR v_existing.refunded_by<>v_actor
      OR (SELECT o.travel_taken FROM public.rabota_orders o WHERE o.id=v_existing.order_id)
        IS DISTINCT FROM p_travel_taken THEN
      RAISE EXCEPTION 'Идентификатор уже использован другой операцией' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',true);
  END IF;
  SELECT * INTO v_order FROM public.rabota_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.paid IS NOT TRUE OR v_order.status IS DISTINCT FROM 'Выполнен'
    OR v_order.price+v_order.travel_amount IS DISTINCT FROM p_amount
    OR v_order.payment_amount IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION 'Можно подтвердить только полный возврат по однозначно оплаченному заказу' USING ERRCODE='23514';
  END IF;

  IF (v_order.travel_amount>0) IS DISTINCT FROM (p_travel_taken IS NOT NULL) THEN
    RAISE EXCEPTION 'Для возврата по заказу с дорогой укажите, состоялась ли поездка' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h WHERE h.order_id=p_order_id) THEN
    RAISE EXCEPTION 'По заказу продолжается сверка. Возврат пока недоступен'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_earning FROM private.rabota_payroll_earnings_v3 WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_earning.master_user_id IS DISTINCT FROM v_policy.master_user_id
      OR v_order.assigned_user_id IS DISTINCT FROM v_earning.master_user_id
      OR v_earning.paid_amount IS DISTINCT FROM v_order.price THEN
      RAISE EXCEPTION 'Начисление по заказу не подтверждено. Нужна сверка' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
      JOIN public.rabota_finance_operations f ON f.id=r.operation_id
      WHERE f.voided_at IS NULL AND r.allocations ? p_order_id::text
    ) THEN
      RAISE EXCEPTION 'С заказом связана подтверждённая выплата. Нужна сверка перед возвратом'
        USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_totals FROM private.rabota_payroll_totals_v3(v_policy.master_user_id,v_policy.activated_at);
    IF v_totals.earned-v_totals.paid<v_earning.earned_amount THEN
      RAISE EXCEPTION 'Начисление уже покрыто выплатой. Нужна сверка перед возвратом' USING ERRCODE='23514';
    END IF;
  ELSIF v_order.assigned_user_id IS NOT DISTINCT FROM v_policy.master_user_id THEN
    RAISE EXCEPTION 'Начисление по заказу не подтверждено. Нужна сверка' USING ERRCODE='23514';
  END IF;

  INSERT INTO private.rabota_payroll_refunds_v3(order_id,request_id,amount,refunded_by,note)
  VALUES(p_order_id,p_request_id,p_amount,v_actor,v_note)
  RETURNING * INTO v_existing;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','refund-v3:'||p_order_id::text,true);
  UPDATE public.rabota_orders SET status='Отменён',travel_taken=p_travel_taken,updated_at=clock_timestamp() WHERE id=p_order_id;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','',true);
  RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',false);
END;
$refund$;

-- Four-parameter clients continue to work for orders without a travel charge.
CREATE OR REPLACE FUNCTION public.rabota_payroll_refund_v3(
  p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $refund$
  SELECT public.rabota_payroll_refund_v3(p_order_id,p_amount,p_note,p_request_id,NULL::boolean)
$refund$;

REVOKE ALL ON FUNCTION public.rabota_payroll_refund_v3(uuid,numeric,text,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_refund_v3(uuid,numeric,text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.rabota_payroll_snapshot_v3()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $snapshot$
DECLARE
  v_actor uuid:=auth.uid();
  v_role text:=(SELECT private.rabota_my_role());
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_accounting jsonb:=jsonb_build_object('accounting_version',1);
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к расчётам' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN RETURN jsonb_build_object('version',3,'state','inactive'); END IF;
  IF v_role IN ('owner','master') THEN
    v_accounting:=v_accounting || jsonb_build_object('accounting_receipts',coalesce((
      SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('travel_amount',o.travel_amount)
                       ORDER BY r.occurred_at DESC NULLS LAST,r.order_id)
      FROM private.rabota_accounting_receipts_v1(CASE WHEN v_role='owner' THEN NULL::uuid ELSE v_actor END) r
      JOIN public.rabota_orders o ON o.id=r.order_id
    ),'[]'::jsonb),'accounting_refunds',coalesce((
      SELECT jsonb_agg(jsonb_build_object('order_id',r.order_id,'amount',r.amount,'refunded_at',r.refunded_at,
                                          'travel_amount',o.travel_amount)
                       ORDER BY r.refunded_at DESC,r.order_id)
      FROM private.rabota_payroll_refunds_v3 r
      JOIN public.rabota_orders o ON o.id=r.order_id
      WHERE v_role='owner' OR o.assigned_user_id=v_actor
    ),'[]'::jsonb));
  END IF;
  IF v_role='owner' THEN
    v_accounting:=v_accounting || jsonb_build_object('accounting_payouts',coalesce((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id)
      FROM private.rabota_accounting_payouts_v1(v_policy.activated_at) p
    ),'[]'::jsonb));
  END IF;
  IF v_role<>'owner' AND (v_role<>'master' OR v_actor<>v_policy.master_user_id) THEN
    RETURN jsonb_build_object('version',3,'state','not_applicable','activated_at',v_policy.activated_at)
      || v_accounting;
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'version',3,'state','active','master_id',v_policy.master_user_id,'activated_at',v_policy.activated_at,
      'earned',t.earned,'paid',t.paid,'due',greatest(t.earned-t.paid,0),
      'balance',t.earned-t.paid,'overpaid',greatest(t.paid-t.earned,0),
      'travel_earned',travel.earned,'travel_events',travel.events,
      'orders',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id',e.order_id,'earned_amount',e.earned_amount,'paid_amount',e.paid_amount,
          'company_share',e.company_share,'earned_at',e.earned_at,'rule_version',e.rule_version
        ) ORDER BY e.earned_at DESC,e.order_id)
        FROM private.rabota_payroll_earnings_v3 e
        WHERE e.master_user_id=v_policy.master_user_id
          AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h
                         WHERE h.order_id=e.order_id AND h.payroll_on_hold)
          AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_refunds_v3 r WHERE r.order_id=e.order_id)
      ),'[]'::jsonb),
      'payouts',coalesce((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id)
        FROM private.rabota_payroll_operations_v3(v_policy.master_user_id,v_policy.activated_at) p
      ),'[]'::jsonb),
      'refunds',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id',r.order_id,'amount',r.amount,'refunded_at',r.refunded_at,
          'earned_reversed',e.earned_amount,'earned_at',e.earned_at
        ) ORDER BY r.refunded_at DESC,r.order_id)
        FROM private.rabota_payroll_refunds_v3 r
        JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=r.order_id
        WHERE e.master_user_id=v_policy.master_user_id
      ),'[]'::jsonb),
      'holds',CASE WHEN v_role='owner' THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id',h.order_id,'order_number',o.order_number,
          'payroll_on_hold',h.payroll_on_hold,'cash_on_hold',h.cash_on_hold,
          'reason',h.reason,
          'earned_amount',CASE WHEN h.payroll_on_hold THEN e.earned_amount END,
          'credited_amount',CASE WHEN h.payroll_on_hold THEN coalesce((
            SELECT sum((r.allocations->>(h.order_id::text))::numeric)
            FROM private.rabota_payroll_payout_review_v3 r
            JOIN public.rabota_finance_operations f ON f.id=r.operation_id
            WHERE f.master_user_id=v_policy.master_user_id AND f.voided_at IS NULL
              AND f.kind IN ('raul_payout','timur_payout')
          ),0) END,
          'linked_recorded_amount',CASE WHEN h.payroll_on_hold THEN coalesce((
            SELECT sum(f.amount) FROM public.rabota_finance_operations f
            WHERE f.order_id=h.order_id AND f.master_user_id=v_policy.master_user_id
              AND f.voided_at IS NULL AND f.kind IN ('raul_payout','timur_payout')
          ),0) END,
          'payment_amount',CASE WHEN h.cash_on_hold THEN e.paid_amount END
        ) ORDER BY e.earned_at DESC,h.order_id)
        FROM private.rabota_payroll_cutover_holds_v3 h
        JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=h.order_id
        JOIN public.rabota_orders o ON o.id=h.order_id
        WHERE e.master_user_id=v_policy.master_user_id
      ),'[]'::jsonb) ELSE '[]'::jsonb END
    )
    || v_accounting
    FROM private.rabota_payroll_totals_v3(v_policy.master_user_id,v_policy.activated_at) t
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(e.delta),0) AS earned,coalesce(jsonb_agg(jsonb_build_object(
        'id',e.id,'order_id',e.order_id,'order_number',e.order_number,'delta',e.delta,'occurred_at',e.occurred_at
      ) ORDER BY e.occurred_at DESC,e.id),'[]'::jsonb) AS events
      FROM private.rabota_payroll_travel_events e WHERE e.master_user_id=v_policy.master_user_id
    ) travel
  );
END;
$snapshot$;

NOTIFY pgrst, 'reload schema';
COMMIT;
