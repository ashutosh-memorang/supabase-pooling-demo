// Loads .env and refuses to run against anything except the one allow-listed,
// disposable Supabase project.
import { existsSync } from 'node:fs';

if (!existsSync('.env')) {
  throw new Error('No .env found. Run: npm run lab:init-env -- <project-ref> <pooler-host>');
}
process.loadEnvFile('.env');

const env = process.env;

function fail(msg) {
  throw new Error(`SAFETY GUARD: ${msg}`);
}

if (env.CONFIRM_DISPOSABLE !== 'yes') fail('CONFIRM_DISPOSABLE is not "yes" in .env.');
if (!env.PROJECT_REF || env.PROJECT_REF !== env.ALLOWED_PROJECT_REF) {
  fail('PROJECT_REF must be set and equal ALLOWED_PROJECT_REF.');
}
if (!/^[a-z0-9]{20}$/.test(env.PROJECT_REF)) fail('PROJECT_REF does not look like a Supabase project ref.');
if (!/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(env.POOLER_HOST ?? '')) {
  fail('POOLER_HOST must be a Supabase shared pooler host (aws-N-region.pooler.supabase.com).');
}
for (const k of ['TEST_APP_PASSWORD', 'TEST_DELIVERY_PASSWORD', 'TEST_HUMAN_PASSWORD', 'TEST_MAINT_PASSWORD', 'TEST_SHARED_PASSWORD', 'TEST_MIGRATOR_PASSWORD']) {
  if (!env[k] || env[k].length < 20) fail(`${k} is missing or too short. Run: npm run lab:init-env`);
}

export const PROJECT_REF = env.PROJECT_REF;

// One "path" = one login role + one pooler endpoint/mode.
// Supavisor keys its pools by (tenant, user, mode, database), so two paths
// that differ in role or mode never share a server connection.
const endpoint = (mode) => ({
  host: env.POOLER_HOST,
  port: Number(mode === 'transaction' ? env.POOLER_TRANSACTION_PORT : env.POOLER_SESSION_PORT),
  mode,
});

export const PATHS = {
  appTx: { label: 'App (test_app) · transaction pool :6543', role: 'test_app', password: env.TEST_APP_PASSWORD, ...endpoint('transaction') },
  deliveryTx: { label: 'Delivery (test_delivery) · transaction pool :6543', role: 'test_delivery', password: env.TEST_DELIVERY_PASSWORD, ...endpoint('transaction') },
  deliverySession: { label: 'Delivery (test_delivery) · session pool :5432', role: 'test_delivery', password: env.TEST_DELIVERY_PASSWORD, ...endpoint('session') },
  humanSession: { label: 'Human read-only (test_readonly_human) · session pool :5432', role: 'test_readonly_human', password: env.TEST_HUMAN_PASSWORD, ...endpoint('session') },
  maintSession: { label: 'Maintenance (test_maint) · session pool :5432', role: 'test_maint', password: env.TEST_MAINT_PASSWORD, ...endpoint('session') },

  // Realistic scenario: test_shared plays "the one connection string everyone uses";
  // test_migrator is the separate login a migration should use instead.
  sharedTx: { label: 'Shared login (test_shared) · transaction pool :6543', role: 'test_shared', password: env.TEST_SHARED_PASSWORD, ...endpoint('transaction') },
  migratorTx: { label: 'Migrator (test_migrator) · transaction pool :6543', role: 'test_migrator', password: env.TEST_MIGRATOR_PASSWORD, ...endpoint('transaction') },
  migratorSession: { label: 'Migrator (test_migrator) · session pool :5432', role: 'test_migrator', password: env.TEST_MIGRATOR_PASSWORD, ...endpoint('session') },
};

export const ROLE_PASSWORDS = {
  test_app: env.TEST_APP_PASSWORD,
  test_delivery: env.TEST_DELIVERY_PASSWORD,
  test_readonly_human: env.TEST_HUMAN_PASSWORD,
  test_maint: env.TEST_MAINT_PASSWORD,
  test_shared: env.TEST_SHARED_PASSWORD,
  test_migrator: env.TEST_MIGRATOR_PASSWORD,
};

export function describeEndpoint(p) {
  return `${p.host}:${p.port} (${p.mode} mode) as ${p.role}.${PROJECT_REF}`;
}
