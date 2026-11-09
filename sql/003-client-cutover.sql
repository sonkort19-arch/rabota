-- Apply only at the approved cutover window, AFTER 001 and 002.
-- Old tabs retain read access; obsolete mutations fail before any business write.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.rabota_finance_record_v2(uuid,text,numeric,uuid,text)')) THEN
   RAISE EXCEPTION 'Install 002 before cutover';
 END IF;
 IF NOT (SELECT has_function_privilege(proowner,'public.rabota_finance_record(text,numeric,uuid,text)','EXECUTE')
   FROM pg_proc WHERE oid='public.rabota_finance_record_v2(uuid,text,numeric,uuid,text)'::regprocedure) THEN
   RAISE EXCEPTION 'v2 owner cannot execute finance implementation';
 END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.rabota_finance_record(text,numeric,uuid,text) FROM PUBLIC,anon,authenticated;
-- v2 is SECURITY DEFINER; its owner still calls the original implementation.

CREATE OR REPLACE FUNCTION private.rabota_require_order_version()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
BEGIN
  -- SECURITY DEFINER RPCs do their own role/row checks. This gate covers direct REST writes.
  IF current_user='authenticated' THEN
    IF headers->>'x-rabota-client' IS DISTINCT FROM '2' THEN
      RAISE EXCEPTION 'Версия CRM устарела. Обновите страницу перед сохранением.' USING ERRCODE='42501';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF nullif(headers->>'x-rabota-order-version','') IS NULL THEN
        RAISE EXCEPTION 'Нет версии заказа. Откройте заказ заново.' USING ERRCODE='42501';
      END IF;
      IF (headers->>'x-rabota-order-version')::timestamptz IS DISTINCT FROM old.updated_at THEN
        RAISE EXCEPTION 'Заказ изменился на другом устройстве. Откройте его заново.' USING ERRCODE='40001';
      END IF;
    END IF;
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS rabota_orders_client_version ON public.rabota_orders;
CREATE TRIGGER rabota_orders_client_version BEFORE INSERT OR UPDATE ON public.rabota_orders
FOR EACH ROW EXECUTE FUNCTION private.rabota_require_order_version();
COMMIT;
