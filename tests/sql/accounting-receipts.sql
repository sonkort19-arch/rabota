-- The runner has upgraded an active payroll v3 ledger with synthetic history.
\set ON_ERROR_STOP on
BEGIN;
DO $archive$
BEGIN
  ASSERT to_regprocedure('public.rabota_cash_distribute(uuid)') IS NULL;
  ASSERT to_regprocedure('public.rabota_cash_submit(uuid)') IS NULL;
  ASSERT to_regprocedure('public.rabota_cash_confirm(uuid)') IS NULL;
  ASSERT to_regprocedure('public.rabota_cash_submit_amount(numeric,uuid,uuid)') IS NULL;
  ASSERT to_regprocedure('public.rabota_cash_confirm_amount(uuid,numeric,numeric)') IS NULL;
  ASSERT NOT has_table_privilege('authenticated','public.rabota_cash_collections','update');
  ASSERT NOT has_table_privilege('authenticated','public.rabota_cash_transfer_events','delete');
  ASSERT NOT has_function_privilege('authenticated','private.rabota_accounting_receipts_v1(uuid)','execute');
  ASSERT EXISTS (SELECT 1 FROM public.rabota_cash_collections WHERE gross=16000 AND confirmed_amount=16000);
  ASSERT (SELECT count(*) FROM public.rabota_cash_transfer_events)>0;
  ASSERT EXISTS (SELECT 1 FROM public.rabota_cashbook_entries WHERE kind='transfer' AND amount=42);
  BEGIN
    UPDATE public.rabota_cash_collections SET gross=gross WHERE false;
    RAISE EXCEPTION 'Historical collections accepted a write';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    TRUNCATE public.rabota_cash_transfer_events;
    RAISE EXCEPTION 'Historical transfer events can be dropped';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END;
$archive$;

UPDATE private.rabota_payroll_policy_v3 SET rate=0.50,bonus=1500,rule_version='v3-50pct-plus-1500';
INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price) VALUES
 ('10000000-0000-4000-8000-000000000080','Fixture new Raul cash','Рауль','00000000-0000-4000-8000-000000000003','В работе',10000),
 ('10000000-0000-4000-8000-000000000081','Fixture company-card without master','',NULL,'В работе',18000);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner_opening$
DECLARE
  v jsonb:=public.rabota_payroll_snapshot_v3();
  v_income_request uuid:=gen_random_uuid();
  v_income_id uuid;
BEGIN
  ASSERT v->>'accounting_version'='1';
  ASSERT jsonb_array_length(v->'accounting_receipts')=8;
  ASSERT (SELECT sum((r->>'amount')::numeric) FROM jsonb_array_elements(v->'accounting_receipts') r)=74596.11;
  ASSERT (SELECT count(DISTINCT r->>'order_id') FROM jsonb_array_elements(v->'accounting_receipts') r)=8;
  ASSERT v->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000030","payment_method":null,"paid_at":null,"amount":10000}]';
  ASSERT v->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000040","amount":10000}]';
  ASSERT v->'refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000040","amount":10000}]';
  ASSERT (SELECT sum((p->>'amount')::numeric) FROM jsonb_array_elements(v->'accounting_payouts') p)=32500;
  ASSERT jsonb_array_length(v->'accounting_payouts')=4;
  BEGIN
    PERFORM public.rabota_cashbook_record_v1('transfer',10,'card','cash','Fixture retired transfer',gen_random_uuid());
    RAISE EXCEPTION 'Retired internal transfer remains writable';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_cashbook_record_v1('income',10,NULL,NULL,'Fixture invalid direction',gen_random_uuid());
    RAISE EXCEPTION 'Missing cashbook direction accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v_income_id:=public.rabota_cashbook_record_v1('income',10,NULL,'cash','Fixture actual income',v_income_request);
  ASSERT v_income_id=public.rabota_cashbook_record_v1('income',10,NULL,'cash','Fixture actual income',v_income_request);
  PERFORM public.rabota_cashbook_record_v1('expense',5,'card',NULL,'Fixture actual expense',gen_random_uuid());
END;
$owner_opening$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
DECLARE v jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT v->>'accounting_version'='1' AND v->>'state'='not_applicable';
  ASSERT NOT (v ?| ARRAY['accounting_receipts','accounting_payouts','orders','refunds','master_id']);
  PERFORM public.rabota_record_order_payment('10000000-0000-4000-8000-000000000081',18000,'card');
END;
$manager$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
DO $other_master$
DECLARE v jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT v->>'accounting_version'='1' AND v->>'state'='not_applicable';
  ASSERT v->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000045","amount":1500}]';
  ASSERT jsonb_array_length(v->'accounting_receipts')=1;
  ASSERT NOT (v ?| ARRAY['accounting_payouts','orders','master_id']);
END;
$other_master$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $raul$
DECLARE
  v jsonb;
  v_order uuid:='10000000-0000-4000-8000-000000000080';
BEGIN
  PERFORM public.rabota_record_order_payment(v_order,10000,'cash');
  v:=public.rabota_payroll_snapshot_v3();
  ASSERT v->>'accounting_version'='1' AND v->>'state'='active';
  ASSERT v->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000080","amount":10000,"payment_method":"cash"}]';
  ASSERT v->'orders' @> '[{"order_id":"10000000-0000-4000-8000-000000000080","earned_amount":6500,"company_share":3500}]';
  ASSERT NOT (v ? 'accounting_payouts');
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'accounting_receipts') r WHERE r->>'master_id' IS DISTINCT FROM auth.uid()::text);
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(v_order,10000,'Fixture master denied',gen_random_uuid());
    RAISE EXCEPTION 'A master refunded a receipt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$raul$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner_refund$
DECLARE
  v_before jsonb:=public.rabota_payroll_snapshot_v3();
  v_after jsonb;
  v_operation jsonb;
  v_order uuid:='10000000-0000-4000-8000-000000000080';
  v_request uuid:=gen_random_uuid();
BEGIN
  ASSERT jsonb_array_length(v_before->'accounting_receipts')=10;
  ASSERT v_before->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000081","master_id":null,"amount":18000}]';
  ASSERT NOT v_before->'orders' @> '[{"order_id":"10000000-0000-4000-8000-000000000081"}]';
  v_operation:=public.rabota_payroll_refund_v3(v_order,10000,'Fixture returned master-received cash',v_request);
  ASSERT NOT (v_operation->>'replayed')::boolean;
  v_operation:=public.rabota_payroll_refund_v3(v_order,10000,'Fixture returned master-received cash',v_request);
  ASSERT (v_operation->>'replayed')::boolean;
  v_after:=public.rabota_payroll_snapshot_v3();
  ASSERT v_after->'accounting_receipts'=v_before->'accounting_receipts';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(v_after->'refunds') r WHERE r->>'order_id'=v_order::text)=1;
  ASSERT v_after->'refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000080","amount":10000,"earned_reversed":6500}]';
  ASSERT (v_after->>'due')::numeric=(v_before->>'due')::numeric-6500;
  BEGIN
    UPDATE public.rabota_orders SET price=1 WHERE id=v_order;
    RAISE EXCEPTION 'Refund enabled direct payment mutation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$owner_refund$;
RESET ROLE;
DO $audit$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.rabota_cash_collections WHERE order_id IN
    ('10000000-0000-4000-8000-000000000080','10000000-0000-4000-8000-000000000081'));
  ASSERT (SELECT count(*) FROM public.rabota_cashbook_entries WHERE kind='transfer' AND amount=42)=1;
  ASSERT (SELECT count(*) FROM public.rabota_cashbook_entries WHERE kind='income' AND amount=10)=1;
  ASSERT (SELECT count(*) FROM public.rabota_cashbook_entries WHERE kind='expense' AND amount=5)=1;
END;
$audit$;
ROLLBACK;
SELECT 'PASS: unique gross receipts, historical cash and payout archives, role isolation, cashbook and refund';
