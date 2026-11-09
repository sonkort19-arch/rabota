-- Emergency read-only mode; keeps C1 and all integrity/idempotency fixes. No row rewrites.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_orders ON public.rabota_orders;
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_leads ON public.rabota_leads;
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_finance_operations ON public.rabota_finance_operations;
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_cash_collections ON public.rabota_cash_collections;
COMMIT;
