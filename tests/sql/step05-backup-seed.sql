-- Synthetic data, ephemeral PostgreSQL 17 ONLY.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.rabota_record_order_payment(
  '10000000-0000-4000-8000-000000000001',13000,'card');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000002');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.rabota_salary_payout_v2(
  'raul_payout',2500,'cash','Synthetic backup payout',
  '20000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000003');
COMMIT;
DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.rabota_orders)<>8
    OR (SELECT count(*) FROM public.rabota_orders WHERE paid)<>5
    OR (SELECT count(*) FROM public.rabota_cash_collections)<>1
    OR (SELECT count(*) FROM public.rabota_finance_operations)<>3
    OR NOT EXISTS (
      SELECT 1 FROM public.rabota_orders
      WHERE id='10000000-0000-4000-8000-000000000001'
        AND paid AND price=13000 AND payment_method='card')
    OR NOT EXISTS (
      SELECT 1 FROM public.rabota_finance_operations
      WHERE request_id='20000000-0000-4000-8000-000000000020'
        AND kind='raul_payout' AND amount=2500) THEN
     RAISE EXCEPTION 'FAIL: synthetic backup source dataset differs from expected';
  END IF;
END $verify$;
SELECT 'PASS: synthetic paid orders, cash and salary seeded' AS result;
