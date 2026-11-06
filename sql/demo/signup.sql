-- One sign-up, exactly like the app does it. Run with the APP connection string:
--   psql "$APP_DATABASE_URL" -f sql/demo/signup.sql
begin;
select pg_backend_pid()                                     as database_process,
       current_user                                         as login,
       current_setting('default_transaction_read_only')     as read_only;
insert into public.signups (name, email)
values ('CLI user', 'cli-' || floor(random() * 1000000)::int || '@example.test')
returning id, name, email, 'SAVED' as result;
commit;
