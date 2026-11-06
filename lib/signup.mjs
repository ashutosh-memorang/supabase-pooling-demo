// The sign-up story, driven only by the two connection strings in .env.
//   App       → APP_DATABASE_URL       (writes to public.signups)
//   Delivery  → APP_DATABASE_URL (same login, the incident) or DELIVERY_DATABASE_URL (own login, the fix)
// The Delivery script does what the incident script did: switch its connections to read-only
// "to be safe" with a session-level SET, run a check, and exit.
import pg from 'pg';
import { APP, DELIVERY } from './simple-config.mjs';

const SCRIPT_CONNECTIONS = 8; // a script/tool with a small connection pool

function client(conf) {
  const c = new pg.Client({
    connectionString: conf.url,
    // Supabase pooler certs chain to Supabase's own CA, not Node's default store.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    query_timeout: 20000,
  });
  c.on('error', () => {}); // a terminated backend must not crash the demo
  return c;
}

const PROBE = `select pg_backend_pid() as pid, current_user as login,
  current_setting('default_transaction_read_only') as read_only`;

let app = null;
async function appClient() {
  if (!app) {
    app = client(APP);
    await app.connect();
  }
  return app;
}
async function dropApp() {
  const old = app;
  app = null;
  await old?.end().catch(() => {});
}

const isConnectionError = (err) => !err?.code || err.code.startsWith('08') || err.code === '57P01';

async function trySignup(name, email) {
  const c = await appClient();
  let p;
  try {
    await c.query('begin');
    p = (await c.query(PROBE)).rows[0];
    const r = await c.query({ text: 'insert into public.signups (name, email) values ($1, $2) returning id', values: [name, email] });
    await c.query('commit');
    return { ok: true, id: r.rows[0].id, pid: p.pid, readOnly: p.read_only, login: p.login };
  } catch (err) {
    await c.query('rollback').catch(() => {});
    if (isConnectionError(err)) {
      await dropApp();
      throw err;
    }
    return { ok: false, code: err.code, error: err.message, pid: p?.pid ?? null, readOnly: p?.read_only ?? null, login: p?.login ?? APP.role };
  }
}

export async function signup({ name, email }) {
  name = String(name ?? '').trim().slice(0, 80) || 'New user';
  email = String(email ?? '').trim().slice(0, 120) || `user-${Date.now()}@example.test`;
  let result;
  try {
    result = await trySignup(name, email);
  } catch {
    result = await trySignup(name, email); // one retry on a dropped connection (e.g. right after Reset)
  }
  return { ...result, name, email, at: new Date().toISOString(), totalUsers: await countUsers() };
}

export async function countUsers() {
  const c = await appClient();
  return (await c.query('select count(*)::int as n from public.signups')).rows[0].n; // reads work even when read-only
}

export async function runScript({ login, connections = SCRIPT_CONNECTIONS }) {
  const own = login === 'own';
  const conf = own ? DELIVERY : APP;
  const conns = Array.from({ length: Math.max(1, Math.min(20, Number(connections) || 1)) }, () => client(conf));
  const pids = [];
  try {
    await Promise.all(conns.map((c) => c.connect()));
    await Promise.all(conns.map(async (c) => {
      await c.query('begin');
      await c.query('set default_transaction_read_only = on'); // the risky line: session level, no LOCAL
      const p = (await c.query(PROBE)).rows[0];
      await c.query('select count(*) from public.signups'); // the "check"
      await c.query('select pg_sleep(0.4)');
      await c.query('commit');
      pids.push(p.pid);
    }));
  } finally {
    await Promise.all(conns.map((c) => c.end().catch(() => {}))); // the script exits
  }
  return { login: conf.role, ownLogin: own, pids: [...new Set(pids)].sort(), at: new Date().toISOString() };
}

// "Restart the app's pooled connections": end the app login's Supavisor backends only
// (application_name = 'Supavisor'), never Supabase's own workers, then clear the
// setting on the backend running this query in case it is one of the spoiled ones.
export async function reset() {
  await dropApp();
  const c = client(APP);
  await c.connect();
  try {
    const r = await c.query(`select count(pg_terminate_backend(pid))::int as n from pg_stat_activity
      where usename = current_user and application_name = 'Supavisor' and pid <> pg_backend_pid()`);
    await c.query('reset default_transaction_read_only');
    return { terminated: r.rows[0].n, at: new Date().toISOString(), totalUsers: await countUsers() };
  } finally {
    await c.end().catch(() => {});
  }
}

export async function recentSignups(limit = 10) {
  const c = await appClient();
  return (await c.query({ text: 'select id, name, created_at, login_role, backend_pid from public.signups order by id desc limit $1', values: [limit] })).rows;
}

export async function closeApp() {
  await dropApp();
}

export const LOGINS = { app: APP.role, delivery: DELIVERY.role };
