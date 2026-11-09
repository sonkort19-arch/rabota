#!/usr/bin/env bash
# Logical archive only. Requires separately configured libpq credentials; never prints them.
set -euo pipefail
umask 077
export PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c default_transaction_read_only=on"
: "${RABOTA_BACKUP_ACK:?Set RABOTA_BACKUP_ACK=READ_ONLY to authorize a read-only export}"
[[ "$RABOTA_BACKUP_ACK" == READ_ONLY ]] || exit 2
: "${PGDATABASE:?Set libpq PGDATABASE (no password in command arguments)}"
: "${PGHOST:?Set the intended source host explicitly}"
backup_dir="${1:?Pass a private directory outside the checkout}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd)"
case "$backup_dir/" in "$repo_root/"*) echo 'Refusing to store production archive in Git checkout' >&2; exit 2;; esac
[[ ! -e "$backup_dir/database.dump" ]] || { echo 'Refusing to overwrite an archive' >&2; exit 2; }
pg_dump --format=custom --lock-wait-timeout=5s > "$backup_dir/database.dump.partial"
pg_restore --list < "$backup_dir/database.dump.partial" > "$backup_dir/archive-toc.txt"
pg_dumpall --roles-only --no-role-passwords > "$backup_dir/roles.sql"
mv "$backup_dir/database.dump.partial" "$backup_dir/database.dump"
(cd "$backup_dir" && sha256sum database.dump roles.sql > SHA256SUMS)
echo 'Logical archive created. Restore rehearsal, Auth/Storage/platform configuration remain separate gates.'
