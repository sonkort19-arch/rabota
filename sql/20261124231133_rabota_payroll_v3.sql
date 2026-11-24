-- Staged payroll redesign. Installation leaves v3 inactive. Activation requires
-- a verified backup and signed reconciliation entered by a database operator.
-- Do not apply the superseded cash_payroll_reservation candidate before this.
BEGIN;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.rabota_record_order_payment(uuid,numeric,text)', '9e682ea2f9c45900690238773f86ad75'),
      ('public.rabota_cash_distribute(uuid)', '1189510649976d91381a4ed9317860b2'),
      ('public.rabota_finance_record(text,numeric,uuid,text)', '029b7512dd4b66149b0018e03d652afa'),
      ('public.rabota_finance_void(uuid)', '55a828839707d460bdd9e755038ef716'),
      ('public.rabota_salary_payout_v2(text,numeric,text,text,uuid,uuid)', 'e6ef6c66a77a7fb4b3c05139d6c4ab0f'),
      ('private.rabota_paid_order_guard()', '65d76a1b3637cc1d5026e499791e88c9'),
      ('private.rabota_cash_order_guard()', '27e721f9909f2ab0e7d08dcea1a3225c')
    ) AS baseline(signature, source_md5)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(baseline.signature)
    WHERE pg_catalog.md5(p.prosrc) IS DISTINCT FROM baseline.source_md5
      OR p.proowner IS DISTINCT FROM CURRENT_USER::regrole::oid
      OR ('search_path=""'=ANY(p.proconfig)) IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Rabota payment or payroll definitions changed. Re-audit before installation.';
  END IF;
END;
$preflight$;

CREATE TABLE private.rabota_payroll_policy_v3 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  master_user_id uuid NOT NULL REFERENCES public.rabota_members(user_id),
  activated_at timestamptz NOT NULL,
  approved_by uuid NOT NULL,
  backup_reference text NOT NULL CHECK (length(btrim(backup_reference)) BETWEEN 1 AND 240),
  rule_version text NOT NULL DEFAULT 'v3-50pct-plus-1500' CHECK (rule_version<>'legacy_verified' AND length(btrim(rule_version)) BETWEEN 1 AND 80),
  rate numeric(5,4) NOT NULL DEFAULT 0.50 CHECK (rate BETWEEN 0 AND 1),
  bonus numeric(12,2) NOT NULL DEFAULT 1500 CHECK (bonus BETWEEN 0 AND 10000000)
);

CREATE TABLE private.rabota_payroll_earnings_v3 (
  order_id uuid PRIMARY KEY REFERENCES public.rabota_orders(id),
  master_user_id uuid NOT NULL,
  paid_amount numeric(12,2) NOT NULL CHECK (paid_amount BETWEEN 0.01 AND 10000000),
  earned_amount numeric(14,2) NOT NULL CHECK (earned_amount BETWEEN 0 AND 20000000),
  company_share numeric(14,2) NOT NULL CHECK (company_share BETWEEN -20000000 AND paid_amount),
  earned_at timestamptz NOT NULL,
  rule_version text NOT NULL CHECK (length(btrim(rule_version)) BETWEEN 1 AND 80),
  verified_by uuid,
  evidence_reference text,
  CHECK (rule_version='legacy_verified' OR company_share=paid_amount-earned_amount),
  CHECK ((rule_version='legacy_verified' AND verified_by IS NOT NULL
          AND length(btrim(evidence_reference)) BETWEEN 1 AND 240
          AND evidence_reference IS NOT NULL)
    OR (rule_version<>'legacy_verified' AND verified_by IS NULL AND evidence_reference IS NULL))
);

-- Each historical payout is reviewed explicitly. JSON keys are order UUIDs
-- and numeric values are the verified amounts applied to those earnings.
-- Use an empty object when no part of a payment was received by Raul.
CREATE TABLE private.rabota_payroll_payout_review_v3 (
  operation_id uuid PRIMARY KEY REFERENCES public.rabota_finance_operations(id),
  credited_amount numeric(14,2) NOT NULL CHECK (credited_amount BETWEEN 0 AND 10000000),
  allocations jsonb NOT NULL CHECK (jsonb_typeof(allocations)='object'),
  verified_by uuid NOT NULL,
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 240)
);

-- Opening custody for old completed master-cash orders without a collection.
-- A confirmed zero is valid. No review is inferred from the absence of a row.
CREATE TABLE private.rabota_payroll_cash_review_v3 (
  order_id uuid PRIMARY KEY REFERENCES public.rabota_orders(id),
  held_amount numeric(12,2) NOT NULL CHECK (held_amount BETWEEN 0 AND 10000000),
  verified_by uuid NOT NULL,
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 240)
);

CREATE TABLE private.rabota_payroll_refunds_v3 (
  order_id uuid PRIMARY KEY REFERENCES private.rabota_payroll_earnings_v3(order_id),
  request_id uuid UNIQUE NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount BETWEEN 0.01 AND 10000000),
  refunded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  refunded_by uuid NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 240)
);

ALTER TABLE private.rabota_payroll_policy_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_earnings_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_payout_review_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_cash_review_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_refunds_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.rabota_payroll_policy_v3, private.rabota_payroll_earnings_v3,
  private.rabota_payroll_payout_review_v3, private.rabota_payroll_cash_review_v3,
  private.rabota_payroll_refunds_v3 FROM PUBLIC, anon, authenticated;

-- The pre-v3 cash collection required two payroll amounts. Use an explicit
-- branch for custody-only rows while retaining all checks for existing ones.
-- Keep the existing gross balance, positive company amount and receipt checks.
ALTER TABLE public.rabota_cash_collections
  ADD COLUMN payroll_separate boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT rabota_cash_collections_gross_check,
  DROP CONSTRAINT rabota_cash_collections_raul_amount_check,
  DROP CONSTRAINT rabota_cash_collections_timur_amount_check,
  ADD CONSTRAINT rabota_cash_collections_mode_check CHECK (
    (NOT payroll_separate AND gross>3000 AND raul_amount>0 AND timur_amount=1500)
    OR (payroll_separate AND gross>0 AND raul_amount=0 AND timur_amount=0 AND company_amount=gross)
  );

CREATE FUNCTION private.rabota_payroll_activate_v3(
  p_master_user_id uuid, p_approved_by uuid, p_backup_reference text
) RETURNS timestamptz
LANGUAGE plpgsql
SET search_path TO ''
AS $activate$
DECLARE
  v_cutoff timestamptz;
BEGIN
  IF p_backup_reference IS NULL OR length(btrim(p_backup_reference)) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Укажите ссылку на проверенную резервную копию' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rabota_members WHERE user_id=p_approved_by AND active AND role='owner'
  ) THEN
    RAISE EXCEPTION 'Сверку должен подтвердить активный владелец' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.rabota_members
  WHERE user_id=p_master_user_id AND active AND role='master'
    AND lower(btrim(master_name))='рауль'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Не найден активный мастер Рауль' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM private.rabota_payroll_policy_v3) THEN
    RAISE EXCEPTION 'Правила начислений уже активированы' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o
    LEFT JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=o.id
    WHERE o.assigned_user_id=p_master_user_id AND o.paid AND o.status='Выполнен'
      AND (e.master_user_id IS DISTINCT FROM p_master_user_id
        OR e.rule_version IS DISTINCT FROM 'legacy_verified'
        OR e.paid_amount IS DISTINCT FROM o.price
        OR (o.payment_amount IS NOT NULL AND e.paid_amount IS DISTINCT FROM o.payment_amount))
  ) OR EXISTS (
    SELECT 1 FROM private.rabota_payroll_earnings_v3 e
    JOIN public.rabota_orders o ON o.id=e.order_id
    WHERE e.master_user_id=p_master_user_id
      AND (o.assigned_user_id IS DISTINCT FROM p_master_user_id OR o.paid IS NOT TRUE OR o.status<>'Выполнен')
  ) THEN
    RAISE EXCEPTION 'Не подтверждены полные оплаты и начисления по всем прежним выполненным заказам'
      USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rabota_finance_operations f
    LEFT JOIN private.rabota_payroll_payout_review_v3 r ON r.operation_id=f.id
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
      AND f.kind IN ('raul_payout','timur_payout')
      AND (r.operation_id IS NULL OR r.credited_amount>f.amount)
  ) THEN
    RAISE EXCEPTION 'Не подтверждено, какие прежние выплаты получил Рауль' USING ERRCODE='23514';
  END IF;
  -- Reject invalid types and order references before converting monetary values.
  IF EXISTS (
    SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
    JOIN public.rabota_finance_operations f ON f.id=r.operation_id
    CROSS JOIN LATERAL jsonb_each(r.allocations) a
    LEFT JOIN private.rabota_payroll_earnings_v3 e ON e.order_id::text=a.key
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
      AND (jsonb_typeof(a.value)<>'number' OR e.master_user_id IS DISTINCT FROM p_master_user_id)
  ) THEN
    RAISE EXCEPTION 'Неверная сверка прежних выплат по заказам' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
    JOIN public.rabota_finance_operations f ON f.id=r.operation_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(value::numeric),0) AS total,
             bool_and(value::numeric>0 AND value::numeric=round(value::numeric,2)) AS valid
      FROM jsonb_each(r.allocations)
    ) a
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
      AND (a.total<>r.credited_amount OR a.valid IS FALSE)
  ) OR EXISTS (
    SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
    JOIN public.rabota_finance_operations f ON f.id=r.operation_id
    CROSS JOIN LATERAL jsonb_each(r.allocations) a
    JOIN private.rabota_payroll_earnings_v3 e ON e.order_id::text=a.key
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
    GROUP BY e.order_id,e.earned_amount HAVING sum(a.value::numeric)>e.earned_amount
  ) THEN
    RAISE EXCEPTION 'Сверка прежних выплат не сходится с начислениями по заказам' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o
    JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=o.id
    LEFT JOIN private.rabota_payroll_cash_review_v3 r ON r.order_id=o.id
    WHERE o.assigned_user_id=p_master_user_id AND o.paid AND o.status='Выполнен'
      AND o.payment_method='cash' AND o.payment_received_by='master'
      AND NOT EXISTS(SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id)
      AND (r.order_id IS NULL OR r.held_amount>e.paid_amount)
  ) THEN
    RAISE EXCEPTION 'Не подтверждены прежние суммы наличных у мастера' USING ERRCODE='23514';
  END IF;

  v_cutoff:=clock_timestamp();
  INSERT INTO private.rabota_payroll_policy_v3(master_user_id,activated_at,approved_by,backup_reference)
  VALUES(p_master_user_id,v_cutoff,p_approved_by,btrim(p_backup_reference));

  -- Carry forward only the individually confirmed amount still held. Old
  -- transfers/receipts and payout rows are never synthesized or overwritten.
  INSERT INTO public.rabota_cash_collections(
    order_id,master_user_id,gross,raul_amount,timur_amount,company_amount,payroll_separate
  )
  SELECT o.id,p_master_user_id,r.held_amount,0,0,r.held_amount,true
  FROM private.rabota_payroll_cash_review_v3 r
  JOIN public.rabota_orders o ON o.id=r.order_id
  WHERE o.assigned_user_id=p_master_user_id AND o.paid AND o.status='Выполнен'
    AND o.payment_method='cash' AND o.payment_received_by='master' AND r.held_amount>0
    AND NOT EXISTS(SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id);
  RETURN v_cutoff;
END;
$activate$;
REVOKE ALL ON FUNCTION private.rabota_payroll_activate_v3(uuid,uuid,text)
FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.rabota_capture_payroll_payment_v3()
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
  IF NEW.payment_method='cash' AND NEW.payment_received_by='master' THEN
    INSERT INTO public.rabota_cash_collections(
      order_id,master_user_id,gross,raul_amount,timur_amount,company_amount,payroll_separate
    ) VALUES (
      NEW.id,NEW.assigned_user_id,NEW.payment_amount,0,0,NEW.payment_amount,true
    );
  END IF;
  RETURN NEW;
END;
$capture$;
REVOKE ALL ON FUNCTION private.rabota_capture_payroll_payment_v3()
FROM PUBLIC,anon,authenticated;

CREATE TRIGGER rabota_capture_payroll_payment_v3
AFTER UPDATE OF paid ON public.rabota_orders FOR EACH ROW
WHEN (OLD.paid IS DISTINCT FROM true AND NEW.paid IS TRUE)
EXECUTE FUNCTION private.rabota_capture_payroll_payment_v3();

CREATE FUNCTION private.rabota_payroll_operations_v3(p_master_user_id uuid, p_activated_at timestamptz)
RETURNS TABLE(
  id uuid, order_id uuid, amount numeric, created_at timestamptz,
  payment_method text, note text, kind text
)
LANGUAGE sql STABLE SET search_path TO ''
AS $operations$
  SELECT f.id,f.order_id,coalesce(r.credited_amount,f.amount),f.created_at,f.payment_method,f.note,
    CASE WHEN r.operation_id IS NULL THEN 'v3'
         WHEN f.kind='timur_payout' THEN 'legacy_on_behalf'
         ELSE 'legacy' END
  FROM public.rabota_finance_operations f
  LEFT JOIN private.rabota_payroll_payout_review_v3 r ON r.operation_id=f.id
  WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
    AND f.kind IN ('raul_payout','timur_payout')
    AND (r.credited_amount>0 OR (r.operation_id IS NULL AND f.kind='raul_payout'
                               AND f.created_at>=p_activated_at))
$operations$;

CREATE FUNCTION private.rabota_payroll_totals_v3(p_master_user_id uuid, p_activated_at timestamptz)
RETURNS TABLE(earned numeric, paid numeric)
LANGUAGE sql STABLE SET search_path TO ''
AS $totals$
  SELECT
    (SELECT coalesce(sum(e.earned_amount),0)
     FROM private.rabota_payroll_earnings_v3 e
     WHERE e.master_user_id=p_master_user_id
       AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_refunds_v3 r WHERE r.order_id=e.order_id)),
    (SELECT coalesce(sum(p.amount),0) FROM private.rabota_payroll_operations_v3(p_master_user_id,p_activated_at) p)
$totals$;

REVOKE ALL ON FUNCTION private.rabota_payroll_operations_v3(uuid,timestamptz),
  private.rabota_payroll_totals_v3(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.rabota_payroll_snapshot_v3()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $snapshot$
DECLARE
  v_actor uuid:=auth.uid();
  v_role text:=(SELECT private.rabota_my_role());
  v_policy private.rabota_payroll_policy_v3%rowtype;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к расчётам' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN RETURN jsonb_build_object('version',3,'state','inactive'); END IF;
  IF v_role<>'owner' AND (v_role<>'master' OR v_actor<>v_policy.master_user_id) THEN
    RETURN jsonb_build_object('version',3,'state','not_applicable','activated_at',v_policy.activated_at);
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
      ),'[]'::jsonb)
    )
    FROM private.rabota_payroll_totals_v3(v_policy.master_user_id,v_policy.activated_at) t
  );
END;
$snapshot$;

CREATE FUNCTION public.rabota_payroll_payout_v3(
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
    'due',v_totals.earned-v_totals.paid,'replayed',v_replayed);
END;
$payout$;

REVOKE ALL ON FUNCTION public.rabota_payroll_snapshot_v3(),
  public.rabota_payroll_payout_v3(numeric,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_snapshot_v3(),
  public.rabota_payroll_payout_v3(numeric,text,text,uuid,uuid) TO authenticated;

CREATE FUNCTION public.rabota_payroll_refund_v3(
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
  IF v_order.payment_received_by IS DISTINCT FROM 'company'
    OR EXISTS(SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=p_order_id) THEN
    RAISE EXCEPTION 'Для денег, принятых мастером, сначала нужна сверка движения средств' USING ERRCODE='23514';
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
REVOKE ALL ON FUNCTION public.rabota_payroll_refund_v3(uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_refund_v3(uuid,numeric,text,uuid) TO authenticated;

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
  if exists(select 1 from public.rabota_cash_collections where order_id=p_order_id) then
    raise exception 'По этому заказу уже создано финансовое распределение';
  end if;
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
 perform 1 from public.rabota_members
 where user_id=auth.uid() and role='master' and active=true
   and lower(btrim(master_name))='рауль' for update;
 if not found then
  raise exception 'Доступ к распределению не предоставлен';
 end if;
 if exists (select 1 from private.rabota_payroll_policy_v3) then
  raise exception 'Зарплата учитывается отдельно. Передавайте наличные через раздел платежей'
    using errcode='23514';
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

CREATE OR REPLACE FUNCTION public.rabota_finance_record(p_kind text, p_amount numeric, p_master_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_accrued numeric(14,2);
  v_already numeric(14,2);
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

    if exists (select 1 from private.rabota_payroll_policy_v3) then
      raise exception 'Откройте новый раздел зарплаты для выплаты' using errcode='23514';
    end if;
    if v_kind='raul_payout' then
      select coalesce(sum(round(o.price*0.50,2)),0) into v_accrued
      from public.rabota_orders o
      where o.assigned_user_id=p_master_user_id
        and o.status='Выполнен' and o.paid=true;
    else
      select coalesce(count(*)*1500,0) into v_accrued
      from public.rabota_orders o
      where o.assigned_user_id=p_master_user_id
        and o.status='Выполнен' and o.paid=true;
    end if;
    select coalesce(sum(f.amount),0) into v_already
    from public.rabota_finance_operations f
    where f.kind=v_kind and f.master_user_id=p_master_user_id and f.voided_at is null;
    if v_accrued-v_already < p_amount then
      raise exception 'Сумма больше доступного баланса. Доступно: % ₽',greatest(0,v_accrued-v_already);
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

CREATE OR REPLACE FUNCTION public.rabota_finance_void(p_operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_payroll_master uuid;
begin
 if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
  raise exception 'Только администратор может отменить операцию';
 end if;
 select master_user_id into v_payroll_master from public.rabota_finance_operations
 where id=p_operation_id and kind in ('raul_payout','timur_payout');
 if found then
  perform 1 from public.rabota_members where user_id=v_payroll_master for update;
  if exists (select 1 from private.rabota_payroll_policy_v3) then
   raise exception 'Проведённая зарплата защищена от отмены без сверки' using errcode='23514';
  end if;
 end if;
 update public.rabota_finance_operations
 set voided_at=now(),voided_by=auth.uid()
 where id=p_operation_id and voided_at is null and order_id is null;
 if not found then raise exception 'Операция не найдена или автоматически учтена в распределении заказа'; end if;
 return true;
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
 v_accrued numeric(14,2);
 v_paid numeric(14,2);
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
 if exists (select 1 from private.rabota_payroll_policy_v3) then
  raise exception 'Откройте новый раздел зарплаты для выплаты' using errcode='23514';
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
  v_refund_owner name;
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
    IF NOT (COALESCE(v_payment_allowed,FALSE) OR COALESCE(v_cash_allowed,FALSE)) THEN
      RAISE EXCEPTION 'Прямое изменение оплаты запрещено: используйте RPC'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
