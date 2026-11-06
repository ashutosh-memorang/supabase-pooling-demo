// Realistic scenario: three services (app, hub, assessment) write continuously through
// one shared login + transaction pool, while a migration runs.
//   Run 1: the migration uses the SAME shared login        → reproduces the incident
//   Run 2: the migration uses its OWN login (test_migrator) → the fix
// Everything that decides the verdict is counted from the tables themselves afterwards.
import { readFileSync } from 'node:fs';
import { PATHS, ROLE_PASSWORDS } from './config.mjs';
import { connect, errResult, lit, PROBE_SQL, rollbackQuietly, safeEnd, sleep } from './db.mjs';
import { adminQuery, snapshotTestBackends } from './admin.mjs';
import { recycleStep, snapshotEvent } from './experiments.mjs';

const REALISTIC_ROLES = ['test_shared', 'test_migrator'];
const uniq = (xs) => [...new Set(xs.filter((x) => x != null))];

// ---------- setup ----------

async function connectWithRetry(path, name, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      return await connect(path, name);
    } catch (err) {
      // A brand-new role can take a moment before the pooler accepts it.
      if (i >= tries) throw err;
      await sleep(3000);
    }
  }
}

export async function setupRealistic() {
  const adminSql = readFileSync(new URL('../sql/realistic-admin.sql', import.meta.url), 'utf8')
    .replace(":'test_migrator_pw'", lit(ROLE_PASSWORDS.test_migrator))
    .replace(":'test_shared_pw'", lit(ROLE_PASSWORDS.test_shared));
  const roles = await adminQuery(adminSql);

  // Tables are created BY the migrator login so it owns them, like a real migration user.
  const conn = await connectWithRetry(PATHS.migratorSession, 'Migrator (setup)');
  try {
    const res = await conn.client.query(readFileSync(new URL('../sql/realistic-tables.sql', import.meta.url), 'utf8'));
    const counts = (Array.isArray(res) ? res.at(-1) : res).rows[0];
    return { verdict: 'OK', headline: `Realistic tables ready: ${counts.learners} learners, ${counts.assessments} assessments, ${counts.submissions} submissions, ${counts.hub_events} hub events.`, roles, counts };
  } finally {
    await safeEnd(conn);
  }
}

// ---------- the three services ----------

// Each service does the kind of write it would do in real life, all inside one transaction.
const SERVICES = {
  app: (runId) => `insert into realistic_test.learners (name, email, service, run_id)
    values ('New learner', 'new-' || gen_random_uuid() || '@example.test', 'app', ${lit(runId)})`,
  assessment: (runId) => `with pick as (
      select (select min(id) from realistic_test.learners) + floor(random() * 200)::int as learner_id,
             (select min(id) from realistic_test.assessments) + floor(random() * 20)::int as assessment_id
    ), sub as (
      insert into realistic_test.submissions (learner_id, assessment_id, score, service, run_id)
      select learner_id, assessment_id, floor(random() * 101)::int, 'assessment', ${lit(runId)} from pick
      returning assessment_id
    )
    update realistic_test.assessments a set attempts = attempts + 1, updated_at = now()
    from sub where a.id = sub.assessment_id`,
  hub: (runId) => `insert into realistic_test.hub_events (kind, payload, service, run_id)
    values ('sync', jsonb_build_object('source', 'hub', 'at', now()), 'hub', ${lit(runId)})`,
};

async function serviceTxn(conn, service, runId, t0) {
  let p;
  try {
    await conn.client.query('begin');
    p = (await conn.client.query(PROBE_SQL)).rows[0];
    await conn.client.query(SERVICES[service](runId));
    await conn.client.query('commit');
    return { t: Date.now() - t0, service, client: conn.name, pid: p.pid, ro: p.default_ro, result: 'OK' };
  } catch (err) {
    await rollbackQuietly(conn);
    return { t: Date.now() - t0, service, client: conn.name, pid: p?.pid ?? null, ro: p?.default_ro ?? null, result: errResult(err), detail: err.message };
  }
}

async function serviceWorker(service, n, runId, t0, until, out) {
  const conn = await connect(PATHS.sharedTx, `${service} #${n}`);
  try {
    while (Date.now() < until) {
      out.push(await serviceTxn(conn, service, runId, t0));
      await sleep(40);
    }
  } finally {
    await safeEnd(conn);
  }
}

// ---------- the migration ----------

async function runMigration(path, t0, log) {
  const step = async (conn, label, sqls, result = 'OK') => {
    await conn.client.query('begin');
    const p = (await conn.client.query(PROBE_SQL)).rows[0];
    let detail = '';
    try {
      for (const sql of sqls) {
        const r = await conn.client.query(sql);
        if (r.command === 'UPDATE') detail = `${r.rowCount} rows updated`;
      }
      await conn.client.query('commit');
    } catch (err) {
      await rollbackQuietly(conn);
      result = errResult(err);
      detail = err.message;
    }
    log({ t: Date.now() - t0, client: conn.name, loginRole: p.session_user, pid: p.pid, ro: p.default_ro, step: label, result, detail });
    return p.pid;
  };

  const pids = [];
  const poisoned = [];
  const main = await connect(path, 'Migration');
  try {
    pids.push(await step(main, 'Schema change: ALTER TABLE learners ADD COLUMN nickname; CREATE INDEX on email', [
      'alter table realistic_test.learners add column if not exists nickname text',
      'create index if not exists learners_email_idx on realistic_test.learners (email)',
    ]));
    pids.push(await step(main, 'Backfill: UPDATE learners SET nickname', [
      `update realistic_test.learners set nickname = split_part(name, ' ', 1) where nickname is null`,
    ]));
  } finally {
    await safeEnd(main);
  }

  // The risky habit from the incident: a "safe" verification phase that switches the
  // SESSION to read-only (no LOCAL). Three parallel checkers, like a script with a small pool.
  const checkers = await Promise.all([1, 2, 3].map((i) => connect(path, `Migration check #${i}`)));
  try {
    await Promise.all(checkers.map(async (c) => {
      await c.client.query('begin');
      await c.client.query('set default_transaction_read_only = on');
      const p = (await c.client.query(PROBE_SQL)).rows[0];
      await c.client.query('select count(*) from realistic_test.learners where nickname is null');
      await c.client.query('select pg_sleep(0.3)');
      await c.client.query('commit');
      pids.push(p.pid);
      poisoned.push(p.pid);
      log({ t: Date.now() - t0, client: c.name, loginRole: p.session_user, pid: p.pid, ro: p.default_ro,
        step: 'Verification: SET default_transaction_read_only = on (session level), check query, COMMIT, disconnect', result: 'SETTING APPLIED' });
    }));
  } finally {
    for (const c of checkers) await safeEnd(c);
  }
  return { pids: uniq(pids), poisoned: uniq(poisoned), poisonAt: Date.now() - t0 };
}

// ---------- counting from the tables ----------

async function savedByService(runId) {
  const r = lit(runId);
  return adminQuery(`
    select 'app' as service, 'learners' as table_name, count(*)::int as saved,
           coalesce(string_agg(distinct login_role, ', '), '') as login_roles, count(distinct backend_pid)::int as backends
      from realistic_test.learners where run_id = ${r}
    union all
    select 'assessment', 'submissions', count(*)::int, coalesce(string_agg(distinct login_role, ', '), ''), count(distinct backend_pid)::int
      from realistic_test.submissions where run_id = ${r}
    union all
    select 'hub', 'hub_events', count(*)::int, coalesce(string_agg(distinct login_role, ', '), ''), count(distinct backend_pid)::int
      from realistic_test.hub_events where run_id = ${r};`);
}

export function realisticViewSql(runId) {
  return `select 'learners (app)' as written_by, count(*) as rows_saved from realistic_test.learners where run_id = '${runId}'
union all select 'submissions (assessment)', count(*) from realistic_test.submissions where run_id = '${runId}'
union all select 'hub_events (hub)', count(*) from realistic_test.hub_events where run_id = '${runId}';`;
}

// ---------- the experiment ----------

export async function realistic({ migrationLogin = 'shared', migrationMode = 'transaction', durationMs = 30000, migrationAtMs = 6000, workersPerService = 2 } = {}) {
  const separate = migrationLogin === 'migrator';
  const migPath = !separate ? PATHS.sharedTx : migrationMode === 'session' ? PATHS.migratorSession : PATHS.migratorTx;
  const scenario = !separate ? 'R1-shared-login' : `R2-own-login-${migrationMode === 'session' ? 'session' : 'tx'}`;
  const runId = `${scenario}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

  const events = [];
  events.push(await recycleStep(REALISTIC_ROLES, 'start from clean backends'));

  const records = [];
  const migrationLog = [];
  const t0 = Date.now();
  const until = t0 + durationMs;
  const workers = [];
  for (const service of Object.keys(SERVICES)) {
    for (let n = 1; n <= workersPerService; n++) workers.push(serviceWorker(service, n, runId, t0, until, records));
  }
  const migration = (async () => {
    await sleep(migrationAtMs);
    migrationLog.push({ t: Date.now() - t0, client: 'Migration', step: `Migration starts (${migPath.label})`, result: 'INFO' });
    return runMigration(migPath, t0, (e) => migrationLog.push(e));
  })();
  const [mig] = await Promise.all([migration, ...workers]);

  events.push(snapshotEvent(await snapshotTestBackends(), 'end of run, before recycle: which login owns each backend'));
  events.push(await recycleStep(REALISTIC_ROLES, 'remove any read-only backends'));

  const saved = await savedByService(runId);
  const [col] = await adminQuery(`select count(*)::int as n from information_schema.columns
    where table_schema = 'realistic_test' and table_name = 'learners' and column_name = 'nickname';`);

  const services = Object.keys(SERVICES).map((service) => {
    const mine = records.filter((r) => r.service === service);
    const db = saved.find((s) => s.service === service) ?? { saved: 0 };
    return {
      service,
      table: db.table_name,
      attempted: mine.length,
      ok: mine.filter((r) => r.result === 'OK').length,
      rejected25006: mine.filter((r) => r.result === 'ERROR 25006').length,
      otherErrors: mine.filter((r) => r.result !== 'OK' && r.result !== 'ERROR 25006').length,
      savedInTable: db.saved,
      loginRolesInTable: db.login_roles,
      pids: uniq(mine.map((r) => r.pid)),
    };
  });

  const servicePids = uniq(records.map((r) => r.pid));
  const sharedWithMigration = servicePids.filter((p) => mig.pids.includes(p));
  const rejected = records.filter((r) => r.result === 'ERROR 25006');
  const otherErrors = records.filter((r) => r.result !== 'OK' && r.result !== 'ERROR 25006');
  const totalAttempted = records.length;
  const totalSaved = services.reduce((a, s) => a + s.savedInTable, 0);
  const totalOk = services.reduce((a, s) => a + s.ok, 0);
  const firstFailure = rejected.length ? Math.min(...rejected.map((r) => r.t)) : null;

  let verdict;
  let headline;
  if (rejected.length) {
    verdict = 'BLOCKED';
    headline = `${rejected.length} of ${totalAttempted} service writes were rejected with 25006 after the migration's read-only check (first at ${(firstFailure / 1000).toFixed(1)}s). They all ran on backend(s) ${uniq(rejected.map((r) => r.pid)).join(', ')}, which the migration had made read-only.`;
  } else if (!separate) {
    verdict = 'INCONCLUSIVE';
    headline = `No service landed on a poisoned backend this run (${totalAttempted} writes). That does not mean it can't happen.`;
  } else if (otherErrors.length || totalSaved !== totalOk || sharedWithMigration.length) {
    verdict = 'INCONCLUSIVE';
    headline = `No 25006, but something else is off: ${otherErrors.length} other errors, ${totalSaved} saved vs ${totalOk} OK, ${sharedWithMigration.length} shared PIDs.`;
  } else {
    verdict = 'NOT BLOCKED';
    headline = `All ${totalAttempted} service writes succeeded (${totalSaved} rows in the tables) while the migration on its own login applied its schema change and set read-only on its own backends ${mig.poisoned.join(', ')}. Services and migration never shared a backend.`;
  }

  return {
    id: `realistic-${separate ? 'own' : 'shared'}`,
    title: separate
      ? `Realistic run 2 · migration on its own login (${migPath.label})`
      : 'Realistic run 1 · everything on one shared login (the incident setup)',
    verdict,
    headline,
    runId,
    durationMs,
    migrationAt: migrationAtMs,
    poisonAt: mig.poisonAt,
    migrationPath: migPath.label,
    servicePath: PATHS.sharedTx.label,
    migrationLog,
    services,
    records: records.sort((a, b) => a.t - b.t),
    events,
    evidence: {
      runId,
      rowsSavedInTable: totalSaved,
      serviceWritesAttempted: totalAttempted,
      serviceWritesRejected25006: rejected.length,
      otherErrors: otherErrors.length,
      migrationPids: mig.pids,
      migrationReadOnlyPids: mig.poisoned,
      servicePids,
      sharedPids: sharedWithMigration,
      migrationColumnApplied: col.n === 1,
      viewSql: realisticViewSql(runId),
    },
    proves: separate
      ? [
        'The migration really ran: its schema change and backfill succeeded, and its own backends became read-only.',
        'The services, still on the shared login, kept writing the whole time; every successful write is a row in the tables.',
        'Because the migration logged in as a different role, Supavisor never gave its backends to the services (no shared PID), even though the migration login owns the tables and the shared login is a member of it.',
      ]
      : [
        'With one shared login, the migration and the services draw from the same transaction pool.',
        'The migration\'s session-level read-only setting stayed on its pooled backends after it disconnected, and services that were handed those backends failed with 25006; the tables are missing exactly those rows.',
      ],
    notProven: [
      'Production timing and pool size: the share of failed writes depends on how many backends the pool has and how busy it is.',
      'Settings attached to a role or database (ALTER ROLE / ALTER DATABASE … SET) reach every connection, whichever login runs the migration.',
    ],
  };
}

export const REALISTIC = {
  realisticSetup: () => setupRealistic(),
  realisticShared: (o) => realistic({ ...o, migrationLogin: 'shared' }),
  realisticOwnTx: (o) => realistic({ ...o, migrationLogin: 'migrator', migrationMode: 'transaction' }),
  realisticOwnSession: (o) => realistic({ ...o, migrationLogin: 'migrator', migrationMode: 'session' }),
};
