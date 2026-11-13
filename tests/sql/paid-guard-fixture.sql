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

-- Exact audit-time definitions are loaded first, so PostgreSQL preflight can
-- detect accidental RPC drift before replacing the two functions.
CREATE OR REPLACE FUNCTION public.rabota_record_order_payment(p_order_id uuid, p_amount numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.rabota_orders%rowtype;
  v_role text;
  v_receiver text;
begin
  v_role := (select private.rabota_my_role());
  if auth.uid() is null or coalesce(v_role,'') not in ('owner','manager','master') then
    raise exception 'Нет прав для оплаты заказа';
  end if;
  if p_method is null or p_method not in ('cash','card') then
    raise exception 'Выберите наличные или карту';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000000 or round(p_amount,2)<>p_amount then
    raise exception 'Укажите корректную сумму оплаты';
  end if;
  select * into v_order from public.rabota_orders where id=p_order_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_role='master' then
    if v_order.assigned_user_id is distinct from auth.uid() then
      raise exception 'Заказ назначен другому мастеру';
    end if;
    if v_order.status not in ('В работе','Выполнен') then
      raise exception 'Мастер может завершить только принятый в работу заказ';
    end if;
  end if;
  if v_order.status='Отменён' then raise exception 'Отменённый заказ нельзя оплатить'; end if;
  if v_order.paid then raise exception 'Заказ уже оплачен'; end if;
  if exists(select 1 from public.rabota_cash_collections where order_id=p_order_id) then
    raise exception 'По этому заказу уже создано финансовое распределение';
  end if;
  v_receiver := case when v_role='master' then 'master' else 'company' end;
  update public.rabota_orders
    set status='Выполнен', paid=true,
        price=p_amount, payment_method=p_method, payment_amount=p_amount,
        payment_received_by=v_receiver, paid_at=now(), paid_by=auth.uid(),
        completed_at=coalesce(v_order.completed_at,now()), updated_at=now()
    where id=p_order_id;
  return jsonb_build_object('ok',true,'amount',p_amount,'method',p_method,'receiver',v_receiver);
end $function$;

CREATE OR REPLACE FUNCTION public.rabota_cash_distribute(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_order public.rabota_orders%rowtype;
 v_raul numeric(12,2);
 v_company numeric(12,2);
 v_timur constant numeric(12,2):=1500;
begin
 if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'master' then
  raise exception 'Доступ разрешён только мастеру';
 end if;
 if not exists (
  select 1 from public.rabota_members
  where user_id=auth.uid() and role='master' and active=true
    and lower(btrim(master_name))='рауль'
 ) then
  raise exception 'Доступ к распределению не предоставлен';
 end if;
 select * into v_order from public.rabota_orders where id=p_order_id for update;
 if not found or v_order.assigned_user_id is distinct from auth.uid() then
  raise exception 'Заказ не назначен этому мастеру';
 end if;
 if v_order.status not in ('В работе','Выполнен') then
  raise exception 'Сначала примите заказ в работу';
 end if;
 if v_order.price is null or v_order.price<=3000 then
  raise exception 'Недостаточная сумма заказа для распределения. Обратитесь к администратору';
 end if;
 if v_order.paid and (v_order.payment_method is distinct from 'cash' or v_order.payment_received_by is distinct from 'master') then
  raise exception 'Распределение наличных недоступно для этого способа оплаты';
 end if;
 if exists(select 1 from public.rabota_cash_collections c where c.order_id=p_order_id) then
  raise exception 'Распределение уже записано';
 end if;
 v_raul:=round(v_order.price*0.5,2);
 v_company:=v_order.price-v_raul-v_timur;
 update public.rabota_orders
 set status='Выполнен',paid=true, completed_at=coalesce(v_order.completed_at,now()),
   payment_method=coalesce(v_order.payment_method,'cash'),
   payment_amount=coalesce(v_order.payment_amount,v_order.price),
   payment_received_by=coalesce(v_order.payment_received_by,'master'),
   paid_at=coalesce(v_order.paid_at,now()),paid_by=coalesce(v_order.paid_by,auth.uid()),
   updated_at=now()
 where id=p_order_id;
 insert into public.rabota_cash_collections(
  order_id,master_user_id,gross,raul_amount,timur_amount,company_amount
 ) values (p_order_id,auth.uid(),v_order.price,v_raul,v_timur,v_company);
 insert into public.rabota_finance_operations(kind,amount,master_user_id,note,created_by,order_id)
 values
  ('raul_payout',v_raul,auth.uid(),'Рауль забрал долю за заказ '||coalesce(v_order.name,'клиента'),auth.uid(),p_order_id),
  ('timur_payout',v_timur,auth.uid(),'Тимуру выдано за заказ '||coalesce(v_order.name,'клиента'),auth.uid(),p_order_id);
 return jsonb_build_object('ok',true,'raul',v_raul,'timur',v_timur,'company',v_company,'completed',true);
end $function$;

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
