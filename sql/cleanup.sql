-- Removes everything setup.sql and realistic-*.sql created. Only touches test_* roles and the pool_test / realistic_test schemas.

-- 1. End the server backends that belong to the test roles (this also discards
--    any leftover session-level settings). No other role's connections are touched.
select pid, usename, pg_terminate_backend(pid) as terminated
from pg_stat_activity
where usename in ('test_app','test_delivery','test_readonly_human','test_maint','test_shared','test_migrator');

-- 2. Drop the synthetic data and the roles.
drop schema if exists pool_test cascade;
-- realistic_test is owned by postgres, so CASCADE also drops the tables test_migrator owns.
drop schema if exists realistic_test cascade;
drop role if exists test_app;
drop role if exists test_delivery;
drop role if exists test_readonly_human;
drop role if exists test_maint;
drop role if exists test_shared;
drop role if exists test_migrator;

-- 3. Prove it is gone.
select
  (select count(*) from pg_roles where rolname like 'test\_%') as remaining_test_roles,
  (select count(*) from pg_namespace where nspname in ('pool_test', 'realistic_test')) as remaining_test_schemas;
