-- Compatibility entrypoint for psql -f sql/audit-reliability-fixes.sql.
-- Actual deployment uses numbered scripts, with 003 only at approved cutover.
-- Does not apply 003 or make a backup. Review qa/SAFE_DEPLOYMENT.md first.
\ir 001-c1-emergency.sql
\ir 002-reliability.sql
