-- CRM «Работа»: remove the unused order status «Новый».
-- All existing orders were confirmed to use only Записан, В работе, Выполнен, Отменён.
-- Lead statuses in rabota_leads are intentionally out of scope.
-- Atomic: refuses to change constraints if any unconverted «Новый» orders appear.
DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rabota_orders WHERE status = 'Новый') THEN
    RAISE EXCEPTION 'Найдены заказы со статусом Новый; проверьте их перед миграцией';
  END IF;
END;
$block$;

ALTER TABLE public.rabota_orders
  ALTER COLUMN status SET DEFAULT 'Записан';

ALTER TABLE public.rabota_orders
  DROP CONSTRAINT rabota_orders_status_check;

ALTER TABLE public.rabota_orders
  ADD CONSTRAINT rabota_orders_status_check
    CHECK (status IN ('Записан', 'В работе', 'Выполнен', 'Отменён'));

-- Preserve the existing authorization, RLS boundaries, and supported transitions.
CREATE OR REPLACE FUNCTION public.rabota_master_action(p_order_id uuid, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_status text;
  new_status text;
BEGIN
  IF (SELECT private.rabota_my_role()) IS DISTINCT FROM 'master' THEN
    RAISE EXCEPTION 'Доступ запрещён';
  END IF;
  SELECT status INTO current_status
    FROM public.rabota_orders
    WHERE id = p_order_id AND assigned_user_id = auth.uid()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ недоступен'; END IF;

  IF p_action = 'accept' AND current_status = 'Записан' THEN
    new_status := 'В работе';
  ELSIF p_action = 'complete' AND current_status = 'В работе' THEN
    new_status := 'Выполнен';
  ELSE
    RAISE EXCEPTION 'Недопустимый переход статуса';
  END IF;

  UPDATE public.rabota_orders
     SET status = new_status,
         completed_at = CASE WHEN new_status = 'Выполнен' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_order_id;
  RETURN new_status;
END;
$function$;
