-- Applied to Supabase project yedzfmibceboncrytbqz on 2026-11-08.
-- Grants only Raul's existing active master account the ability to INSERT
-- a new, unpaid, booked order assigned to himself.
-- Existing owner/manager policies and update privileges are unchanged.
create policy rabota_raul_create_own_bookings
on public.rabota_orders
for insert
to authenticated
with check (
  (select auth.uid()) = 'cf6176d9-13ef-4d99-be3e-fd5d197c7534'::uuid
  and (select private.rabota_my_role()) = 'master'
  and lower(btrim(master)) = 'рауль'
  and assigned_user_id = (select auth.uid())
  and created_by = (select auth.uid())
  and status = 'Записан'
  and paid = false
  and completed_at is null
  and legacy_id is null
  and btrim(name) <> ''
  and btrim(phone) <> ''
  and appointment_date is not null
  and appointment_time is not null
  and (price is null or price >= 0)
  and (radiators is null or radiators >= 0)
  and (floor_loops is null or floor_loops >= 0)
);
