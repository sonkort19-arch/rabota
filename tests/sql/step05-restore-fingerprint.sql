-- Deterministic non-sensitive fingerprint for synthetic restore comparisons.
-- This file is for disposable test databases only.
\set ON_ERROR_STOP on
SELECT 'members|'||
 md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id)::text
              FROM public.rabota_members t),'[]')) AS fingerprint
UNION ALL
SELECT 'orders|'||
 md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text
              FROM public.rabota_orders t),'[]'))
UNION ALL
SELECT 'collections|'||
 md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.order_id)::text
              FROM public.rabota_cash_collections t),'[]'))
UNION ALL
SELECT 'finance|'||
 md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text
              FROM public.rabota_finance_operations t),'[]'))
UNION ALL
SELECT 'cashbook|'||
 md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text
              FROM public.rabota_cashbook_entries t),'[]'))
UNION ALL
SELECT 'rls|'||md5(coalesce((
  SELECT string_agg(c.relname||':'||c.relrowsecurity::text,E'\n'
                    ORDER BY c.relname)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname LIKE 'rabota_%'
    AND c.relkind='r'), ''))
UNION ALL
SELECT 'policies|'||md5(coalesce((
  SELECT string_agg(p.tablename||':'||p.policyname||':'||p.cmd||':'||
                    coalesce(p.qual,'')||':'||coalesce(p.with_check,''),
                    E'\n' ORDER BY p.tablename,p.policyname)
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname='public' AND p.tablename LIKE 'rabota_%'),''))
UNION ALL
SELECT 'triggers|'||md5(coalesce((
  SELECT string_agg(c.relname||':'||t.tgname||':'||
                    pg_catalog.pg_get_triggerdef(t.oid),E'\n'
                    ORDER BY c.relname,t.tgname)
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname LIKE 'rabota_%'
    AND NOT t.tgisinternal),''))
UNION ALL
SELECT 'functions|'||md5(coalesce((
  SELECT string_agg(n.nspname||'.'||p.proname||':'||
                    pg_catalog.pg_get_functiondef(p.oid),E'\n'
                    ORDER BY n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid))
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname IN (
    'rabota_paid_order_guard','rabota_record_order_payment',
    'rabota_cash_distribute','rabota_salary_payout_v2',
    'rabota_cash_order_guard','rabota_my_role')),''))
ORDER BY fingerprint;
