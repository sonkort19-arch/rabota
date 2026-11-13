-- An intentionally changed fake RPC in DISPOSABLE test database.
-- It must be detected by the preflight hash check, before trigger installation.
CREATE OR REPLACE FUNCTION public.rabota_record_order_payment(
  p_order_id uuid,p_amount numeric,p_method text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $drift$
BEGIN
  RETURN pg_catalog.jsonb_build_object('test_only',true);
END;
$drift$;
