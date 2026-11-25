#!/usr/bin/env bash
# This suite uses disposable PostgreSQL 17 databases and synthetic data.
set -euo pipefail
cd "$(dirname "$0")/.."

bash tests/payroll-v3-local.sh
bash tests/module-permissions-local.sh

cluster="$(mktemp -d)"
cleanup() {
  pg_ctl -D "$cluster/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$cluster"
}
trap cleanup EXIT

export CI=true
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
export PGPASSWORD=disposable-backup-drill-only
unset PGSERVICE PGSERVICEFILE PGOPTIONS
printf '%s\n' "$PGPASSWORD" > "$cluster/password"
initdb -D "$cluster/data" --username=postgres --locale=C.utf8 --encoding=UTF8 \
  --auth-host=scram-sha-256 --auth-local=trust --pwfile="$cluster/password" >/dev/null
if ! pg_ctl -D "$cluster/data" -l "$cluster/postgres.log" \
  -o "-k $cluster -h 127.0.0.1 -p 5432" -w start >/dev/null; then
  cat "$cluster/postgres.log" >&2
  exit 1
fi

for fixture in tests/sql/roles-stage3-fixture.sql sql/008-protect-paid-orders.sql \
  sql/009-owner-only-salary-payout.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -f "$fixture"
done
psql -X -q -v ON_ERROR_STOP=1 -c "CREATE TABLE public.rabota_cashbook_entries (id uuid PRIMARY KEY,amount numeric,kind text)"
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/step05-backup-seed.sql
bash tests/step05-backup-restore.sh
