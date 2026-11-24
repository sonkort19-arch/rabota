-- Run through tests/module-permissions-local.sh on a fresh local cluster.
DO $fixture$
BEGIN
  IF current_user <> 'rabota_module_test'
    OR inet_server_addr() IS NOT NULL
    OR to_regclass('public.rabota_members') IS NOT NULL THEN
    RAISE EXCEPTION 'This fixture requires a fresh disposable local cluster';
  END IF;
END $fixture$;

\ir roles-stage3-fixture.sql
\ir master-provisioning-fixture.sql
ALTER TABLE public.rabota_finance_operations
  ADD COLUMN voided_by uuid,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
\ir ../../sql/rabota_harden_null_role_guards_20261026.sql
\ir ../../sql/012_growth_plan_owner_only.sql

INSERT INTO auth.users (id)
VALUES ('00000000-0000-4000-8000-000000000001'),
       ('00000000-0000-4000-8000-000000000009'),
       ('00000000-0000-4000-8000-000000000010');
INSERT INTO public.rabota_members (user_id, role, active)
VALUES ('00000000-0000-4000-8000-000000000009', 'owner', true),
       ('00000000-0000-4000-8000-000000000010', 'owner', false);
INSERT INTO public.rabota_growth_plan (owner_id, kind, title, start_on, end_on)
VALUES ('00000000-0000-4000-8000-000000000001', 'day', 'Test owner task', '2027-01-01', '2027-01-01'),
       ('00000000-0000-4000-8000-000000000009', 'day', 'Another owner task', '2027-01-01', '2027-01-01'),
       ('00000000-0000-4000-8000-000000000010', 'day', 'Inactive owner task', '2027-01-01', '2027-01-01');
INSERT INTO public.rabota_finance_operations (id, kind, amount, note, created_by)
VALUES ('20000000-0000-4000-8000-000000000001', 'expense', 19.50, 'Test existing expense',
        '00000000-0000-4000-8000-000000000001');

BEGIN;
SET LOCAL ROLE authenticated;
DO $owner$
DECLARE
  operation_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  operation_id := public.rabota_finance_record('expense', 14.50, NULL, '[Прочее] Test expense');
  IF NOT EXISTS (
    SELECT 1 FROM public.rabota_finance_operations
    WHERE id = operation_id AND kind = 'expense' AND amount = 14.50
      AND created_by = auth.uid() AND master_user_id IS NULL AND voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Owner expense was not created or is unreadable';
  END IF;
  IF NOT public.rabota_finance_void(operation_id) THEN
    RAISE EXCEPTION 'Owner could not void expense';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rabota_finance_operations
    WHERE id = operation_id AND voided_by = auth.uid() AND voided_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Owner expense was not voided';
  END IF;

  IF (SELECT count(*) FROM public.rabota_growth_plan) <> 1 THEN
    RAISE EXCEPTION 'The owner must see exactly their own task';
  END IF;
  UPDATE public.rabota_growth_plan SET completed = true, completed_at = now(), updated_at = now()
  WHERE title = 'Test owner task';
  IF NOT FOUND THEN RAISE EXCEPTION 'Owner cannot complete own task'; END IF;
  UPDATE public.rabota_growth_plan SET completed = true WHERE title = 'Another owner task';
  IF FOUND THEN RAISE EXCEPTION 'Owner modified another owner task'; END IF;
  BEGIN
    UPDATE public.rabota_growth_plan SET title = 'Overwritten task';
    RAISE EXCEPTION 'Owner changed a restricted task field';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $owner$;

DO $restricted$
DECLARE
  actor text;
BEGIN
  FOREACH actor IN ARRAY ARRAY[
    '00000000-0000-4000-8000-000000000002', -- manager
    '00000000-0000-4000-8000-000000000003', -- master
    '00000000-0000-4000-8000-000000000010', -- inactive owner
    '' -- authenticated role without a user identity
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor, true);
    IF EXISTS (SELECT 1 FROM public.rabota_finance_operations WHERE kind = 'expense') THEN
      RAISE EXCEPTION 'Restricted actor % read expenses', actor;
    END IF;
    IF EXISTS (SELECT 1 FROM public.rabota_growth_plan) THEN
      RAISE EXCEPTION 'Restricted actor % read growth tasks', actor;
    END IF;
    UPDATE public.rabota_growth_plan SET completed = false;
    IF FOUND THEN RAISE EXCEPTION 'Restricted actor % updated a growth task', actor; END IF;
    BEGIN
      PERFORM public.rabota_finance_record('expense', 10, NULL, 'Forbidden test expense');
      RAISE EXCEPTION 'Restricted actor % created an expense', actor;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Только администратор может проводить финансовые операции' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.rabota_finance_void('20000000-0000-4000-8000-000000000001');
      RAISE EXCEPTION 'Restricted actor % can void expenses', actor;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Только администратор может отменить операцию' THEN RAISE; END IF;
    END;
  END LOOP;
END $restricted$;

SET LOCAL ROLE anon;
DO $anonymous$
BEGIN
  BEGIN
    PERFORM 1 FROM public.rabota_growth_plan;
    RAISE EXCEPTION 'Anonymous user can query growth tasks';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.rabota_finance_operations WHERE kind = 'expense';
    RAISE EXCEPTION 'Anonymous user can query expenses';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $anonymous$;
ROLLBACK;

SELECT 'PASS: expense RPCs and growth RLS on disposable PostgreSQL' AS outcome;
