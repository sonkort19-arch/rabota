-- Transactional behavioral checks on a disposable PostgreSQL 17 instance ONLY.
-- Designed to fail with nonzero exit code on any bypass/regression.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

-- Owner: normal unpaid edit and insertion still work.
UPDATE public.rabota_orders SET price=10500
 WHERE id='10000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF (SELECT price FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000001')<>10500 THEN
    RAISE EXCEPTION 'FAIL: normal unpaid edit';
  END IF;
  INSERT INTO public.rabota_orders(name,phone,status,paid) VALUES('Обычная запись','100','Новый',false);
  BEGIN
    INSERT INTO public.rabota_orders(name,phone,paid,status)
    VALUES('Попытка оплатить INSERT','100',true,'Выполнен');
    RAISE EXCEPTION 'FAIL: direct paid INSERT accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.rabota_orders(name,phone,paid,payment_amount)
    VALUES('Попытка реквизитов INSERT','100',false,1000);
    RAISE EXCEPTION 'FAIL: direct financial metadata INSERT accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.rabota_orders SET paid=true,status='Выполнен'
      WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: direct paid UPDATE accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.rabota_orders SET payment_amount=10500
      WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: direct payment metadata UPDATE accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT paid FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: denied update changed paid flag';
  END IF;
END $$;

-- Owner: authorized payment RPC updates price and full payment metadata atomically.
SELECT public.rabota_record_order_payment(
 '10000000-0000-4000-8000-000000000001',13000,'card');
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000001'
      AND paid=true AND price=13000 AND payment_amount=13000
      AND status='Выполнен' AND payment_method='card'
      AND payment_received_by='company' AND completed_at IS NOT NULL
      AND paid_by='00000000-0000-4000-8000-000000000001'
  ) THEN RAISE EXCEPTION 'FAIL: legitimate payment RPC'; END IF;
  BEGIN
    PERFORM public.rabota_record_order_payment(
      '10000000-0000-4000-8000-000000000001',13000,'card');
    RAISE EXCEPTION 'FAIL: duplicate payment permitted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.rabota_orders SET price=14000
      WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: paid price edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.rabota_orders SET paid=false
      WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: payment flag cleared';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.rabota_orders SET status='Отменён'
      WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: paid status edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.rabota_orders
      WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: paid order deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A technical timestamp refresh is intentionally permitted.
  UPDATE public.rabota_orders SET updated_at=now()
    WHERE id='10000000-0000-4000-8000-000000000001';
END $$;

-- The current, pre-existing legacy paid row must remain readable and immutable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000003'
      AND paid=true AND payment_method IS NULL AND payment_amount IS NULL)
  THEN RAISE EXCEPTION 'FAIL: legacy receipt changed'; END IF;
  BEGIN
    UPDATE public.rabota_orders SET details='edited'
      WHERE id='10000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'FAIL: legacy paid details edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.rabota_orders SET updated_at=now()
    WHERE id='10000000-0000-4000-8000-000000000003';
END $$;

-- Manager: direct flag is blocked, but payment RPC remains authorized.
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
  BEGIN
    UPDATE public.rabota_orders SET paid=true
      WHERE id='10000000-0000-4000-8000-000000000007';
    RAISE EXCEPTION 'FAIL: manager direct paid=true accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.rabota_orders(name,phone,paid)
    VALUES('Менеджер попытка paid','100',true);
    RAISE EXCEPTION 'FAIL: manager direct paid INSERT accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT public.rabota_record_order_payment(
 '10000000-0000-4000-8000-000000000007',11000,'cash');
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.rabota_orders
   WHERE id='10000000-0000-4000-8000-000000000007'
   AND paid=true AND payment_received_by='company') THEN
   RAISE EXCEPTION 'FAIL: manager RPC blocked';
 END IF;
END $$;

-- Raul: role and ownership gates remain in the actual SECURITY DEFINER RPCs.
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.rabota_record_order_payment(
      '10000000-0000-4000-8000-000000000005',9000,'card');
    RAISE EXCEPTION 'FAIL: master paid another master order';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.rabota_record_order_payment(
      '10000000-0000-4000-8000-000000000006',9000,'card');
    RAISE EXCEPTION 'FAIL: master paid unaccepted booking';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END $$;

-- Unpaid in-progress cash distribution must still set paid+completed and produce two ledger rows.
SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000002');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000002'
      AND status='Выполнен' AND paid=true AND payment_method='cash'
      AND payment_received_by='master' AND payment_amount=20000)
  THEN RAISE EXCEPTION 'FAIL: cash distribution order update'; END IF;
  IF (SELECT count(*) FROM public.rabota_cash_collections
      WHERE order_id='10000000-0000-4000-8000-000000000002')<>1
    OR (SELECT count(*) FROM public.rabota_finance_operations
      WHERE order_id='10000000-0000-4000-8000-000000000002')<>2
  THEN RAISE EXCEPTION 'FAIL: cash collection or ledger wrong'; END IF;
  BEGIN
    PERFORM public.rabota_cash_distribute('10000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'FAIL: double cash distribution accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END $$;

-- Previously paid cash/master row with partial metadata: allow only the existing
-- RPC to finish its receipt, not a direct UPDATE or a second distribution.
SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000004');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000004'
      AND paid=true AND status='Выполнен' AND payment_amount=14000
      AND paid_at IS NOT NULL AND paid_by='00000000-0000-4000-8000-000000000003')
  THEN RAISE EXCEPTION 'FAIL: legacy partial master cash completion'; END IF;
  IF (SELECT count(*) FROM public.rabota_cash_collections
    WHERE order_id='10000000-0000-4000-8000-000000000004')<>1
  THEN RAISE EXCEPTION 'FAIL: missing legacy cash collection'; END IF;
END $$;

-- The original RPC never accepted all-null payment metadata for paid legacy rows.
-- Do not silently invent a fresh receipt or replay an unverified historic payout.
DO $$
BEGIN
  BEGIN
    PERFORM public.rabota_cash_distribute('10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL: fabricated legacy cash distribution accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.rabota_cash_collections
    WHERE order_id='10000000-0000-4000-8000-000000000003')
  THEN RAISE EXCEPTION 'FAIL: historical receipt mutated'; END IF;
END $$;

-- Existing paid cash+master with complete metadata can be distributed without
-- editing its original price, receipt or customer details.
SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000008');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rabota_cash_collections
    WHERE order_id='10000000-0000-4000-8000-000000000008')
  THEN RAISE EXCEPTION 'FAIL: existing fully paid receipt distribution'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000008'
      AND price=13000 AND payment_method='cash' AND payment_amount=13000)
  THEN RAISE EXCEPTION 'FAIL: existing receipt modified'; END IF;
END $$;
ROLLBACK;

-- Confirm privileged paths also reject unauthenticated calls.
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.rabota_record_order_payment(
      '10000000-0000-4000-8000-000000000001',10000,'card');
    RAISE EXCEPTION 'FAIL: anon payment accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
SELECT 'PASS: 16 core payment/legacy/role behaviors verified on isolated PostgreSQL' AS outcome;
