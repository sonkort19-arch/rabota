#!/usr/bin/env bash
# Run with PostgreSQL 17 binaries on PATH, or set RABOTA_PG_BIN to their directory.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${RABOTA_PG_BIN:-}" ]]; then
  export PATH="$RABOTA_PG_BIN:$PATH"
fi

db_dir="$(mktemp -d /tmp/rabota-module-db.XXXXXXXX)"
cleanup() {
  pg_ctl -D "$db_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$db_dir"
}
trap cleanup EXIT

initdb -D "$db_dir/data" --auth=trust --username=rabota_module_test \
  --locale=C --encoding=UTF8 >/dev/null
if ! pg_ctl -D "$db_dir/data" -l "$db_dir/postgres.log" \
  -o "-k $db_dir -h '' -p 5432" -w start >/dev/null; then
  cat "$db_dir/postgres.log" >&2
  exit 1
fi
psql -X -q -h "$db_dir" -p 5432 -U rabota_module_test -d postgres \
  -v ON_ERROR_STOP=1 -f tests/sql/module-permissions.sql
