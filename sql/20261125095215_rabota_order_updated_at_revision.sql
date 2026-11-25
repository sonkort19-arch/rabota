-- PostgREST clients may compare the original updated_at in their PATCH filter.
-- Preserve stored revisions and assign each subsequent write a new server value.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.rabota_orders IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.rabota_orders'::pg_catalog.regclass
      AND attname = 'updated_at' AND NOT attisdropped
      AND atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype
      AND atttypmod IN (-1, 6)
  ) THEN
    RAISE EXCEPTION 'Order revision requires a microsecond-precision timestamptz updated_at.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rabota_orders WHERE NOT pg_catalog.isfinite(updated_at)) THEN
    RAISE EXCEPTION 'Non-finite order revisions require review before installing the order revision trigger.';
  END IF;
END;
$preflight$;

CREATE FUNCTION private.rabota_stamp_order_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $stamp$
BEGIN
  -- A late or fast client clock cannot move the revision back. PostgreSQL
  -- rechecks a conditional UPDATE after waiting for a competing row writer.
  IF TG_OP = 'UPDATE' AND OLD.updated_at IS NOT NULL THEN
    NEW.updated_at := GREATEST(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  ELSE
    NEW.updated_at := pg_catalog.clock_timestamp();
  END IF;
  RETURN NEW;
END;
$stamp$;

REVOKE ALL ON FUNCTION private.rabota_stamp_order_updated_at() FROM PUBLIC, anon, authenticated;

-- PostgreSQL runs same-kind triggers by name. Stamp after order validation.
CREATE TRIGGER zz_rabota_orders_updated_at_revision
BEFORE INSERT OR UPDATE ON public.rabota_orders
FOR EACH ROW EXECUTE FUNCTION private.rabota_stamp_order_updated_at();

COMMENT ON TRIGGER zz_rabota_orders_updated_at_revision ON public.rabota_orders IS
  'Server order version for conditional writes; preserves original revisions until first write.';

COMMIT;

-- Schema rollback in one transaction: drop zz_rabota_orders_updated_at_revision
-- from public.rabota_orders, then drop private.rabota_stamp_order_updated_at().
-- Already recorded revisions and order data stay intact.
