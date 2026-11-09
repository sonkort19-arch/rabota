-- CRM «Работа»: owner-only deletion of orders with no payment or financial ties.
-- Apply before publishing the matching frontend. No existing orders are modified.
-- The RPC is the ONLY authenticated delete path: no DELETE RLS policy is added.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30000ms';

DO $guard$
BEGIN
  IF pg_catalog.to_regclass('public.rabota_orders') IS NULL
    OR pg_catalog.to_regclass('public.rabota_members') IS NULL
    OR pg_catalog.to_regclass('public.rabota_finance_operations') IS NULL
    OR pg_catalog.to_regclass('public.rabota_cash_collections') IS NULL
    OR pg_catalog.to_regclass('public.rabota_ai_order_drafts') IS NULL
  THEN
    RAISE EXCEPTION 'The required CRM tables are missing; refuse deployment';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='rabota_orders' AND cmd='DELETE')
  THEN
    RAISE EXCEPTION 'Direct DELETE policy exists: review authorization before installing RPC';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.rabota_delete_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE
  v_order public.rabota_orders%ROWTYPE;
BEGIN
  -- Caller-supplied role flags and order ownership never authorize deletion.
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rabota_members m
    WHERE m.user_id = auth.uid() AND m.role = 'owner' AND m.active = true
  ) THEN
    RAISE EXCEPTION 'Удалять заказы может только владелец'
      USING ERRCODE='42501';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Укажите заказ для удаления' USING ERRCODE='22023';
  END IF;

  -- Lock before checking payment fields. Payment RPCs lock the same row.
  SELECT * INTO v_order
  FROM public.rabota_orders
  WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ уже удалён или не найден' USING ERRCODE='P0002';
  END IF;

  -- Legacy paid orders are protected even when no finance ledger row exists.
  IF v_order.paid IS TRUE
     OR v_order.payment_method IS NOT NULL
     OR v_order.payment_amount IS NOT NULL
     OR v_order.payment_received_by IS NOT NULL
     OR v_order.paid_at IS NOT NULL
     OR v_order.paid_by IS NOT NULL
  THEN
    RAISE EXCEPTION 'Этот заказ отмечен как оплаченный. Удаление запрещено'
      USING ERRCODE='23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rabota_finance_operations f WHERE f.order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id = p_order_id)
  THEN
    RAISE EXCEPTION 'По заказу есть финансовые операции или распределение денег. Удаление запрещено'
      USING ERRCODE='23514';
  END IF;

  -- Do not corrupt an existing AI draft/history by removing its referenced order.
  IF EXISTS (
    SELECT 1 FROM public.rabota_ai_order_drafts d
    WHERE d.target_order_id = p_order_id OR d.result_order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'Заказ связан с действием ИИ. Для безопасности удаление запрещено'
      USING ERRCODE='23503';
  END IF;

  DELETE FROM public.rabota_orders WHERE id=p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не удалось удалить' USING ERRCODE='P0002';
  END IF;
  -- Associated non-financial order notifications are removed via existing FK CASCADE.
  RETURN pg_catalog.jsonb_build_object('ok',true,'order_id',p_order_id);
END;
$body$;

-- Do not grant DELETE on the underlying table to any frontend role.
REVOKE ALL ON FUNCTION public.rabota_delete_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rabota_delete_order(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rabota_delete_order(uuid) TO authenticated;
COMMIT;

-- Verification (read only):
-- SELECT has_function_privilege('anon','public.rabota_delete_order(uuid)','EXECUTE');
-- SELECT has_function_privilege('authenticated','public.rabota_delete_order(uuid)','EXECUTE');
-- SELECT pg_get_functiondef('public.rabota_delete_order(uuid)'::regprocedure);
