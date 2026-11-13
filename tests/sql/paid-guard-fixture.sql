-- Isolated PostgreSQL 17 fixture. Synthetic user IDs / clients only.
-- Never execute this fixture on any Supabase project (it creates schema/roles).
\set ON_ERROR_STOP on
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public,auth,private TO authenticated,anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE public.rabota_members (
 user_id uuid PRIMARY KEY,
 role text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 master_name text NOT NULL DEFAULT ''
);
CREATE OR REPLACE FUNCTION private.rabota_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.role FROM public.rabota_members m
 WHERE m.user_id=(SELECT auth.uid()) AND m.active=true LIMIT 1
$$;
CREATE TABLE public.rabota_orders (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 name text NOT NULL,phone text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',
 radiator_type text NOT NULL DEFAULT '',radiators integer,floor_loops integer,
 master text NOT NULL DEFAULT '',appointment_date date,appointment_time time,
 price numeric,paid boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'Новый',details text NOT NULL DEFAULT '',
 legacy_id text, created_by uuid DEFAULT auth.uid(), completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 assigned_user_id uuid, payment_method text,payment_amount numeric,
 payment_received_by text,paid_at timestamptz,paid_by uuid,lead_id uuid
);
CREATE TABLE public.rabota_cash_collections (
 order_id uuid PRIMARY KEY REFERENCES public.rabota_orders(id),
 master_user_id uuid,gross numeric,raul_amount numeric,timur_amount numeric,
 company_amount numeric,submitted_at timestamptz,confirmed_at timestamptz
);
CREATE TABLE public.rabota_finance_operations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),kind text NOT NULL,
 amount numeric NOT NULL,master_user_id uuid,note text,created_by uuid,
 order_id uuid REFERENCES public.rabota_orders(id),voided_at timestamptz
);

-- Snapshot of existing cash guard, preserved by the proposed migration.
CREATE OR REPLACE FUNCTION private.rabota_cash_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.rabota_cash_collections c where c.order_id=old.id)
 and (
  new.price is distinct from old.price
  or new.paid is distinct from old.paid
  or new.status is distinct from old.status
  or new.assigned_user_id is distinct from old.assigned_user_id
  or new.master is distinct from old.master
 ) then
  raise exception 'Распределённый заказ: финансовые поля защищены от изменений. Обратитесь к администратору';
 end if;
 return new;
end
$function$;
CREATE TRIGGER rabota_cash_order_guard_trigger BEFORE UPDATE ON public.rabota_orders
 FOR EACH ROW EXECUTE FUNCTION private.rabota_cash_order_guard();

ALTER TABLE public.rabota_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rabota_orders TO authenticated;
GRANT SELECT ON public.rabota_orders TO anon;
GRANT SELECT ON public.rabota_finance_operations,public.rabota_cash_collections TO authenticated;
CREATE POLICY synthetic_orders_read ON public.rabota_orders FOR SELECT TO authenticated
 USING (private.rabota_my_role() IN ('owner','manager')
   OR (private.rabota_my_role()='master' AND assigned_user_id=auth.uid()));
CREATE POLICY synthetic_orders_insert ON public.rabota_orders FOR INSERT TO authenticated
 WITH CHECK (private.rabota_my_role() IN ('owner','manager'));
CREATE POLICY synthetic_orders_update ON public.rabota_orders FOR UPDATE TO authenticated
 USING (private.rabota_my_role() IN ('owner','manager'))
 WITH CHECK (private.rabota_my_role() IN ('owner','manager'));
CREATE POLICY synthetic_orders_delete ON public.rabota_orders FOR DELETE TO authenticated
 USING (private.rabota_my_role()='owner');
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;

-- Fixed fictitious UUIDs, no real user data.
INSERT INTO public.rabota_members(user_id,role,active,master_name) VALUES
 ('00000000-0000-4000-8000-000000000001','owner',true,''),
 ('00000000-0000-4000-8000-000000000002','manager',true,''),
 ('00000000-0000-4000-8000-000000000003','master',true,'Рауль'),
 ('00000000-0000-4000-8000-000000000004','master',true,'Другой');
-- Historic rows are inserted BEFORE installing guard (like a real migration).
INSERT INTO public.rabota_orders
 (id,name,phone,master,assigned_user_id,appointment_date,appointment_time,status,price,paid,
 payment_method,payment_amount,payment_received_by,paid_at,paid_by)
VALUES
 ('10000000-0000-4000-8000-000000000001','Новый клиент','100','Рауль','00000000-0000-4000-8000-000000000003','2026-11-20','10:00','Записан',10000,false,null,null,null,null,null),
 ('10000000-0000-4000-8000-000000000002','Наличный заказ','101','Рауль','00000000-0000-4000-8000-000000000003','2026-11-20','15:00','В работе',20000,false,null,null,null,null,null),
 ('10000000-0000-4000-8000-000000000003','Старая оплата','102','Рауль','00000000-0000-4000-8000-000000000003','2026-10-20','15:00','Выполнен',10000,true,null,null,null,null,null),
 ('10000000-0000-4000-8000-000000000004','Старая наличная с неполными реквизитами','103','Рауль','00000000-0000-4000-8000-000000000003','2026-10-21','15:00','В работе',14000,true,'cash',null,'master',null,null),
 ('10000000-0000-4000-8000-000000000005','Чужой заказ','104','Другой','00000000-0000-4000-8000-000000000004','2026-11-20','11:00','В работе',9000,false,null,null,null,null,null),
 ('10000000-0000-4000-8000-000000000006','Мастер ещё не принял','105','Рауль','00000000-0000-4000-8000-000000000003','2026-11-21','12:00','Записан',9000,false,null,null,null,null,null),
 ('10000000-0000-4000-8000-000000000007','Оплата менеджером','106','Рауль','00000000-0000-4000-8000-000000000003','2026-11-22','12:00','Записан',11000,false,null,null,null,null,null),
 ('10000000-0000-4000-8000-000000000008','Полная наличная запись','107','Рауль','00000000-0000-4000-8000-000000000003','2026-10-22','12:00','Выполнен',13000,true,'cash',13000,'master','2026-10-22 12:30+00','00000000-0000-4000-8000-000000000003');
