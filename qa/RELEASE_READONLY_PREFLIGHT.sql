-- CRM «Работа» release verification, READ ONLY.
-- Can be executed by an authorized administrator to produce aggregate
-- deployment evidence. Does NOT modify or back up any data.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT pg_catalog.now() AT TIME ZONE 'UTC' AS audit_utc,
       pg_catalog.current_setting('server_version') AS postgres_version,
       pg_catalog.current_database() AS database_name;

SELECT 'orders_all' AS metric, count(*)::text AS value
FROM public.rabota_orders
UNION ALL
SELECT 'orders_paid',count(*)::text FROM public.rabota_orders WHERE paid
UNION ALL
SELECT 'legacy_paid_missing_metadata',count(*)::text
 FROM public.rabota_orders WHERE paid
  AND payment_method IS NULL AND payment_amount IS NULL
  AND payment_received_by IS NULL AND paid_at IS NULL AND paid_by IS NULL
UNION ALL
SELECT 'cash_collections',count(*)::text FROM public.rabota_cash_collections
UNION ALL
SELECT 'finance_operations',count(*)::text FROM public.rabota_finance_operations
ORDER BY metric;

SELECT p.proname AS rpc,pg_catalog.md5(p.prosrc) AS source_md5,
       p.prosecdef AS security_definer, pg_catalog.pg_get_userbyid(p.proowner) AS function_owner
FROM pg_catalog.pg_proc p
WHERE p.oid IN (
 'public.rabota_record_order_payment(uuid,numeric,text)'::pg_catalog.regprocedure,
 'public.rabota_cash_distribute(uuid)'::pg_catalog.regprocedure,
 'public.rabota_salary_payout_v2(text,numeric,text,text,uuid,uuid)'::pg_catalog.regprocedure
)
ORDER BY p.proname;

SELECT
 count(*) FILTER (WHERE t.tgname='rabota_paid_order_guard_trigger' AND t.tgenabled='O') AS active_paid_guard,
 count(*) FILTER (WHERE t.tgname='rabota_cash_order_guard_trigger' AND t.tgenabled='O') AS active_cash_guard
FROM pg_catalog.pg_trigger t
WHERE t.tgrelid='public.rabota_orders'::pg_catalog.regclass
 AND NOT t.tgisinternal;

SELECT t.tgname AS trigger_name,t.tgenabled AS enabled,
       t.tgrelid::pg_catalog.regclass::text AS table_name
FROM pg_catalog.pg_trigger t
WHERE t.tgrelid='public.rabota_orders'::pg_catalog.regclass
 AND NOT t.tgisinternal
ORDER BY t.tgname;

SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,
 (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid) AS policies
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rabota_%'
ORDER BY c.relname;

-- This script NEVER applies 008/009, changes policies or provisions users.
ROLLBACK;
