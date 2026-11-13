#!/usr/bin/env bash
# Offline checksums for Supabase CLI dumps; never uploads or prints SQL rows.
set -euo pipefail
umask 077

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "Usage: bash scripts/verify-supabase-dump-local.sh /private/offline/backup-folder" >&2
  exit 2
fi
dir="$(cd "$1" && pwd -P)"
repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
case "$dir/" in
  "$repo_root/"*) echo "REFUSED: backup must stay outside the Git repository" >&2; exit 2 ;;
esac
for file in roles.sql schema.sql data.sql; do
  if [ ! -f "$dir/$file" ] || [ ! -s "$dir/$file" ] || [ ! -r "$dir/$file" ]; then
    echo "REFUSED: missing, empty, or unreadable $file" >&2
    exit 2
  fi
done

cd "$dir"
if command -v sha256sum >/dev/null 2>&1; then
  hash_list() { sha256sum roles.sql schema.sql data.sql; }
  hash_check() { sha256sum --check --status SHA256SUMS; }
elif command -v shasum >/dev/null 2>&1; then
  hash_list() { shasum -a 256 roles.sql schema.sql data.sql; }
  hash_check() { shasum -a 256 --check --status SHA256SUMS; }
else
  echo "REFUSED: SHA-256 tool unavailable" >&2
  exit 2
fi

if [ -e SHA256SUMS ]; then
  if ! hash_check; then
    echo "FAILED: checksum mismatch; do not overwrite the original manifest" >&2
    exit 1
  fi
  echo "PASS: existing SHA256SUMS verified; no files overwritten"
else
  hash_list > SHA256SUMS.tmp
  chmod 600 SHA256SUMS.tmp
  mv -n SHA256SUMS.tmp SHA256SUMS
  if ! hash_check; then
    echo "FAILED: checksum verification" >&2
    exit 1
  fi
  echo "PASS: SHA256SUMS created and verified locally"
fi

echo "File checksums do NOT prove restored database integrity or Auth coverage."
echo "Keep this backup encrypted and private; never upload it to GitHub or chat."
