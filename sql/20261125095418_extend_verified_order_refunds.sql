-- Keep a single immutable refund per verified customer order, including orders
-- without a payroll accrual. Existing payment, refund and payroll records stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.rabota_payroll_refund_v3(uuid,numeric,text,uuid)', '026708c028898673edd0e6ee4cefea08', true),
      ('public.rabota_payroll_snapshot_v3()', '82b00c7f28a62422c1843f23094a288c', true),
      ('private.rabota_accounting_receipts_v1(uuid)', 'd1067c8cc9ab66212f65c68899034119', false),
      ('private.rabota_paid_order_guard()', '22d3d608e3c8dcb2f4565ae443333204', false)
    ) AS baseline(signature, source_md5, security_definer)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(baseline.signature)
    WHERE pg_catalog.md5(p.prosrc) IS DISTINCT FROM baseline.source_md5
       OR p.prosecdef IS DISTINCT FROM baseline.security_definer
       OR ('search_path=""'=ANY(p.proconfig)) IS DISTINCT FROM true
       OR p.proowner IS DISTINCT FROM CURRENT_USER::regrole::oid
  ) THEN
    RAISE EXCEPTION 'Refund or accounting definitions changed. Re-audit before installation.';
  END IF;
END;
$preflight$;

ALTER TABLE private.rabota_payroll_refunds_v3
  DROP CONSTRAINT rabota_payroll_refunds_v3_order_id_fkey,
  ADD CONSTRAINT rabota_payroll_refunds_v3_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);

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
  IF NOT FOUND OR v_order.paid IS NOT TRUE OR v_order.status IS DISTINCT FROM 'Выполнен'
    OR v_order.price IS DISTINCT FROM p_amount OR v_order.payment_amount IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION 'Можно подтвердить только полный возврат по однозначно оплаченному заказу' USING ERRCODE='23514';
  END IF;

  IF EXISTS (SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h WHERE h.order_id=p_order_id) THEN
    RAISE EXCEPTION 'По заказу продолжается сверка. Возврат пока недоступен'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_earning FROM private.rabota_payroll_earnings_v3 WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_earning.master_user_id IS DISTINCT FROM v_policy.master_user_id
      OR v_order.assigned_user_id IS DISTINCT FROM v_earning.master_user_id
      OR v_earning.paid_amount IS DISTINCT FROM p_amount THEN
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
  UPDATE public.rabota_orders SET status='Отменён',updated_at=clock_timestamp() WHERE id=p_order_id;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','',true);
  RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',false);
END;
$refund$;

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
    ),'[]'::jsonb),'accounting_refunds',coalesce((
      SELECT jsonb_agg(jsonb_build_object('order_id',r.order_id,'amount',r.amount,'refunded_at',r.refunded_at)
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

COMMENT ON FUNCTION public.rabota_payroll_refund_v3(uuid,numeric,text,uuid) IS
  'Owner-only full verified refund, once per order. Payroll safety checks apply to orders with an accrual.';
COMMENT ON FUNCTION public.rabota_payroll_snapshot_v3() IS
  'Payroll and accounting snapshot. Order receipts and refunds are owner-wide or scoped to the assigned master.';
COMMIT;
