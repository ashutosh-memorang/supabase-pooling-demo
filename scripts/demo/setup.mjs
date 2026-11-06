// One-time setup, run with the APP login (usually postgres):
//   npm run demo:setup
// Creates public.signups (RLS on) and the Delivery login from DELIVERY_DATABASE_URL
// (same name and password), so the two connection strings in .env are all you configure.
import pg from 'pg';
import { APP, DELIVERY } from '../../lib/simple-config.mjs';

const password = decodeURIComponent(new URL(DELIVERY.url).password);
if (!password) throw new Error('DELIVERY_DATABASE_URL has no password');

const c = new pg.Client({ connectionString: APP.url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query(`create table if not exists public.signups (
    id          bigint generated always as identity primary key,
    name        text not null,
    email       text not null,
    created_at  timestamptz not null default now(),
    login_role  text not null default session_user,      -- filled in by the database
    backend_pid int  not null default pg_backend_pid()    -- which database process saved it
  )`);
  // public tables are reachable through Supabase's REST API; with RLS on and no policies,
  // the anon/authenticated API keys can't read or write this table.
  await c.query('alter table public.signups enable row level security');

  const role = pg.escapeIdentifier(DELIVERY.role);
  const exists = (await c.query({ text: 'select 1 from pg_roles where rolname = $1', values: [DELIVERY.role] })).rowCount > 0;
  if (!exists) {
    await c.query(`create role ${role} login password ${pg.escapeLiteral(password)}`);
    console.log(`Created login "${DELIVERY.role}" (password taken from DELIVERY_DATABASE_URL).`);
  } else {
    console.log(`Login "${DELIVERY.role}" already exists; its password was not changed.`);
  }
  await c.query(`grant usage on schema public to ${role}`);
  await c.query(`grant select on public.signups to ${role}`); // Delivery can read, not write

  const n = (await c.query('select count(*)::int as n from public.signups')).rows[0].n;
  console.log(`Ready: public.signups has ${n} rows. App login "${APP.role}", Delivery login "${DELIVERY.role}".`);
} finally {
  await c.end();
}
