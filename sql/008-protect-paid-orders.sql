-- CRM «Работа», этап 1: immutable business data for already-paid orders.
-- Draft for review; does not modify any existing order or finance record.
-- Existing private.rabota_cash_order_guard() stays in place.
-- Postgres 17; deploy only after approval and preview verification.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.rabota_paid_order_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $guard$
DECLARE
  allow_legacy_cash_completion boolean;
BEGIN
  IF OLD.paid IS TRUE
     OR OLD.payment_method IS NOT NULL
     OR OLD.payment_amount IS NOT NULL
     OR OLD.payment_received_by IS NOT NULL
     OR OLD.paid_at IS NOT NULL
     OR OLD.paid_by IS NOT NULL
  THEN
    -- The financial/appointment/client facts of an already-paid order cannot
    -- be changed through REST PATCH or any ordinary UPDATE.
    -- updated_at is intentionally excluded: a harmless technical refresh.
    IF ROW(
      NEW.name, NEW.phone, NEW.address, NEW.radiator_type,
      NEW.radiators, NEW.floor_loops, NEW.master,
      NEW.appointment_date, NEW.appointment_time, NEW.price,
      NEW.paid, NEW.status, NEW.details, NEW.legacy_id,
      NEW.created_by, NEW.completed_at, NEW.created_at,
      NEW.assigned_user_id, NEW.lead_id
    ) IS DISTINCT FROM ROW(
      OLD.name, OLD.phone, OLD.address, OLD.radiator_type,
      OLD.radiators, OLD.floor_loops, OLD.master,
      OLD.appointment_date, OLD.appointment_time, OLD.price,
      OLD.paid, OLD.status, OLD.details, OLD.legacy_id,
      OLD.created_by, OLD.completed_at, OLD.created_at,
      OLD.assigned_user_id, OLD.lead_id
    ) THEN
      RAISE EXCEPTION 'Оплаченный заказ защищён от редактирования. Исправление требует отдельной процедуры'
        USING ERRCODE = '23514';
    END IF;

    IF ROW(NEW.payment_method, NEW.payment_amount,
           NEW.payment_received_by, NEW.paid_at, NEW.paid_by)
       IS DISTINCT FROM ROW(OLD.payment_method, OLD.payment_amount,
                            OLD.payment_received_by, OLD.paid_at, OLD.paid_by)
    THEN
      -- Preserve the existing RPC rabota_cash_distribute for OLD, legacy paid
      -- orders with empty metadata. This exception is only for the assigned
      -- master, and only when filling the exact cash-receipt fields.
      allow_legacy_cash_completion :=
        OLD.paid IS TRUE
        AND OLD.payment_method IS NULL
        AND OLD.payment_amount IS NULL
        AND OLD.payment_received_by IS NULL
        AND OLD.paid_at IS NULL
        AND OLD.paid_by IS NULL
        AND NEW.payment_method = 'cash'
        AND NEW.payment_amount = OLD.price
        AND NEW.payment_received_by = 'master'
        AND NEW.paid_at IS NOT NULL
        AND NEW.paid_by = (SELECT auth.uid())
        AND OLD.assigned_user_id = (SELECT auth.uid())
        AND (SELECT private.rabota_my_role()) = 'master'
        AND OLD.status IN ('В работе', 'Выполнен')
        AND NOT EXISTS (
          SELECT 1 FROM public.rabota_cash_collections c
          WHERE c.order_id = OLD.id
        );

      IF NOT COALESCE(allow_legacy_cash_completion, FALSE) THEN
        RAISE EXCEPTION 'Реквизиты оплаты защищены от изменения'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE OR REPLACE TRIGGER rabota_paid_order_guard_trigger
  BEFORE UPDATE ON public.rabota_orders
  FOR EACH ROW EXECUTE FUNCTION private.rabota_paid_order_guard();

COMMENT ON FUNCTION private.rabota_paid_order_guard()
  IS 'Rabota: locks paid order data; allows legacy cash metadata fill only for assigned master.';
COMMIT;
