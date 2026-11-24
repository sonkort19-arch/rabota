-- Run with psql against a fresh disposable database.
\set ON_ERROR_STOP on
\ir paid-guard-fixture.sql
-- Complete the cash schema omitted by the unrelated payment-guard fixture.
alter table public.rabota_cash_collections add created_at timestamptz not null default now(),
  add confirmed_by uuid;
\ir ../../sql/20261123210808_cash_partial_transfers.sql

begin;
insert into public.rabota_cash_collections
  (order_id,master_user_id,company_amount,created_at,submitted_at,confirmed_at)
select id,case when suffix='5' then '00000000-0000-4000-8000-000000000004'::uuid
          else '00000000-0000-4000-8000-000000000003'::uuid end,
  100,'2026-10-01'::date + suffix::int,
  case when suffix in ('3','4') then '2026-11-19'::date end,
  case when suffix='4' then '2026-11-20'::date end
from (select id,right(id::text,1) as suffix from public.rabota_orders) fixtures;

-- Keep all assertions inside roles and use only synthetic ids.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$
declare
  first_id uuid := '10000000-0000-4000-8000-000000000001';
  second_id uuid := '10000000-0000-4000-8000-000000000002';
  request_key uuid := gen_random_uuid();
  rejected boolean;
begin
  -- FIFO can cover two orders and split a payment at a fractional-ruble boundary.
  perform public.rabota_cash_submit_amount(150.75,request_key);
  perform public.rabota_cash_submit_amount(150.75,request_key);
  assert (select count(*)=2 and sum(amount)=150.75 from public.rabota_cash_transfer_events);
  assert (select submitted_amount=100 and submitted_at is not null
    from public.rabota_cash_collections where order_id=first_id);
  assert (select submitted_amount=50.75 and submitted_at is null
    from public.rabota_cash_collections where order_id=second_id);

  rejected := false;
  begin perform public.rabota_cash_submit_amount(150.76,request_key);
  exception when raise_exception then rejected := true; end;
  assert rejected, 'a request key cannot change its amount';
  rejected := false;
  begin perform public.rabota_cash_submit_amount(150.75,request_key,second_id);
  exception when raise_exception then rejected := true; end;
  assert rejected, 'a request key cannot change its scope';
  rejected := false;
  begin perform public.rabota_cash_submit_amount(999999,gen_random_uuid());
  exception when raise_exception then rejected := true; end;
  assert rejected, 'over-limit aggregate';
  rejected := false;
  begin perform public.rabota_cash_submit_amount(0.001,gen_random_uuid(),second_id);
  exception when raise_exception then rejected := true; end;
  assert rejected, 'fractional kopek';
  rejected := false;
  begin perform public.rabota_cash_submit_amount(1,gen_random_uuid(),'10000000-0000-4000-8000-000000000005');
  exception when raise_exception then rejected := true; end;
  assert rejected, 'only assigned cash';
  rejected := false;
  begin perform public.rabota_cash_submit(second_id);
  exception when raise_exception then rejected := true; end;
  assert rejected, 'legacy cannot duplicate a partial transfer';
  rejected := false;
  begin perform public.rabota_cash_confirm_amount(second_id,50.75,0);
  exception when raise_exception then rejected := true; end;
  assert rejected, 'master cannot confirm a receipt';
  assert (select count(*)=2 and sum(amount)=150.75 from public.rabota_cash_transfer_events),
    'failed allocations roll back every row';
  perform public.rabota_cash_submit('10000000-0000-4000-8000-000000000006');
end;
$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
declare
  second_id uuid := '10000000-0000-4000-8000-000000000002';
  rejected boolean := false;
begin
  begin perform public.rabota_cash_confirm('10000000-0000-4000-8000-000000000001');
  exception when raise_exception then rejected := true; end;
  assert rejected, 'an old owner screen cannot confirm a managed order';
  rejected := false;
  begin perform public.rabota_cash_confirm_amount(second_id,10,0);
  exception when raise_exception then rejected := true; end;
  assert rejected, 'changed pending value requires fresh review';
  perform public.rabota_cash_confirm_amount(second_id,50.75,0);
  perform public.rabota_cash_confirm_amount(second_id,50.75,0);
  assert (select count(*)=1 and sum(amount)=50.75 from public.rabota_cash_transfer_events where kind='confirmed');
  assert (select confirmed_amount=50.75 and confirmed_at is null
    from public.rabota_cash_collections where order_id=second_id);
  -- Old and updated owner clients can both finish pre-migration transfers.
  perform public.rabota_cash_confirm('10000000-0000-4000-8000-000000000006');
  assert (select confirmed_at is not null and confirmed_amount is null
    from public.rabota_cash_collections where order_id='10000000-0000-4000-8000-000000000006');
  perform public.rabota_cash_confirm_amount('10000000-0000-4000-8000-000000000003',100,0);
end;
$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.rabota_cash_submit_amount(49.25,gen_random_uuid(),'10000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.rabota_cash_confirm_amount('10000000-0000-4000-8000-000000000002',100,50.75);
do $$
begin
  assert (select confirmed_amount=100 and submitted_amount=100 and confirmed_at is not null
    from public.rabota_cash_collections where order_id='10000000-0000-4000-8000-000000000002');
  assert (select count(*)=2 and sum(amount)=100 and count(distinct created_at)=2
    from public.rabota_cash_transfer_events where order_id='10000000-0000-4000-8000-000000000002' and kind='confirmed');
  assert (select confirmed_amount is null and confirmed_at='2026-11-20'::date
    from public.rabota_cash_collections where order_id='10000000-0000-4000-8000-000000000004');
end;
$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$
begin
  assert not exists(select 1 from public.rabota_cash_transfer_events);
  assert not has_table_privilege('authenticated','public.rabota_cash_transfer_events','insert');
  assert not has_function_privilege('anon','public.rabota_cash_submit_amount(numeric,uuid,uuid)','execute');
end;
$$;
rollback;
