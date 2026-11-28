-- Local rehearsal only. These IDs exist only in the ephemeral Auth mock.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $verify$
BEGIN
  IF public.rabota_qa_project_ref() IS DISTINCT FROM 'local-rabota-qa'
    OR (SELECT count(*) FROM public.rabota_members) <> 3
    OR (SELECT count(*) FROM public.rabota_orders) <> 9
    OR (SELECT count(*) FROM public.rabota_leads) <> 2
    OR (SELECT count(*) FROM public.rabota_cashbook_entries) <> 2
    OR (SELECT count(*) FROM public.rabota_finance_operations) <> 2
    OR (SELECT count(*) FROM private.rabota_order_reschedule_events) <> 1
    OR (SELECT count(*) FROM private.rabota_payroll_refunds_v3) <> 1
    OR (SELECT count(*) FROM private.rabota_payroll_travel_events) <> 4
    OR EXISTS (SELECT FROM public.rabota_push_subscriptions)
    OR to_regprocedure('private.rabota_push_new_assignment()') IS NOT NULL
    OR to_regprocedure('public.rabota_internal_push_secrets()') IS NOT NULL
    OR to_regprocedure('public.rabota_register_push_subscription(jsonb)') IS NOT NULL
    OR has_table_privilege('authenticated','public.rabota_push_subscriptions','INSERT,UPDATE,DELETE')
    OR EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname LIKE 'rabota\_%'
        AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
    )
  THEN
    RAISE EXCEPTION 'Synthetic data or outbound isolation verification failed';
  END IF;
END;
$verify$;

SET LOCAL ROLE anon;
DO $anon$
BEGIN
  IF has_table_privilege('public.rabota_orders','SELECT')
    OR has_function_privilege('public.rabota_qa_project_ref()','EXECUTE') THEN
    RAISE EXCEPTION 'An anonymous user can read protected QA state';
  END IF;
END;
$anon$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000001',true);
DO $owner$
DECLARE payroll jsonb := public.rabota_payroll_snapshot_v3();
BEGIN
  IF (SELECT count(*) FROM public.rabota_orders) <> 9
    OR (SELECT count(*) FROM public.rabota_growth_plan) <> 1
    OR (SELECT count(*) FROM public.rabota_ai_chats) <> 1
    OR payroll->>'state' IS DISTINCT FROM 'active'
    OR jsonb_array_length(payroll->'accounting_receipts') IS DISTINCT FROM 2
    OR jsonb_array_length(payroll->'accounting_refunds') IS DISTINCT FROM 1
    OR jsonb_array_length(payroll->'payouts') IS DISTINCT FROM 1
    OR jsonb_array_length(
      public.rabota_order_reschedule_history('a0000000-0000-4000-8000-000000000009')) IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'The owner QA scenario is incomplete';
  END IF;
END;
$owner$;

SELECT set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000002',true);
DO $manager$
BEGIN
  IF (SELECT count(*) FROM public.rabota_orders) <> 9
    OR (SELECT count(*) FROM public.rabota_leads) <> 2
    OR (SELECT count(*) FROM public.rabota_growth_plan) <> 0
    OR (SELECT count(*) FROM public.rabota_cashbook_entries) <> 0
    OR public.rabota_payroll_snapshot_v3()->>'state' IS DISTINCT FROM 'not_applicable'
  THEN
    RAISE EXCEPTION 'The manager QA role does not match existing access rules';
  END IF;
END;
$manager$;

SELECT set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000003',true);
DO $master$
BEGIN
  IF (SELECT count(*) FROM public.rabota_orders) <> 8
    OR (SELECT count(*) FROM public.rabota_leads) <> 0
    OR (SELECT count(*) FROM public.rabota_cashbook_entries) <> 0
    OR public.rabota_payroll_snapshot_v3()->>'state' IS DISTINCT FROM 'active'
    OR jsonb_array_length(
      public.rabota_order_reschedule_history('a0000000-0000-4000-8000-000000000009')) IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'The master QA role does not match existing access rules';
  END IF;
  INSERT INTO public.rabota_orders(name,phone,master,assigned_user_id,appointment_date,appointment_time)
  VALUES ('QA · Проверка прав мастера','+70000000012','Рауль',auth.uid(),
    (now() AT TIME ZONE 'Europe/Moscow')::date+7,TIME '12:00');
  BEGIN
    INSERT INTO public.rabota_orders(name,phone,master,assigned_user_id,appointment_date,appointment_time,status)
    VALUES ('QA · Запрещённый статус','+70000000013','Рауль',auth.uid(),
      (now() AT TIME ZONE 'Europe/Moscow')::date+7,TIME '16:00','Выполнен');
    RAISE EXCEPTION 'Master was allowed to create a completed order';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$master$;
ROLLBACK;
SELECT 'PASS: isolated QA catalog, synthetic personas, roles, finance, calendar and notification isolation';
