// Admin-side SQL runs through the Supabase CLI's Management API
// (`supabase db query --linked`), using the CLI login you already have.
// This means we never need the project's postgres password, and admin work
// never goes through the pools under test.
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_REF } from './config.mjs';

const run = promisify(execFile);

export const TEST_ROLES = ['test_app', 'test_delivery', 'test_readonly_human', 'test_maint', 'test_shared', 'test_migrator'];
const TEST_ROLES_SQL = TEST_ROLES.map((r) => `'${r}'`).join(',');

export async function adminQuery(sql) {
  // SQL goes through a private temp file so passwords never appear in `ps` output.
  const dir = mkdtempSync(join(tmpdir(), 'pool-test-'));
  const file = join(dir, 'q.sql');
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    // `--agent no` pins the output to a plain JSON array of the LAST statement's rows
    // (in agent mode the CLI wraps rows in an object instead).
    const { stdout } = await run(
      'supabase',
      ['db', 'query', '--agent', 'no', '--linked', '--project-ref', PROJECT_REF, '-o', 'json', '-f', file],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const json = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(json) ? json : (json.rows ?? []);
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || '').split('\n').filter((l) => l && !/new version|updating/i.test(l)).join(' ');
    throw new Error(`Admin query failed: ${msg}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Which server backends currently belong to the test roles.
export function snapshotTestBackends() {
  return adminQuery(`
    select pid, usename, backend_start, state, application_name
    from pg_stat_activity
    where usename in (${TEST_ROLES_SQL})
    order by usename, pid;`);
}

// "Recycling" = terminating the server backends of the given *test* roles only.
// Supavisor then opens fresh backends, which start with default settings.
// Never touches any non-test role.
export async function recycleBackends(roles = TEST_ROLES) {
  const safe = roles.filter((r) => TEST_ROLES.includes(r));
  if (!safe.length) return { terminated: [], remaining: [] };
  const list = safe.map((r) => `'${r}'`).join(',');
  const terminated = await adminQuery(`
    select pid, usename, pg_terminate_backend(pid) as terminated
    from pg_stat_activity
    where usename in (${list}) and pid <> pg_backend_pid();`);
  await new Promise((r) => setTimeout(r, 1500));
  const killed = new Set(terminated.map((t) => t.pid));
  const remaining = (await snapshotTestBackends()).filter((b) => killed.has(b.pid));
  return { terminated, remaining };
}
