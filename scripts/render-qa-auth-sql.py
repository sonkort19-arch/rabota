#!/usr/bin/env python3
"""Optional offline QA Auth bootstrap. Prefer the supported admin API helper."""

import argparse
import json
import os
from pathlib import Path
import re
import warnings


PRODUCTION_REF = "yedzfmibceboncrytbqz"
ROLES = {"owner": "Владелец QA", "manager": "Менеджер QA", "master": "Рауль QA"}
REPO = Path(__file__).resolve().parents[1]


def private_path(value):
    path = Path(value).resolve()
    if path == REPO or REPO in path.parents:
        raise ValueError("Keep password files and generated SQL outside the repository.")
    return path


def password_hashes(path):
    if path.stat().st_mode & 0o077:
        raise ValueError("The password file must be private (chmod 600).")
    try:
        passwords = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError):
        raise ValueError("The password file must be a JSON object.") from None
    if (
        not isinstance(passwords, dict)
        or any(
            not isinstance(passwords.get(role), str)
            or not 16 <= len(passwords[role].encode("utf-8")) <= 72
            or "\0" in passwords[role]
            for role in ROLES
        )
        or len({passwords[role] for role in ROLES}) != len(ROLES)
    ):
        raise ValueError("Set a distinct password of 16-72 UTF-8 bytes for each role.")
    # Generate bcrypt locally so the Management API only receives hashes.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        try:
            import crypt
        except ImportError:
            raise ValueError("Offline bcrypt requires Python 3.12 with system libcrypt.") from None
    if crypt.METHOD_BLOWFISH not in crypt.methods:
        raise ValueError("System libcrypt does not provide bcrypt.")
    # Match GoTrue's bcrypt prefix and PostgreSQL's password-check fallback.
    salts = {role: "$2a$" + crypt.mksalt(crypt.METHOD_BLOWFISH, rounds=4096)[4:] for role in ROLES}
    values = [(role, crypt.crypt(passwords[role], salts[role])) for role in ROLES]
    if any(not isinstance(value, str) or not re.fullmatch(r"\$2a\$12\$[./A-Za-z0-9]{53}", value)
           for _, value in values):
        raise ValueError("System libcrypt did not produce valid bcrypt hashes.")
    return values


def render(project, values):
    return f"""-- Sensitive QA-only SQL. Contains bcrypt hashes, never plaintext passwords.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $qa_auth$
DECLARE
  fixture record;
  found_user auth.users%ROWTYPE;
  user_uuid uuid;
BEGIN
  IF current_user <> 'postgres'
    OR current_setting('rabota.qa_project_ref',true) IS DISTINCT FROM '{project}'
    OR to_regprocedure('public.rabota_qa_project_ref()') IS NULL THEN
    RAISE EXCEPTION 'A dedicated QA project reference is required';
  END IF;
  IF public.rabota_qa_project_ref() IS DISTINCT FROM '{project}' THEN
    RAISE EXCEPTION 'The dedicated QA project reference did not match';
  END IF;

  FOR fixture IN SELECT * FROM (VALUES
    {",\n    ".join(f"('{role}@rabota-qa.example','{ROLES[role]}','{value}')" for role, value in values)}
  ) AS account(email,display_name,password_hash)
  LOOP
    SELECT * INTO found_user FROM auth.users AS u WHERE u.email=fixture.email;
    IF FOUND THEN
      IF found_user.email_confirmed_at IS NULL
        OR found_user.raw_app_meta_data->>'rabota_qa_fixture' IS DISTINCT FROM 'true'
        OR NOT EXISTS (SELECT FROM auth.identities WHERE user_id=found_user.id AND provider='email') THEN
        RAISE EXCEPTION 'A reserved QA test address is already in use';
      END IF;
      CONTINUE;
    END IF;

    user_uuid := gen_random_uuid();
    INSERT INTO auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,
      confirmation_token,recovery_token,email_change_token_new,email_change,
      raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at)
    VALUES (user_uuid,'authenticated','authenticated',fixture.email,fixture.password_hash,now(),
      '','','','',jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
      'rabota_qa_fixture',true),jsonb_build_object('full_name',fixture.display_name),false,now(),now());
    INSERT INTO auth.identities (user_id,provider_id,identity_data,provider,created_at,updated_at)
    VALUES (user_uuid,user_uuid::text,jsonb_build_object('sub',user_uuid::text,'email',fixture.email,
      'email_verified',true,'phone_verified',false),'email',now(),now());
  END LOOP;
END;
$qa_auth$;
COMMIT;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_ref")
    parser.add_argument("password_file")
    parser.add_argument("output_sql")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]{20}", args.project_ref) or args.project_ref == PRODUCTION_REF:
        parser.error("Pass the identifier of a separate QA project.")
    try:
        output = private_path(args.output_sql)
        sql = render(args.project_ref, password_hashes(private_path(args.password_file)))
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(sql)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
