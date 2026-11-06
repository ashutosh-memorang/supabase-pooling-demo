-- What actually got saved (failed sign-ups never become rows).
--   psql "$APP_DATABASE_URL" -f sql/demo/check.sql
select id, name, email, created_at, login_role, backend_pid
from public.signups order by id desc limit 20;
