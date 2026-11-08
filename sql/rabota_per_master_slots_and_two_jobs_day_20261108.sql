-- Applied in Supabase project yedzfmibceboncrytbqz on 2026-11-08.
-- Booking conflicts are specific to the master; maximum two jobs per master/day.
-- This changes database constraints only, not existing order rows.
create unique index if not exists rabota_orders_active_master_slot_unique
on public.rabota_orders (appointment_date, appointment_time, lower(btrim(coalesce(master,''))))
where appointment_date is not null and appointment_time is not null and status <> 'Отменён';

create or replace function private.rabota_enforce_master_day_capacity()
returns trigger language plpgsql set search_path='' as $$
declare
 candidate_master text;
 assigned_count integer;
begin
 if new.status='Отменён' or new.appointment_date is null or new.appointment_time is null then
   return new;
 end if;
 candidate_master:=lower(btrim(coalesce(new.master,'')));
 if tg_op='UPDATE' then
   if old.status<>'Отменён'
     and old.appointment_date is not distinct from new.appointment_date
     and old.appointment_time is not distinct from new.appointment_time
     and lower(btrim(coalesce(old.master,'')))=candidate_master
   then return new; end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(
     'rabota:orders:master:'||candidate_master||':'||new.appointment_date::text,0
   )
 );
 select count(*) into assigned_count from public.rabota_orders r
 where r.appointment_date=new.appointment_date
   and r.status<>'Отменён'
   and lower(btrim(coalesce(r.master,'')))=candidate_master
   and r.id is distinct from new.id;
 if assigned_count>=2 then
   raise exception 'У мастера на эту дату уже два заказа. Выберите другой день.'
     using errcode='23514',constraint='rabota_master_daily_capacity';
 end if;
 return new;
end;
$$;
drop trigger if exists rabota_master_daily_capacity_trigger on public.rabota_orders;
create trigger rabota_master_daily_capacity_trigger
before insert or update of appointment_date,appointment_time,master,status
on public.rabota_orders for each row execute function private.rabota_enforce_master_day_capacity();
drop index if exists public.rabota_orders_active_slot_unique;
