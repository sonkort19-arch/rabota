-- Run after the accounting and financial write retry migrations on fake data.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.rabota_record_expense_v1(numeric,text,uuid)', 'execute');
  ASSERT NOT has_function_privilege('anon', 'public.rabota_cashbook_record_v1(text,numeric,text,text,text,uuid)', 'execute');
  BEGIN
    INSERT INTO public.rabota_finance_operations(kind,amount,note,created_by)
    VALUES('expense',17,'Fixture missing request from table writer','00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Trigger did not stop a new keyless expense';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$guard$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
DECLARE
  v_expense_request uuid:='20000000-0000-4000-8000-000000000101';
  v_cashbook_request uuid:='20000000-0000-4000-8000-000000000102';
  v_expense uuid;
  v_cashbook uuid;
  v_history uuid;
BEGIN
  SELECT id INTO STRICT v_history FROM public.rabota_finance_operations
  WHERE kind='expense' AND note='Fixture separate expense' AND amount=120 AND request_id IS NULL AND voided_at IS NULL;
  ASSERT public.rabota_finance_void(v_history);
  ASSERT EXISTS (SELECT 1 FROM public.rabota_finance_operations
    WHERE id=v_history AND voided_at IS NOT NULL AND request_id IS NULL AND note='Fixture separate expense');

  BEGIN
    PERFORM public.rabota_finance_record('expense',12.31,NULL,'Fixture new legacy expense');
    RAISE EXCEPTION 'Legacy RPC created a new keyless expense';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_record_expense_v1(12.31,'Fixture explicit null key',NULL);
    RAISE EXCEPTION 'New RPC created an expense with a null key';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  v_expense:=public.rabota_record_expense_v1(31.25,'Fixture parts',v_expense_request);
  ASSERT v_expense=public.rabota_record_expense_v1(31.25,' Fixture parts ',v_expense_request);
  ASSERT (SELECT count(*)=1 AND sum(amount)=31.25 FROM public.rabota_finance_operations WHERE request_id=v_expense_request);
  ASSERT v_expense IS DISTINCT FROM public.rabota_record_expense_v1(31.25,'Fixture parts',gen_random_uuid());
  ASSERT (SELECT count(*)=2 AND sum(amount)=62.50 FROM public.rabota_finance_operations WHERE kind='expense' AND note='Fixture parts');
  BEGIN
    PERFORM public.rabota_record_expense_v1(31.26,'Fixture parts',v_expense_request);
    RAISE EXCEPTION 'Accepted an expense retry with a different amount';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_record_expense_v1(31.25,'Fixture different expense note',v_expense_request);
    RAISE EXCEPTION 'Accepted an expense retry with a different note';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    -- This key belongs to a previously committed payroll payout in the fixture.
    PERFORM public.rabota_record_expense_v1(4000,'Fixture first payout','20000000-0000-4000-8000-000000000046');
    RAISE EXCEPTION 'Accepted an expense request with a payroll payout key';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  ASSERT public.rabota_finance_void(v_expense);
  ASSERT v_expense=public.rabota_record_expense_v1(31.25,'Fixture parts',v_expense_request);
  ASSERT EXISTS (SELECT 1 FROM public.rabota_finance_operations WHERE id=v_expense AND voided_at IS NOT NULL);

  v_cashbook:=public.rabota_cashbook_record_v1('expense',14.75,'cash',NULL,'Fixture refund supplies',v_cashbook_request);
  ASSERT v_cashbook=public.rabota_cashbook_record_v1('expense',14.75,'cash',NULL,' Fixture refund supplies ',v_cashbook_request);
  ASSERT v_cashbook IS DISTINCT FROM public.rabota_cashbook_record_v1('expense',14.75,'cash',NULL,'Fixture refund supplies',gen_random_uuid());
  BEGIN
    PERFORM public.rabota_cashbook_record_v1('expense',14.75,'cash',NULL,'Fixture altered cashbook note',v_cashbook_request);
    RAISE EXCEPTION 'Accepted a cashbook retry with a different note';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_cashbook_record_v1('expense',14.75,'card',NULL,'Fixture refund supplies',v_cashbook_request);
    RAISE EXCEPTION 'Accepted a cashbook retry with a different account';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_cashbook_record_v1('income',14.75,NULL,'cash','Fixture refund supplies',v_cashbook_request);
    RAISE EXCEPTION 'Accepted a cashbook retry with a different kind';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$owner$;

DO $nonowners$
DECLARE
  v_actor text;
BEGIN
  FOREACH v_actor IN ARRAY ARRAY['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',''] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_actor,true);
    BEGIN
      PERFORM public.rabota_record_expense_v1(32.15,'Fixture unauthorized expense',gen_random_uuid());
      RAISE EXCEPTION 'Nonowner can write an expense';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.rabota_cashbook_record_v1('income',32.15,NULL,'card','Fixture unauthorized cashbook',gen_random_uuid());
      RAISE EXCEPTION 'Nonowner can write a cashbook operation';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$nonowners$;

RESET ROLE;
DO $audit$
BEGIN
  ASSERT (SELECT count(*)=1 AND sum(amount)=14.75 FROM public.rabota_cashbook_entries
    WHERE request_id='20000000-0000-4000-8000-000000000102');
  ASSERT (SELECT count(*)=2 AND sum(amount)=29.50 FROM public.rabota_cashbook_entries
    WHERE kind='expense' AND note='Fixture refund supplies');
  ASSERT NOT EXISTS (SELECT 1 FROM public.rabota_finance_operations WHERE note LIKE 'Fixture unauthorized%');
  ASSERT NOT EXISTS (SELECT 1 FROM public.rabota_cashbook_entries WHERE note LIKE 'Fixture unauthorized%');
END;
$audit$;
ROLLBACK;
SELECT 'PASS: exact expense and cashbook retries, changed requests, historical expense void, permissions and distinct operations';
