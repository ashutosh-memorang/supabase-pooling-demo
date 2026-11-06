-- Realistic scenario, part 1 (run as postgres via `npm run realistic:setup`).
-- Mirrors a typical Supabase project:
--   * test_migrator  = the login that owns the tables (in production: postgres).
--   * test_shared    = "the one connection string" used by app, hub, assessment AND, in the
--                      incident, the migration. It has the owner's powers through membership,
--                      just like everyone logging in as postgres.
-- Only test_* roles and the realistic_test schema are created.

do $$
declare
  roles text[] := array['test_migrator', 'test_shared'];
  pws   text[] := array[:'test_migrator_pw', :'test_shared_pw'];
begin
  for i in 1 .. array_length(roles, 1) loop
    if not exists (select 1 from pg_roles where rolname = roles[i]) then
      execute format('create role %I login password %L', roles[i], pws[i]);
    end if;
  end loop;
end $$;

alter role test_migrator with login nocreatedb nocreaterole noinherit;
alter role test_shared   with login nocreatedb nocreaterole noinherit;
alter role test_migrator reset all;
alter role test_shared   reset all;

-- The schema belongs to postgres; the migrator may create (and so owns) the tables in it.
create schema if not exists realistic_test;
revoke all on schema realistic_test from public;
grant usage, create on schema realistic_test to test_migrator;
grant usage on schema realistic_test to test_shared;

-- The shared login can do anything the owner can (like a shared postgres login).
-- Note: membership does NOT change which pool a connection uses: pools follow the LOGIN role.
grant test_migrator to test_shared with inherit true;

select r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       (select coalesce(string_agg(g.rolname || case when m.inherit_option then ' (inherit)' else '' end, ','), '')
          from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) as member_of
from pg_roles r
where r.rolname in ('test_migrator', 'test_shared')
order by r.rolname;
