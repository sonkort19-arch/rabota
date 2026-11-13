#!/usr/bin/env bash
# DISPOSABLE PostgreSQL 17 CI ONLY. Never point this script at Supabase.
set -euo pipefail

if [[ "$CI" != "true" || "$PGHOST" != "127.0.0.1" ||
      "$PGPORT" != "5432" || "$PGUSER" != "postgres" ||
      "$PGDATABASE" != "postgres" ]]; then
  echo "REFUSED: backup/restore drill is restricted to disposable CI PostgreSQL" >&2
  exit 2
fi
if [[ -z "$PGPASSWORD" ]]; then
  echo "REFUSED: expected disposable CI database password" >&2
  exit 2
fi

RESTORE_DB="rabota_stage5_restored"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Backup a synthetic source database containing fake order, cash and salary data.
pg_dump --format=custom --no-owner --dbname="$PGDATABASE" \
  --file="$WORK/synthetic-backup.dump"
(
  cd "$WORK"
  sha256sum synthetic-backup.dump > synthetic-backup.sha256
  sha256sum --check synthetic-backup.sha256
)
pg_restore --list "$WORK/synthetic-backup.dump" > "$WORK/archive.manifest"
grep -q 'rabota_orders' "$WORK/archive.manifest"
echo "PASS: disposable archive generated, listed and SHA-256 verified"

# Corruption MUST be detected before a restore is considered.
cp "$WORK/synthetic-backup.dump" "$WORK/corrupted.dump"
printf 'intentional damage' >> "$WORK/corrupted.dump"
if [[ "$(sha256sum "$WORK/corrupted.dump" | cut -d' ' -f1)" ==
      "$(sha256sum "$WORK/synthetic-backup.dump" | cut -d' ' -f1)" ]]; then
  echo "FAIL: corrupted archive retained original digest" >&2
  exit 1
fi
echo "PASS: tampering changes checksum; invalid archive must be rejected"

# Compare all core financial tables and structural security objects, not just file size.
psql -X -qAt -v ON_ERROR_STOP=1 --dbname="$PGDATABASE" \
  --file=tests/sql/step05-restore-fingerprint.sql > "$WORK/before.fingerprint"

createdb "$RESTORE_DB"
pg_restore --exit-on-error --single-transaction --no-owner \
  --dbname="$RESTORE_DB" "$WORK/synthetic-backup.dump"
psql -X -qAt -v ON_ERROR_STOP=1 --dbname="$RESTORE_DB" \
  --file=tests/sql/step05-restore-fingerprint.sql > "$WORK/after.fingerprint"

if ! diff -u "$WORK/before.fingerprint" "$WORK/after.fingerprint"; then
  echo "FAIL: restored data, policies, functions or triggers differ" >&2
  exit 1
fi

# Check restored payment protection and owner-only salary policy with fake users.
psql -X -v ON_ERROR_STOP=1 --dbname="$RESTORE_DB" \
  --file=tests/sql/step05-restored-security.sql

echo "PASS: independent disposable restore has matching rows, RLS, triggers and RPCs"
echo "NOTE: This is NOT a backup or restore of the live Supabase project."
