-- The Delivery script, written the way the incident script was:
-- it switches the SESSION to read-only "to be safe", runs a check, and exits.
--
-- BAD  (same login as the app):  psql "$APP_DATABASE_URL"      -f sql/demo/delivery-script.sql
-- GOOD (Delivery's own login):   psql "$DELIVERY_DATABASE_URL" -f sql/demo/delivery-script.sql
begin;
set default_transaction_read_only = on;   -- the risky line: session level, no LOCAL
select pg_backend_pid()                                 as database_process,
       current_user                                     as login,
       current_setting('default_transaction_read_only') as read_only;
select count(*) as signups_checked from public.signups;
commit;
-- psql exits here, but on the transaction pooler the database process it used stays open,
-- still read-only, and goes back into the pool for that login.
