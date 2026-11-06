-- Disposable test fixtures. Run only via `npm run setup` (passwords are filled in from .env).
-- Creates: 4 login roles named test_*, schema pool_test, table pool_test.events.

-- Passwords are set only when a role is first created. Re-running setup must not
-- ALTER the password: that re-hashes it with a new salt, and Supavisor keeps using
-- its cached auth secret for a while, so logins briefly fail with 28P01.
do $$
declare
  roles text[] := array['test_app','test_delivery','test_readonly_human','test_maint'];
  pws   text[] := array[:'test_app_pw', :'test_delivery_pw', :'test_human_pw', :'test_maint_pw'];
begin
  for i in 1 .. array_length(roles, 1) loop
    if not exists (select 1 from pg_roles where rolname = roles[i]) then
      execute format('create role %I login password %L', roles[i], pws[i]);
    end if;
  end loop;
end $$;

-- Ordinary roles: no role/db creation, no inheritance, and no per-role settings
-- (a per-role setting would apply to every new connection, which is a different
-- failure mode from this test). CREATE ROLE already defaults to nosuperuser /
-- noreplication / nobypassrls; only a superuser may even state those clauses,
-- so the final SELECT verifies them instead.
alter role test_app            with login nocreatedb nocreaterole noinherit;
alter role test_delivery       with login nocreatedb nocreaterole noinherit;
alter role test_readonly_human with login nocreatedb nocreaterole noinherit;
alter role test_maint          with login nocreatedb nocreaterole noinherit;
alter role test_app reset all;
alter role test_delivery reset all;
alter role test_readonly_human reset all;
alter role test_maint reset all;

create schema if not exists pool_test;
create table if not exists pool_test.events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source     text not null,
  note       text
);
-- Filled in by the database itself, so each saved row proves which login and
-- which backend process wrote it. experiment/run_id let you find one run's rows.
alter table pool_test.events add column if not exists experiment  text;
alter table pool_test.events add column if not exists run_id      text;
alter table pool_test.events add column if not exists login_role  text default session_user;
alter table pool_test.events add column if not exists backend_pid int  default pg_backend_pid();
create index if not exists events_run_id_idx on pool_test.events (run_id);

revoke all on schema pool_test from public;
revoke all on all tables in schema pool_test from public;

grant usage on schema pool_test to test_app, test_delivery, test_readonly_human, test_maint;
grant select, insert on pool_test.events to test_app;            -- the application writes
grant select on pool_test.events to test_delivery;                -- Delivery only reads
grant select on pool_test.events to test_readonly_human;          -- humans only read
grant select, delete on pool_test.events to test_maint;           -- maintenance: prune test rows only

-- Return what was created so the caller can record it.
select r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolbypassrls, r.rolinherit,
       coalesce(r.rolconfig::text, '{}') as role_settings,
       (select coalesce(string_agg(g.rolname, ','), '') from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) as member_of
from pg_roles r
where r.rolname in ('test_app','test_delivery','test_readonly_human','test_maint')
order by r.rolname;
