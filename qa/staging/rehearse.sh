#!/usr/bin/env bash
# Use a new PostgreSQL 17 cluster with no network and a fake GoTrue schema.
set -euo pipefail
if [[ "$*" != --inside-container ]]; then
  qa_dir="$(cd "$(dirname "$0")" && pwd)"
  exec docker run --rm --network none -v "$qa_dir:/seed:ro" postgres:17 \
    bash /seed/rehearse.sh --inside-container
fi
if [[ ! -f /.dockerenv || "$(dirname "$0")" != /seed ]]; then
  exit 2
fi

cluster="$(mktemp -d /tmp/rabota-qa.XXXXXXXX)"
chown postgres:postgres "$cluster"
runuser -u postgres -- initdb --locale=C.utf8 -A trust -D "$cluster/data" >/dev/null
runuser -u postgres -- pg_ctl -D "$cluster/data" -l "$cluster/postgres.log" \
  -o "-k $cluster -h ''" start >/dev/null
export PGHOST="$cluster" PGUSER=postgres PGDATABASE=postgres
db() { psql -X -qAt -v ON_ERROR_STOP=1 "$@"; }
db <<'SQL'
CREATE DATABASE rabota_qa_rehearsal;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
SQL
export PGDATABASE=rabota_qa_rehearsal
db <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('sub', auth.uid(), 'email',
    (SELECT email FROM auth.users WHERE id=auth.uid()))
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
SQL
if db -f /seed/schema.sql >/dev/null 2>&1; then
  echo 'Schema accepted an unmarked target' >&2
  exit 1
fi
{ printf "%s\n" "SET rabota.qa_project_ref = 'local-rabota-qa';"; cat /seed/schema.sql; } | db
db <<'SQL'
INSERT INTO auth.users VALUES
  ('a2000000-0000-4000-8000-000000000001','owner@rabota-qa.example',now(),
   '{"rabota_qa_fixture":true}','{"full_name":"Владелец QA"}'),
  ('a2000000-0000-4000-8000-000000000002','manager@rabota-qa.example',now(),
   '{"rabota_qa_fixture":true}','{"full_name":"Менеджер QA"}'),
  ('a2000000-0000-4000-8000-000000000003','master@rabota-qa.example',now(),
   '{"rabota_qa_fixture":true}','{"full_name":"Рауль QA"}');
SQL
db -f /seed/seed.sql
db -f /seed/seed.sql
db -f /seed/verify.sql
pg_dump --format=custom --file="$cluster/synthetic.dump"
createdb rabota_qa_recovered
pg_restore --dbname=rabota_qa_recovered --exit-on-error --single-transaction "$cluster/synthetic.dump"
db -d rabota_qa_recovered -f /seed/verify.sql
