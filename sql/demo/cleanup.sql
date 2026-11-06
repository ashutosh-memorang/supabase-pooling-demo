-- Remove everything the demo created.
--   psql "$APP_DATABASE_URL" -f sql/demo/cleanup.sql
select count(pg_terminate_backend(pid)) as delivery_processes_ended
from pg_stat_activity where usename = 'delivery';
drop table if exists public.signups;
drop role if exists delivery;
