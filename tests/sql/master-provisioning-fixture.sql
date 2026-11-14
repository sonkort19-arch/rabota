-- Fake PostgreSQL CI baseline; NEVER apply to Supabase production.
ALTER TABLE public.rabota_members ADD COLUMN email text;
-- Synthetic owner-only member inspection; authenticated test role must not
-- receive unrestricted access to membership information.
ALTER TABLE public.rabota_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.rabota_members TO authenticated;
CREATE POLICY synthetic_owner_members_select ON public.rabota_members
  FOR SELECT TO authenticated
  USING ((SELECT private.rabota_my_role())='owner');
CREATE TABLE auth.users (id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('00000000-0000-4000-8000-000000000006','fresh_master@staff.rabota.invalid',now()),
('00000000-0000-4000-8000-000000000008','raul_new@staff.rabota.invalid',now());
INSERT INTO public.rabota_members(user_id,role,active,master_name,email) VALUES
('00000000-0000-4000-8000-000000000005','pending',false,'','pending@staff.rabota.invalid'),
('00000000-0000-4000-8000-000000000007','pending',false,'','pending2@staff.rabota.invalid');
INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,status,price,paid) VALUES
('10000000-0000-4000-8000-000000000011','Synthetic paid legacy','000','Исторический',NULL,'Выполнен',10000,true),
('10000000-0000-4000-8000-000000000012','Synthetic fresh unpaid','000','Свежий',NULL,'Записан',10000,false),
('10000000-0000-4000-8000-000000000013','Synthetic new hire unpaid','000','НовыйМастер',NULL,'Записан',10000,false);
CREATE OR REPLACE FUNCTION public.rabota_approve_master(p_user_id uuid, p_master_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare name_clean text := btrim(coalesce(p_master_name,''));
begin
  if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then raise exception 'Доступ запрещён'; end if;
  if p_user_id is null or p_user_id=auth.uid() then raise exception 'Некорректный сотрудник'; end if;
  if length(name_clean) not between 1 and 100 then raise exception 'Укажите имя мастера'; end if;
  update public.rabota_members
    set active=true, role='master', master_name=name_clean
    where user_id=p_user_id and role<>'owner';
  if not found then raise exception 'Заявка сотрудника не найдена'; end if;
  update public.rabota_orders
    set assigned_user_id=p_user_id, updated_at=now()
    where assigned_user_id is null and lower(btrim(master))=lower(name_clean);
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.rabota_provision_master(p_user_id uuid, p_master_name text, p_login text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text := btrim(coalesce(p_master_name,''));
declare v_login text := lower(btrim(coalesce(p_login,'')));
begin
  if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
    raise exception 'Только владелец может создать мастера';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Некорректная учётная запись';
  end if;
  if length(v_name) not between 1 and 100 then
    raise exception 'Некорректное имя мастера';
  end if;
  if v_login !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception 'Некорректный логин';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id=p_user_id
      and lower(u.email)=v_login || '@staff.rabota.invalid'
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Учётная запись мастера не подтверждена системой';
  end if;
  update public.rabota_members
  set active=false
  where active=true and role='master' and lower(btrim(master_name))=lower(v_name);
  insert into public.rabota_members (user_id,role,active,master_name,email)
  values (p_user_id,'master',true,v_name,v_login || '@staff.rabota.invalid');
  update public.rabota_orders
  set assigned_user_id=p_user_id,updated_at=now()
  where lower(btrim(master))=lower(v_name);
  return true;
end
$function$;
