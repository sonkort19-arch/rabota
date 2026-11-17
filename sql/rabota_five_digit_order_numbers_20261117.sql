-- CRM Работа: stable, unique five-digit order numbers.
-- The existing UUID primary key, finance RPCs, RLS and business fields are unchanged.
-- Backfill every historical order by created_at, breaking ties by UUID.
-- A sequence (NO CYCLE) guarantees no duplicates or re-use after deletion.
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.rabota_orders IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.rabota_orders
  ADD COLUMN order_number integer;

CREATE SEQUENCE public.rabota_order_number_seq
  AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 99999 START WITH 1 CACHE 1 NO CYCLE;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)::integer AS assigned_number
  FROM public.rabota_orders
)
UPDATE public.rabota_orders AS orders
SET order_number = numbered.assigned_number
FROM numbered
WHERE orders.id = numbered.id;

SELECT pg_catalog.setval(
  'public.rabota_order_number_seq'::pg_catalog.regclass,
  COALESCE((SELECT MAX(order_number) FROM public.rabota_orders), 1),
  EXISTS(SELECT 1 FROM public.rabota_orders)
);

ALTER TABLE public.rabota_orders
  ALTER COLUMN order_number SET NOT NULL,
  ADD CONSTRAINT rabota_orders_order_number_unique UNIQUE (order_number),
  ADD CONSTRAINT rabota_orders_order_number_five_digits CHECK (order_number BETWEEN 1 AND 99999);

ALTER SEQUENCE public.rabota_order_number_seq
  OWNED BY public.rabota_orders.order_number;

-- Trigger functions are private, SECURITY INVOKER and do not bypass RLS.
-- A caller cannot choose a new order number or overwrite an existing one.
CREATE FUNCTION private.rabota_order_number_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.order_number := pg_catalog.nextval('public.rabota_order_number_seq'::pg_catalog.regclass);
  ELSIF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Номер заказа нельзя менять'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.rabota_order_number_guard() FROM PUBLIC;

CREATE TRIGGER rabota_order_number_guard_trigger
BEFORE INSERT OR UPDATE ON public.rabota_orders
FOR EACH ROW
EXECUTE FUNCTION private.rabota_order_number_guard();

-- PostgreSQL checks nextval privileges under the inserting user's role.
GRANT USAGE ON SEQUENCE public.rabota_order_number_seq TO authenticated, service_role;

COMMENT ON COLUMN public.rabota_orders.order_number IS
  'Immutable unique 1..99999 number formatted as №00001 in CRM; UUID remains the primary key';

NOTIFY pgrst, 'reload schema';
