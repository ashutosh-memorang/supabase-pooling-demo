// Config for the sign-up demo: two connection strings from .env.
//   APP_DATABASE_URL       the app's connection string (transaction pooler, usually the postgres login)
//   DELIVERY_DATABASE_URL  Delivery's own login on the same pooler
// Refuses to run unless both point at the one allow-listed, disposable project.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;

function fail(msg) {
  throw new Error(`SAFETY GUARD: ${msg} (see README → Setup)`);
}

function parse(name) {
  const raw = env[name];
  if (!raw) fail(`${name} is missing in .env`);
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail(`${name} is not a valid postgresql:// URL`);
  }
  const user = decodeURIComponent(u.username);
  const dot = user.lastIndexOf('.');
  const role = dot > 0 ? user.slice(0, dot) : user;
  const ref = dot > 0 ? user.slice(dot + 1) : '';
  if (!/\.pooler\.supabase\.com$/.test(u.hostname)) fail(`${name} must use the Supabase pooler host (*.pooler.supabase.com)`);
  if (!ref) fail(`${name} username must look like <role>.<project-ref>`);
  return { url: raw, role, ref, host: u.hostname, port: Number(u.port || 5432) };
}

if (env.CONFIRM_DISPOSABLE !== 'yes') fail('CONFIRM_DISPOSABLE is not "yes" in .env');
export const APP = parse('APP_DATABASE_URL');
export const DELIVERY = parse('DELIVERY_DATABASE_URL');
for (const c of [APP, DELIVERY]) {
  if (c.ref !== env.ALLOWED_PROJECT_REF) fail(`project ref "${c.ref}" does not match ALLOWED_PROJECT_REF`);
}
if (APP.port !== 6543) fail('APP_DATABASE_URL must use the transaction pooler port 6543 (that is where the incident happens)');
if (APP.role === DELIVERY.role) fail('APP and DELIVERY must use different logins');

export const describe = (c) => `${c.role} @ ${c.host}:${c.port} (${c.port === 6543 ? 'transaction' : 'session'} pooler)`;
