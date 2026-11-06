-- Restart the app login's pooled database processes (clears any leftover read-only setting).
-- Only touches processes opened by Supavisor for YOUR login; Supabase's own workers are left alone.
--   psql "$APP_DATABASE_URL" -f sql/demo/reset.sql
select count(pg_terminate_backend(pid)) as restarted
from pg_stat_activity
where usename = current_user and application_name = 'Supavisor' and pid <> pg_backend_pid();
reset default_transaction_read_only;   -- and fix the process running this very query
