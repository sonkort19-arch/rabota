-- Preserve the existing owner-only AI preview/confirm workflow. Apply an
-- explicitly confirmed travel surcharge in the same transaction as creation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.rabota_ai_order_drafts
  ADD COLUMN travel_amount numeric NOT NULL DEFAULT 0,
  ADD CONSTRAINT rabota_ai_order_travel_amount_valid
    CHECK (travel_amount BETWEEN 0 AND 10000000 AND travel_amount = round(travel_amount, 2)
      AND (travel_amount = 0 OR (action = 'create' AND (price IS NULL OR price + travel_amount <= 10000000))));

CREATE FUNCTION public.rabota_ai_prepare_order_v3(
  p_action text, p_client_name text, p_date text, p_time text,
  p_master text DEFAULT NULL, p_phone text DEFAULT NULL, p_address text DEFAULT NULL,
  p_price numeric DEFAULT NULL, p_details text DEFAULT NULL, p_original_date text DEFAULT NULL,
  p_radiators integer DEFAULT NULL, p_floor_loops integer DEFAULT NULL,
  p_travel_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $prepare$
DECLARE
  v_owner uuid := auth.uid();
  v_travel numeric := coalesce(p_travel_amount, 0);
  v_preview jsonb;
BEGIN
  IF v_owner IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'ИИ-действия доступны только владельцу' USING ERRCODE = '42501';
  END IF;
  IF v_travel NOT BETWEEN 0 AND 10000000 OR v_travel <> round(v_travel, 2)
    OR (v_travel > 0 AND (lower(btrim(coalesce(p_action, ''))) <> 'create'
      OR p_price + v_travel > 10000000)) THEN
    RAISE EXCEPTION 'Укажите корректную доплату за дорогу новой заявки' USING ERRCODE = '22023';
  END IF;
  v_preview := public.rabota_ai_prepare_order_v2(p_action, p_client_name, p_date, p_time,
    p_master, p_phone, p_address, p_price, p_details, p_original_date, p_radiators, p_floor_loops);
  UPDATE public.rabota_ai_order_drafts
    SET travel_amount = v_travel
    WHERE id = (v_preview->>'draft_id')::uuid AND owner_id = v_owner AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Не удалось подтвердить данные предпросмотра';
  END IF;
  RETURN v_preview || jsonb_build_object('travel_amount', v_travel);
END;
$prepare$;

CREATE FUNCTION private.rabota_ai_apply_order_travel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $apply$
BEGIN
  IF auth.uid() IS DISTINCT FROM NEW.owner_id
    OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Подтверждение доступно только владельцу' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rabota_orders
    SET travel_amount = NEW.travel_amount
    WHERE id = NEW.result_order_id AND created_by = NEW.owner_id
      AND travel_amount = 0 AND status = 'Записан' AND paid IS FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Не удалось применить доплату к созданной заявке';
  END IF;
  RETURN NEW;
END;
$apply$;

CREATE TRIGGER rabota_ai_confirm_order_travel
AFTER UPDATE OF state ON public.rabota_ai_order_drafts
FOR EACH ROW WHEN (
  OLD.state IS DISTINCT FROM 'applied' AND NEW.state = 'applied'
  AND NEW.action = 'create' AND NEW.travel_amount > 0
)
EXECUTE FUNCTION private.rabota_ai_apply_order_travel();

REVOKE ALL ON FUNCTION public.rabota_ai_prepare_order_v3(
  text,text,text,text,text,text,text,numeric,text,text,integer,integer,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order_v3(
  text,text,text,text,text,text,text,numeric,text,text,integer,integer,numeric) TO authenticated;
REVOKE ALL ON FUNCTION private.rabota_ai_apply_order_travel() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
