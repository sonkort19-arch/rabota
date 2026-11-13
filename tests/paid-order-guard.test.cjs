'use strict';
// Static migration contract checks; NOT a substitute for PostgreSQL integration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '008-protect-paid-orders.sql'), 'utf8');

test('transaction, short lock and statement timeouts', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /SET LOCAL lock_timeout\s*=\s*'5s'/);
  assert.match(sql, /SET LOCAL statement_timeout\s*=\s*'30s'/);
  assert.match(sql, /COMMIT;\s*$/);
});
test('separate SECURITY INVOKER trigger on existing Rabota table', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.rabota_paid_order_guard\(\)/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /CREATE OR REPLACE TRIGGER rabota_paid_order_guard_trigger/);
  assert.match(sql, /BEFORE UPDATE ON public\.rabota_orders/);
});
test('existing cash distribution guard is not dropped', () => {
  assert.doesNotMatch(sql, /DROP (?:TRIGGER|FUNCTION)/i);
  assert.doesNotMatch(sql, /DELETE FROM public\.rabota_orders/i);
  assert.doesNotMatch(sql, /UPDATE public\.rabota_orders/i);
});
test('protect paid rows and payment markers', () => {
  for (const property of ['paid','payment_method','payment_amount','payment_received_by','paid_at','paid_by']) {
    assert.ok(sql.includes(`OLD.${property}`), `missing ${property}`);
  }
  for (const property of ['price','appointment_date','appointment_time','status','name','phone','master','assigned_user_id','details','lead_id']) {
    assert.ok(sql.includes(`NEW.${property}`), `missing ${property}`);
  }
});
test('legacy cash fill is tightly scoped to master and original price', () => {
  for (const token of [
    "NEW.payment_method = 'cash'",
    'NEW.payment_amount = OLD.price',
    "NEW.payment_received_by = 'master'",
    'OLD.assigned_user_id = (SELECT auth.uid())',
    "(SELECT private.rabota_my_role()) = 'master'",
    'NOT EXISTS (',
    'public.rabota_cash_collections'
  ]) assert.ok(sql.includes(token), `missing ${token}`);
});
