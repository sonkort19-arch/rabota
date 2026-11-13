-- CRM «Работа» / Safe release step 2: reproducible financial reconciliation.
-- READ ONLY. No names, phone numbers, addresses, notes, or full UUIDs returned.
-- No INSERT / UPDATE / DELETE / DDL. Never infer money actually changed hands
-- from the absence of a CRM row. Reconcile against receipts outside this query.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- 1. Summary: mutually overlapping flags, not additive categories.
WITH order_stats AS (
 SELECT count(*)::int all_orders,
   count(*) FILTER (WHERE o.paid)::int paid_orders,
   count(*) FILTER (WHERE o.paid AND o.status='Выполнен')::int completed_paid,
   count(*) FILTER (WHERE o.paid AND o.payment_method IS NULL AND o.payment_amount IS NULL
     AND o.payment_received_by IS NULL AND o.paid_at IS NULL AND o.paid_by IS NULL)::int legacy_paid,
   coalesce(sum(o.price) FILTER (WHERE o.paid AND o.payment_method IS NULL AND o.payment_amount IS NULL
     AND o.payment_received_by IS NULL AND o.paid_at IS NULL AND o.paid_by IS NULL),0)::numeric(14,2) legacy_gross
 FROM public.rabota_orders o
), ledger_per_order AS (
 SELECT f.order_id,
   count(*) FILTER (WHERE f.kind='raul_payout' AND f.voided_at IS NULL)::int raul_entries,
   count(*) FILTER (WHERE f.kind='timur_payout' AND f.voided_at IS NULL)::int timur_entries
 FROM public.rabota_finance_operations f WHERE f.order_id IS NOT NULL
 GROUP BY f.order_id
), cash_stats AS (
 SELECT count(*)::int collections,
   count(*) FILTER(WHERE c.confirmed_at IS NOT NULL)::int confirmed_collections,
   count(*) FILTER(WHERE c.submitted_at IS NOT NULL AND c.confirmed_at IS NULL)::int pending_collections,
   coalesce(sum(c.company_amount) FILTER(WHERE c.submitted_at IS NOT NULL AND c.confirmed_at IS NULL),0)::numeric(14,2) pending_company_cash,
   count(*) FILTER(WHERE coalesce(l.raul_entries,0)=0 OR coalesce(l.timur_entries,0)=0)::int collections_missing_auto_ledger,
   coalesce(sum(c.gross) FILTER(WHERE coalesce(l.raul_entries,0)=0 OR coalesce(l.timur_entries,0)=0),0)::numeric(14,2) missing_auto_ledger_gross
 FROM public.rabota_cash_collections c
 LEFT JOIN ledger_per_order l ON l.order_id=c.order_id
), master_stats AS (
 SELECT count(*) FILTER (WHERE c.order_id IS NULL)::int paid_master_no_distribution,
   coalesce(sum(o.price) FILTER (WHERE c.order_id IS NULL),0)::numeric(14,2) paid_master_undistributed_gross
 FROM public.rabota_orders o
 LEFT JOIN public.rabota_cash_collections c ON c.order_id=o.id
 WHERE o.paid AND o.payment_received_by='master'
), manual_stats AS (
 SELECT count(*)::int manual_payouts,
   coalesce(sum(f.amount),0)::numeric(14,2) manual_amount
 FROM public.rabota_finance_operations f
 WHERE f.order_id IS NULL AND f.voided_at IS NULL
   AND f.kind IN ('raul_payout','timur_payout')
)
SELECT o.all_orders,o.paid_orders,o.completed_paid,o.legacy_paid,o.legacy_gross,
 c.collections,c.confirmed_collections,c.pending_collections,c.pending_company_cash,
 c.collections_missing_auto_ledger,c.missing_auto_ledger_gross,
 m.paid_master_no_distribution,m.paid_master_undistributed_gross,
 p.manual_payouts,p.manual_amount,
 (SELECT count(*)::int FROM public.rabota_cashbook_entries) AS cashbook_entries
FROM order_stats o CROSS JOIN cash_stats c CROSS JOIN master_stats m
CROSS JOIN manual_stats p;

-- 2. Exception queue: only last 8 UUID characters are exposed.
WITH ledger AS (
 SELECT order_id,
   count(*) FILTER (WHERE kind='raul_payout' AND voided_at IS NULL)::int raul_rows,
   count(*) FILTER (WHERE kind='timur_payout' AND voided_at IS NULL)::int timur_rows
 FROM public.rabota_finance_operations
 WHERE order_id IS NOT NULL GROUP BY order_id
), flagged AS (
 SELECT right(o.id::text,8) AS order_code,
   o.appointment_date AS visit_date,
   o.price::numeric(14,2) AS order_gross,
   o.status,
   coalesce(c.gross,0)::numeric(14,2) AS collection_gross,
   coalesce(c.company_amount,0)::numeric(14,2) AS company_share,
   CASE WHEN c.order_id IS NULL THEN 'no_collection'
     WHEN c.confirmed_at IS NOT NULL THEN 'confirmed'
     WHEN c.submitted_at IS NOT NULL THEN 'awaiting_owner'
     ELSE 'held_by_master' END AS collection_state,
   (o.paid AND o.payment_method IS NULL AND o.payment_amount IS NULL
     AND o.payment_received_by IS NULL AND o.paid_at IS NULL AND o.paid_by IS NULL) AS legacy_paid,
   (o.paid AND o.payment_received_by='master' AND c.order_id IS NULL) AS master_no_collection,
   (c.order_id IS NOT NULL AND
      (coalesce(l.raul_rows,0)=0 OR coalesce(l.timur_rows,0)=0)) AS collection_no_automatic_ledger,
   (c.order_id IS NOT NULL AND c.submitted_at IS NOT NULL AND c.confirmed_at IS NULL) AS awaiting_owner
 FROM public.rabota_orders o
 LEFT JOIN public.rabota_cash_collections c ON c.order_id=o.id
 LEFT JOIN ledger l ON l.order_id=o.id
)
SELECT order_code,visit_date,order_gross,status,collection_gross,company_share,
 collection_state,legacy_paid,master_no_collection,collection_no_automatic_ledger,awaiting_owner
FROM flagged
WHERE legacy_paid OR master_no_collection OR collection_no_automatic_ledger OR awaiting_owner
ORDER BY visit_date,order_code;

-- 3. Salary figures are ACCOUNTING CALCULATIONS, not proof of real payments.
WITH active_masters AS (
 SELECT user_id FROM public.rabota_members
 WHERE role='master' AND active AND lower(btrim(master_name))='рауль'
), accruals AS (
 SELECT count(*)::int eligible,
  coalesce(sum(round(o.price*0.5,2)),0)::numeric(14,2) raul_accrued,
  (count(*)*1500)::numeric(14,2) timur_accrued
 FROM public.rabota_orders o
 JOIN active_masters m ON m.user_id=o.assigned_user_id
 WHERE o.paid AND o.status='Выполнен' AND o.price>=0
), payouts AS (
 SELECT coalesce(sum(f.amount) FILTER (WHERE f.kind='raul_payout'),0)::numeric(14,2) raul_recorded_paid,
  coalesce(sum(f.amount) FILTER (WHERE f.kind='timur_payout'),0)::numeric(14,2) timur_recorded_paid
 FROM public.rabota_finance_operations f
 JOIN active_masters m ON m.user_id=f.master_user_id
 WHERE f.voided_at IS NULL
)
SELECT a.*,p.*,
 (a.raul_accrued-p.raul_recorded_paid)::numeric(14,2) raul_recorded_due,
 (a.timur_accrued-p.timur_recorded_paid)::numeric(14,2) timur_recorded_due
FROM accruals a CROSS JOIN payouts p;

ROLLBACK;
