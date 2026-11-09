-- Emergency read-only mode; keeps C1 and all integrity/idempotency fixes. No row rewrites.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION private.rabota_release_readonly()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NOT NULL OR current_user IN ('anon','authenticated') THEN
  RAISE EXCEPTION 'CRM временно доступна только для чтения. Операция не проведена.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN old; END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_orders ON public.rabota_orders;
CREATE TRIGGER a00_release_readonly_rabota_orders BEFORE INSERT OR UPDATE OR DELETE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_release_readonly();
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_leads ON public.rabota_leads;
CREATE TRIGGER a00_release_readonly_rabota_leads BEFORE INSERT OR UPDATE OR DELETE ON public.rabota_leads FOR EACH ROW EXECUTE FUNCTION private.rabota_release_readonly();
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_finance_operations ON public.rabota_finance_operations;
CREATE TRIGGER a00_release_readonly_rabota_finance_operations BEFORE INSERT OR UPDATE OR DELETE ON public.rabota_finance_operations FOR EACH ROW EXECUTE FUNCTION private.rabota_release_readonly();
DROP TRIGGER IF EXISTS a00_release_readonly_rabota_cash_collections ON public.rabota_cash_collections;
CREATE TRIGGER a00_release_readonly_rabota_cash_collections BEFORE INSERT OR UPDATE OR DELETE ON public.rabota_cash_collections FOR EACH ROW EXECUTE FUNCTION private.rabota_release_readonly();
COMMIT;
