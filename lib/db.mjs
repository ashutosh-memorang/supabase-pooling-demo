// Thin helpers around node-postgres for the experiment clients.
// Every query here is parameter-free, so pg uses the simple query protocol:
// no prepared statements, which Supavisor transaction mode does not support.
import pg from 'pg';
import { PROJECT_REF, describeEndpoint } from './config.mjs';

export async function connect(path, clientName) {
  const client = new pg.Client({
    host: path.host,
    port: path.port,
    database: 'postgres',
    // Supavisor's shared pooler identifies the project from the "<role>.<project-ref>" username.
    user: `${path.role}.${PROJECT_REF}`,
    password: path.password,
    // Disposable test only: Supabase pooler certs chain to Supabase's own CA, which
    // is not in Node's default trust store. Use the project's CA cert for anything real.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    query_timeout: 20000, // never let a stuck pooled transaction hang the demo
  });
  client.on('error', () => {}); // a terminated backend must not crash the demo
  await client.connect();
  return { client, path, name: clientName, endpoint: describeEndpoint(path) };
}

export const PROBE_SQL = `select pg_backend_pid() as pid,
  current_user as current_user,
  session_user as session_user,
  current_setting('default_transaction_read_only') as default_ro,
  current_setting('transaction_read_only') as txn_ro,
  to_char(clock_timestamp() at time zone 'UTC', 'HH24:MI:SS.MS') as ts`;

// Common record shape so the page and the report can render every step the same way.
export function event(conn, step, probe, result, detail = '') {
  return {
    at: new Date().toISOString(),
    client: conn.name,
    path: conn.path.label,
    mode: conn.path.mode,
    loginRole: probe?.session_user ?? conn.path.role,
    currentUser: probe?.current_user ?? null,
    pid: probe?.pid ?? null,
    defaultReadOnly: probe?.default_ro ?? null,
    txnReadOnly: probe?.txn_ro ?? null,
    dbTime: probe?.ts ?? null,
    step,
    result,
    detail,
  };
}

export function errResult(err) {
  return err?.code ? `ERROR ${err.code}` : 'ERROR';
}

export async function safeEnd(conn) {
  try {
    await conn?.client.end();
  } catch {}
}

export async function rollbackQuietly(conn) {
  try {
    await conn.client.query('rollback');
  } catch {}
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Safe literal for the short, code-generated labels we insert.
export const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
