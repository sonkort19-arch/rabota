#!/usr/bin/env bash
# Deliberately cannot restore production. Target must already exist and be empty.
set -euo pipefail
umask 077
[[ "${RABOTA_DISPOSABLE_DB:-}" == YES && "${PGHOST:-}" == 127.0.0.1 && "${PGDATABASE:-}" == rabota_restore ]] || {
 echo 'Refusing non-local/non-disposable restore target' >&2; exit 2;
}
backup_dir="${1:?Pass archive directory}"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
object_count="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S')")"
[[ "$object_count" == 0 ]] || { echo 'Restore target is not empty' >&2; exit 2; }
# Roles must be preprovisioned/reviewed. Never replay globals blindly into a managed service.
pg_restore --exit-on-error --single-transaction --dbname="$PGDATABASE" < "$backup_dir/database.dump"
echo 'Archive restored into disposable local target. Compare row fingerprints, RLS and RPC behavior.'
