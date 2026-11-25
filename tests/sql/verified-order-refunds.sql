-- Synthetic orders only. Verify that customer refunds and payroll reversals
-- share a receipt but stay separate when an order has no payroll earning.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price) VALUES
 ('10000000-0000-4000-8000-000000000190','Fixture refund other master','Олег',
  '00000000-0000-4000-8000-000000000004','В работе',3456.78),
 ('10000000-0000-4000-8000-000000000191','Fixture refund unassigned','',NULL,'В работе',6000),
 ('10000000-0000-4000-8000-000000000192','Fixture unpaid cannot refund','',NULL,'Выполнен',4800),
 ('10000000-0000-4000-8000-000000000193','Fixture payroll review cannot refund','Рауль',
  '00000000-0000-4000-8000-000000000003','В работе',7500);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000190',3456.78,'cash');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000191',6000,'card');
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000193',7500,'card');
RESET ROLE;
INSERT INTO private.rabota_payroll_cutover_holds_v3(order_id,payroll_on_hold,reason,verified_by)
VALUES ('10000000-0000-4000-8000-000000000193',true,'Fixture pending review',
        '00000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;

DO $owner_refunds$
DECLARE
  v_other constant uuid:='10000000-0000-4000-8000-000000000190';
  v_unassigned constant uuid:='10000000-0000-4000-8000-000000000191';
  v_unpaid constant uuid:='10000000-0000-4000-8000-000000000192';
  v_request uuid:=gen_random_uuid();
  v_before jsonb:=public.rabota_payroll_snapshot_v3();
  v_after jsonb;
  v_receipt jsonb;
  v_replay jsonb;
BEGIN
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(v_unassigned,5999.99,'Fixture partial refund denied',gen_random_uuid());
    RAISE EXCEPTION 'Accepted a partial refund';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(v_unpaid,4800,'Fixture unpaid refund denied',gen_random_uuid());
    RAISE EXCEPTION 'Refunded an unpaid order';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3('10000000-0000-4000-8000-000000000193',
      7500,'Fixture protected hold',gen_random_uuid());
    RAISE EXCEPTION 'Refunded an order still under review';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM LIKE 'По заказу продолжается сверка%';
  END;

  v_receipt:=public.rabota_payroll_refund_v3(v_other,3456.78,'Fixture actual refund',v_request);
  ASSERT v_receipt->>'order_id'=v_other::text AND (v_receipt->>'amount')::numeric=3456.78;
  ASSERT NOT (v_receipt->>'replayed')::boolean;
  v_replay:=public.rabota_payroll_refund_v3(v_other,3456.78,'Fixture actual refund',v_request);
  ASSERT (v_replay->>'replayed')::boolean;
  ASSERT v_replay->>'refunded_at'=v_receipt->>'refunded_at';
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(v_other,3456.78,'Fixture different intent reused key',v_request);
    RAISE EXCEPTION 'Accepted a reused request ID for different refund details';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(v_other,3456.78,'Fixture second refund denied',gen_random_uuid());
    RAISE EXCEPTION 'Refunded the same order twice under different request IDs';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.rabota_payroll_refund_v3(v_unassigned,6000,'Fixture refund without assignment',gen_random_uuid());

  v_after:=public.rabota_payroll_snapshot_v3();
  ASSERT v_after->'accounting_receipts'=v_before->'accounting_receipts';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(v_after->'accounting_refunds') r
           WHERE r->>'order_id' IN (v_other::text,v_unassigned::text))=2;
  ASSERT (SELECT sum((r->>'amount')::numeric) FROM jsonb_array_elements(v_after->'accounting_refunds') r
           WHERE r->>'order_id' IN (v_other::text,v_unassigned::text))=9456.78;
  ASSERT (v_after->'accounting_refunds') @> (v_before->'accounting_refunds');
  ASSERT v_after->'refunds'=v_before->'refunds';
  ASSERT v_after->'orders'=v_before->'orders' AND v_after->'payouts'=v_before->'payouts';
  ASSERT v_after->'earned'=v_before->'earned' AND v_after->'paid'=v_before->'paid' AND v_after->'due'=v_before->'due';
  ASSERT EXISTS (SELECT 1 FROM public.rabota_orders WHERE id=v_other AND status='Отменён' AND paid
    AND payment_amount=3456.78 AND payment_method='cash' AND payment_received_by='master'
    AND paid_by='00000000-0000-4000-8000-000000000004');
  ASSERT EXISTS (SELECT 1 FROM public.rabota_orders WHERE id=v_unassigned AND status='Отменён' AND paid
    AND payment_amount=6000 AND payment_method='card' AND assigned_user_id IS NULL);
END;
$owner_refunds$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
DO $other_master$
DECLARE v jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT v->>'state'='not_applicable' AND NOT (v ? 'refunds');
  ASSERT jsonb_array_length(v->'accounting_refunds')=1;
  ASSERT v->'accounting_refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000190","amount":3456.78}]';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'accounting_refunds') qr WHERE qr ? 'note');
  BEGIN
    PERFORM public.rabota_payroll_refund_v3('10000000-0000-4000-8000-000000000190',3456.78,'Fixture master denied',gen_random_uuid());
    RAISE EXCEPTION 'A master recorded a refund';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$other_master$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $payroll_master$
DECLARE v jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT NOT v->'accounting_refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000190"}]';
  ASSERT NOT v->'accounting_refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000191"}]';
  ASSERT v->'accounting_refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000040","amount":10000}]';
END;
$payroll_master$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
BEGIN
  ASSERT NOT (public.rabota_payroll_snapshot_v3() ? 'accounting_refunds');
  BEGIN
    PERFORM public.rabota_payroll_refund_v3('10000000-0000-4000-8000-000000000191',6000,'Fixture manager denied',gen_random_uuid());
    RAISE EXCEPTION 'A manager recorded a refund';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$manager$;

ROLLBACK;
SELECT 'PASS: verified full refunds for assigned and unassigned orders, replay, immutable receipts and scoped accounting';
