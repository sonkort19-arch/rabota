#!/usr/bin/env bash
# GitHub Actions PostgreSQL 17 test. NEVER run against production.
set -euo pipefail

if [[ "${PGHOST:-}" != "127.0.0.1" ||
      "${PGPORT:-}" != "5432" ||
      "${PGUSER:-}" != "postgres" ||
      "${PGDATABASE:-}" != "postgres" ||
      "${PGPASSWORD:-}" != "disposable-ci-only" ]]; then
  echo "Refusing drift test outside disposable CI PostgreSQL." >&2
  exit 2
fi

original="$(mktemp)"
log="$(mktemp)"
trap 'rm -f "$original" "$log"' EXIT

# Keep the exact original synthetic function DDL, then restore it afterward.
psql -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT pg_catalog.pg_get_functiondef('private.rabota_cash_order_guard()'::pg_catalog.regprocedure)" > "$original"
test -s "$original"

# Simulate changed legacy cash protection in a synthetic DB only.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION private.rabota_cash_order_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $guard$
BEGIN
  -- Deliberate drift, not production logic: the old guard's checks are absent.
  RETURN NEW;
END
$guard$;
SQL

# A real application of SQL 008 must abort *before* altering the payment RPCs.
if psql -X -v ON_ERROR_STOP=1 -f sql/008-protect-paid-orders.sql > "$log" 2>&1; then
  echo "FAIL: SQL 008 accepted drifted cash guard." >&2
  exit 1
fi
if ! grep -Fq 'Original cash guard source changed since audit: STOP' "$log"; then
  echo "FAIL: SQL 008 stopped for an unexpected reason." >&2
  exit 1
fi
# ON_ERROR_STOP closes the failed explicit transaction, rolling back SQL 008.

psql -X -v ON_ERROR_STOP=1 -f "$original" >/dev/null

restored_hash="$(psql -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='private.rabota_cash_order_guard()'::pg_catalog.regprocedure")"
if [[ "$restored_hash" != "27e721f9909f2ab0e7d08dcea1a3225c" ]]; then
  echo "FAIL: synthetic cash guard not restored exactly." >&2
  exit 1
fi
echo "PASS: SQL 008 rejects drifted old cash guard; fake baseline restored."
