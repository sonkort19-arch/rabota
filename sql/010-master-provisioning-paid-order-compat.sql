-- CRM Работа: paid-safe master approval/provision, DRAFT staging-only.
-- Apply ONLY after sql/008-protect-paid-orders.sql on tested staging.
-- Audited against live RPC source MD5s on 2026-11-14.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'Expected PostgreSQL 17';
 END IF;
 IF (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.rabota_approve_master(uuid,text)'::pg_catalog.regprocedure) IS DISTINCT FROM 'b2dfc4a09157b434b327da4864e0337c'
 OR (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.rabota_provision_master(uuid,text,text)'::pg_catalog.regprocedure) IS DISTINCT FROM '5861f5b084d08f613e808dd385c64175' THEN
  RAISE EXCEPTION 'Master provisioning source drift since audit: STOP';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='public.rabota_orders'::pg_catalog.regclass
     AND t.tgname='rabota_paid_order_guard_trigger' AND t.tgenabled='O') THEN
  RAISE EXCEPTION 'Paid order guard from SQL 008 is required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid IN ('public.rabota_approve_master(uuid,text)'::pg_catalog.regprocedure,
     'public.rabota_provision_master(uuid,text,text)'::pg_catalog.regprocedure)
    AND (NOT p.prosecdef OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres')) THEN
  RAISE EXCEPTION 'Master RPC owner / SECURITY DEFINER drift';
 END IF;
END $preflight$;

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
  -- Never silently attach an unassigned historical paid order.
  if exists (select 1 from public.rabota_orders o
      where o.paid is true and o.assigned_user_id is null
        and lower(btrim(o.master))=lower(name_clean)) then
    raise exception 'Исторические оплаченные заказы требуют отдельной сверки'
      using errcode='23514';
  end if;
  update public.rabota_members
    set active=true, role='master', master_name=name_clean
    where user_id=p_user_id and role<>'owner';
  if not found then raise exception 'Заявка сотрудника не найдена'; end if;
  update public.rabota_orders
    set assigned_user_id=p_user_id, updated_at=now()
    where assigned_user_id is null and paid is not true
      and lower(btrim(master))=lower(name_clean)
      and not exists (select 1 from public.rabota_cash_collections c
        where c.order_id=public.rabota_orders.id);
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
  -- Reject account replacement instead of orphaning paid salary history.
  if exists (select 1 from public.rabota_orders o
      where lower(btrim(o.master))=lower(v_name)
        and o.assigned_user_id is distinct from p_user_id
        and (o.paid is true or exists(
          select 1 from public.rabota_cash_collections c where c.order_id=o.id))) then
    raise exception 'Оплаченная история требует ручной проверки перед заменой мастера'
      using errcode='23514';
  end if;
  update public.rabota_members
  set active=false
  where active=true and role='master' and lower(btrim(master_name))=lower(v_name);
  insert into public.rabota_members (user_id,role,active,master_name,email)
  values (p_user_id,'master',true,v_name,v_login || '@staff.rabota.invalid');
  update public.rabota_orders
  set assigned_user_id=p_user_id,updated_at=now()
  where lower(btrim(master))=lower(v_name)
    and paid is not true and assigned_user_id is distinct from p_user_id
    and not exists(select 1 from public.rabota_cash_collections c
      where c.order_id=public.rabota_orders.id);
  return true;
end
$function$;
COMMIT;
