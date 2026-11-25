-- Use the verified full payment of each completed order as its single
-- company accounting receipt. Keep prior cash handoffs as an immutable archive.
BEGIN;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM private.rabota_payroll_policy_v3)<>1 THEN
    RAISE EXCEPTION 'Verified payroll v3 must be active before switching company accounting.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.rabota_record_order_payment(uuid,numeric,text)', '32542e1e1a8a090736e9d9965a2ed0ab'),
      ('public.rabota_payroll_snapshot_v3()', 'aa370c23befea36c74403f65795c5917'),
      ('public.rabota_payroll_refund_v3(uuid,numeric,text,uuid)', '524cbf872f18ff76af088b7fc0bc2e44'),
      ('public.rabota_cash_distribute(uuid)', '1de716ce3099dd4d0817d5020320305b'),
      ('public.rabota_cash_submit(uuid)', '39c9b6813d67569314fd186bb601a3ee'),
      ('public.rabota_cash_confirm(uuid)', '3ece8529a852ef49cc87643f5e941a2f'),
      ('public.rabota_cash_submit_amount(numeric,uuid,uuid)', '5025c9d96261ad3bd3c28150303c0765'),
      ('public.rabota_cash_confirm_amount(uuid,numeric,numeric)', 'e0611041ced7db1719186fc56dacdfa2'),
      ('public.rabota_cashbook_record_v1(text,numeric,text,text,text,uuid)', '44d1a793a3ce3e7c8091008a9c489050'),
      ('private.rabota_capture_payroll_payment_v3()', 'd0b4d66d5490ac7d17f09aaa240aadf6'),
      ('private.rabota_paid_order_guard()', '9f14084c25515936a06937a55a4c64e0'),
      ('private.rabota_cash_order_guard()', '27e721f9909f2ab0e7d08dcea1a3225c')
    ) AS baseline(signature, source_md5)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(baseline.signature)
    WHERE pg_catalog.md5(p.prosrc) IS DISTINCT FROM baseline.source_md5
       OR p.proowner IS DISTINCT FROM CURRENT_USER::regrole::oid
       OR ('search_path=""'=ANY(p.proconfig)) IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Payment or payroll definitions changed. Re-audit before installation.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rabota_cash_collections c
    JOIN public.rabota_orders o ON o.id=c.order_id WHERE o.paid IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Some archived handoffs lack a paid order. Reconcile before switching.';
  END IF;
END;
$preflight$;

-- NULL scope is used only after checking owner access in the public snapshot.
-- Payroll holds are not cash facts: use the verified full payment even if
-- the order's old payroll or handoff needed to stay on review.
CREATE FUNCTION private.rabota_accounting_receipts_v1(p_master_user_id uuid)
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
    AND coalesce(o.payment_amount,e.paid_amount)=o.price
$receipts$;

-- An approved historical payroll disbursement is an accounting outflow even
-- when its allocation is held outside the employee's payable balance.
CREATE FUNCTION private.rabota_accounting_payouts_v1(p_activated_at timestamptz)
RETURNS TABLE(id uuid,order_id uuid,amount numeric,payment_method text,created_at timestamptz,note text)
LANGUAGE sql STABLE SET search_path TO ''
AS $payouts$
  SELECT f.id,f.order_id,coalesce(r.credited_amount,f.amount),f.payment_method,f.created_at,f.note
  FROM public.rabota_finance_operations f
  LEFT JOIN private.rabota_payroll_payout_review_v3 r ON r.operation_id=f.id
  WHERE f.voided_at IS NULL AND f.kind IN ('raul_payout','timur_payout')
    AND (r.credited_amount>0 OR (r.operation_id IS NULL AND f.kind='raul_payout'
                               AND f.created_at>=p_activated_at))
$payouts$;

REVOKE ALL ON FUNCTION private.rabota_accounting_receipts_v1(uuid),
  private.rabota_accounting_payouts_v1(timestamptz) FROM PUBLIC,anon,authenticated;

DO $receipts_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o
    LEFT JOIN private.rabota_payroll_refunds_v3 f ON f.order_id=o.id
    WHERE o.paid IS TRUE AND (o.status='Выполнен' OR f.order_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM private.rabota_accounting_receipts_v1(NULL) r WHERE r.order_id=o.id)
  ) THEN
    RAISE EXCEPTION 'Some completed payments lack an authoritative full receipt. Reconcile before switching.';
  END IF;
END;
$receipts_preflight$;

CREATE FUNCTION private.rabota_frozen_cash_archive_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $archive$
BEGIN
  RAISE EXCEPTION 'Журнал передачи наличных доступен только как архив' USING ERRCODE='55000';
END;
$archive$;
REVOKE ALL ON FUNCTION private.rabota_frozen_cash_archive_v1() FROM PUBLIC,anon,authenticated;

DROP TRIGGER rabota_cash_order_guard_trigger ON public.rabota_orders;
DROP TRIGGER rabota_guard_held_cash_custody_v3 ON public.rabota_cash_collections;

CREATE TRIGGER rabota_frozen_cash_collections_v1
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.rabota_cash_collections
FOR EACH STATEMENT EXECUTE FUNCTION private.rabota_frozen_cash_archive_v1();

CREATE TRIGGER rabota_frozen_cash_transfer_events_v1
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.rabota_cash_transfer_events
FOR EACH STATEMENT EXECUTE FUNCTION private.rabota_frozen_cash_archive_v1();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.rabota_cash_collections, public.rabota_cash_transfer_events FROM PUBLIC,anon,authenticated;

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
  if exists(select 1 from private.rabota_payroll_policy_v3)
    and v_order.price is distinct from p_amount then
    raise exception 'Оплата должна совпадать с полной стоимостью заказа. Сначала согласуйте и сохраните цену'
      using errcode='23514';
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
    OR NEW.payment_amount IS DISTINCT FROM NEW.price THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_user_id=v_policy.master_user_id THEN
    v_earned:=round(NEW.payment_amount*v_policy.rate,2)+v_policy.bonus;
    INSERT INTO private.rabota_payroll_earnings_v3(
      order_id,master_user_id,paid_amount,earned_amount,company_share,earned_at,rule_version
    ) VALUES(
      NEW.id,NEW.assigned_user_id,NEW.payment_amount,v_earned,NEW.payment_amount-v_earned,
      clock_timestamp(),v_policy.rule_version
    );
  END IF;
  RETURN NEW;
END;
$capture$;

CREATE OR REPLACE FUNCTION public.rabota_payroll_refund_v3(
  p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid
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
      OR v_existing.note<>v_note OR v_existing.refunded_by<>v_actor THEN
      RAISE EXCEPTION 'Идентификатор уже использован другой операцией' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',true);
  END IF;
  SELECT * INTO v_order FROM public.rabota_orders WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO v_earning FROM private.rabota_payroll_earnings_v3 WHERE order_id=p_order_id;
  IF NOT FOUND OR v_earning.master_user_id<>v_policy.master_user_id
    OR v_order.paid IS NOT TRUE OR v_order.status<>'Выполнен'
    OR v_order.payment_amount IS DISTINCT FROM p_amount OR v_earning.paid_amount<>p_amount THEN
    RAISE EXCEPTION 'Можно подтвердить только полный возврат по однозначно оплаченному заказу' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h WHERE h.order_id=p_order_id) THEN
    RAISE EXCEPTION 'По заказу продолжается сверка. Возврат пока недоступен'
      USING ERRCODE='23514';
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
  INSERT INTO private.rabota_payroll_refunds_v3(order_id,request_id,amount,refunded_by,note)
  VALUES(p_order_id,p_request_id,p_amount,v_actor,v_note)
  RETURNING * INTO v_existing;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','refund-v3:'||p_order_id::text,true);
  UPDATE public.rabota_orders SET status='Отменён',updated_at=clock_timestamp() WHERE id=p_order_id;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','',true);
  RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',false);
END;
$refund$;

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

CREATE OR REPLACE FUNCTION public.rabota_cashbook_record_v1(p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=auth.uid();
 v_id uuid;
 v_old public.rabota_cashbook_entries%rowtype;
 v_note text:=btrim(coalesce(p_note,''));
begin
 if v_actor is null or (select private.rabota_my_role()) is distinct from 'owner' then
  raise exception 'Только владелец может проводить операции кассы';
 end if;
 if p_kind is null or p_kind not in ('income','expense') then
  raise exception 'Доступны только фактические поступления и расходы' using errcode='23514';
 end if;
 if p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) then
  raise exception 'Некорректная сумма'; end if;
 if p_request_id is null then raise exception 'Не указан идентификатор операции'; end if;
 if length(v_note)<1 or length(v_note)>240 then raise exception 'Укажите комментарий до 240 символов'; end if;
 if (
   (p_kind='income' and p_from_account is null and p_to_account in ('cash','card'))
   or (p_kind='expense' and p_from_account in ('cash','card') and p_to_account is null)
 ) is not true then raise exception 'Неверное направление денег' using errcode='23514'; end if;
 select * into v_old from public.rabota_cashbook_entries where request_id=p_request_id;
 if found then
  if v_old.created_by<>v_actor or v_old.kind<>p_kind or v_old.amount<>p_amount
    or v_old.from_account is distinct from p_from_account or v_old.to_account is distinct from p_to_account then
   raise exception 'Идентификатор принадлежит другой операции'; end if;
  return v_old.id;
 end if;
 insert into public.rabota_cashbook_entries(kind,amount,from_account,to_account,note,request_id,created_by)
 values(p_kind,p_amount,p_from_account,p_to_account,v_note,p_request_id,v_actor) returning id into v_id;
 return v_id;
end $function$;

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
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.occurred_at DESC NULLS LAST,r.order_id)
      FROM private.rabota_accounting_receipts_v1(CASE WHEN v_role='owner' THEN NULL::uuid ELSE v_actor END) r
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
      'earned',t.earned,'paid',t.paid,'due',t.earned-t.paid,
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
  );
END;
$snapshot$;

-- Obsolete clients fail closed. The archive and its read policies remain.
DROP FUNCTION public.rabota_cash_distribute(uuid),
  public.rabota_cash_submit(uuid), public.rabota_cash_confirm(uuid),
  public.rabota_cash_submit_amount(numeric,uuid,uuid),
  public.rabota_cash_confirm_amount(uuid,numeric,numeric);
DROP FUNCTION private.rabota_cash_order_guard(), private.rabota_guard_held_cash_custody_v3();

COMMENT ON TABLE public.rabota_cash_collections IS 'Historical cash handoffs, read-only. No balance calculations.';
COMMENT ON TABLE public.rabota_cash_transfer_events IS 'Historical transfer receipts, read-only. No balance calculations.';
COMMENT ON FUNCTION public.rabota_payroll_snapshot_v3() IS 'Payroll v3 and authoritative completed full accounting receipts. Owner all, master assigned only, manager capability only.';

NOTIFY pgrst, 'reload schema';
COMMIT;
