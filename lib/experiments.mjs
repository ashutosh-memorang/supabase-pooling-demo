// The five tests. Each returns { id, title, verdict, headline, events, evidence, proves, notProven }.
// verdict is one of: PASS, FAIL, BLOCKED, NOT BLOCKED, INCONCLUSIVE.
import { PATHS } from './config.mjs';
import { connect, event, errResult, lit, PROBE_SQL, rollbackQuietly, safeEnd, sleep } from './db.mjs';
import { adminQuery, recycleBackends, snapshotTestBackends } from './admin.mjs';

const READ_ONLY_VIOLATION = 'ERROR 25006';

// ---------- building blocks ----------

async function probe(conn) {
  return (await conn.client.query(PROBE_SQL)).rows[0];
}

// One application write, inside an explicit transaction so the probe and the
// INSERT are guaranteed to run on the same server backend.
async function appWrite(conn, label, run) {
  let p;
  try {
    await conn.client.query('begin');
    p = await probe(conn);
    await conn.client.query(`insert into pool_test.events (source, note, experiment, run_id)
      values (${lit(conn.name)}, ${lit(label)}, ${lit(run.experiment)}, ${lit(run.id)})`);
    await conn.client.query('commit');
    return event(conn, `write #${label}`, p, 'OK', 'INSERT committed');
  } catch (err) {
    await rollbackQuietly(conn);
    return event(conn, `write #${label}`, p, errResult(err), err.message);
  }
}

// The incident pattern: a session-level SET inside a transaction that commits.
// After COMMIT the setting stays on that server backend, whoever uses it next.
async function sessionSetReadOnly(conn, holdMs) {
  await conn.client.query('begin');
  await conn.client.query('set default_transaction_read_only = on');
  const p = await probe(conn);
  if (holdMs) await conn.client.query(`select pg_sleep(${holdMs / 1000})`);
  await conn.client.query('commit');
  return event(conn, 'SET default_transaction_read_only = on (session level), COMMIT', p, 'SETTING APPLIED',
    `Backend ${p.pid} now has default_transaction_read_only=${p.default_ro} for the rest of its life.`);
}

async function openClients(path, prefix, n) {
  return Promise.all(Array.from({ length: n }, (_, i) => connect(path, n === 1 ? prefix : `${prefix} #${i + 1}`)));
}

export async function recycleStep(roles, why) {
  const { terminated, remaining } = await recycleBackends(roles);
  return {
    at: new Date().toISOString(),
    client: 'Admin (Management API)',
    path: 'supabase db query --linked',
    mode: 'admin',
    loginRole: 'postgres',
    pid: null,
    step: `Recycle ${roles.join(', ')} backends — ${why}`,
    result: remaining.length ? 'WARNING' : 'OK',
    detail: `Terminated PIDs: ${terminated.map((t) => t.pid).join(', ') || 'none'}${remaining.length ? `; still present: ${remaining.map((r) => r.pid).join(', ')}` : ''}`,
  };
}

export function snapshotEvent(rows, why) {
  return {
    at: new Date().toISOString(),
    client: 'Admin (Management API)',
    path: 'pg_stat_activity',
    mode: 'admin',
    loginRole: 'postgres',
    pid: null,
    step: `Server-side snapshot — ${why}`,
    result: 'INFO',
    detail: rows.map((r) => `${r.pid}=${r.usename}`).join(', ') || 'no test-role backends',
  };
}

const uniq = (xs) => [...new Set(xs.filter((x) => x != null))];

function newRun(experiment) {
  return { experiment, id: `${experiment}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}` };
}

// Independent check: ask the database how many of this run's writes were actually saved.
// A write rejected with 25006 leaves no row, so this count cannot be faked by the client.
export function viewRowsSql(run) {
  return `select id, created_at, experiment, run_id, login_role, backend_pid, source, note
from pool_test.events where run_id = '${run.id}' order by id;`;
}

async function savedRows(run, attempts, { excludeNote } = {}) {
  const [row] = await adminQuery(`
    select count(*)::int as saved, coalesce(string_agg(distinct backend_pid::text, ', '), '') as pids,
           coalesce(string_agg(distinct login_role, ', '), '') as roles
    from pool_test.events
    where run_id = ${lit(run.id)}${excludeNote ? ` and note <> ${lit(excludeNote)}` : ''};`);
  return {
    saved: row.saved,
    event: {
      at: new Date().toISOString(), client: 'Admin (Management API)', path: 'pool_test.events', mode: 'admin', loginRole: 'postgres', pid: null,
      step: `Rows actually saved in pool_test.events for run ${run.id}`,
      result: `${row.saved} of ${attempts} saved`,
      detail: row.saved ? `written by ${row.roles} on backend PID(s) ${row.pids}` : 'no rows: every write was rejected',
    },
  };
}

// ---------- Test 1: baseline ----------

export async function baseline() {
  const run = newRun('baseline');
  const events = [];
  const checks = [];
  for (const key of ['appTx', 'deliveryTx', 'deliverySession']) {
    const path = PATHS[key];
    const conn = await connect(path, `Baseline ${path.role} (${path.mode})`);
    try {
      const p = await probe(conn);
      const okRole = p.session_user === path.role && p.current_user === path.role;
      checks.push(okRole);
      events.push(event(conn, `Connected to ${conn.endpoint}`, p, okRole ? 'OK' : 'FAIL',
        `session_user=${p.session_user}, current_user=${p.current_user}, default_transaction_read_only=${p.default_ro}`));
      if (key === 'appTx') {
        const w = await appWrite(conn, 'baseline', run);
        checks.push(w.result === 'OK');
        events.push(w);
      } else {
        const r = await conn.client.query('select count(*)::int as n from pool_test.events');
        events.push(event(conn, 'SELECT count(*) from pool_test.events', p, 'OK', `${r.rows[0].n} rows visible`));
      }
    } finally {
      await safeEnd(conn);
    }
  }
  const pass = checks.every(Boolean);
  return {
    id: 'baseline',
    title: 'Test 1 · Baseline',
    verdict: pass ? 'PASS' : 'FAIL',
    headline: pass
      ? 'Every client authenticated as its intended role through Supavisor, and test_app can insert.'
      : 'A baseline check failed — see the events.',
    events,
    proves: ['Login roles, endpoints and pool modes are as recorded.', 'test_app has INSERT on pool_test.events.'],
    notProven: [],
  };
}

// ---------- Test 2 / Experiment A: same role, same transaction pool ----------

export async function samePool({ poisonConnections = 1, attempts = 20 } = {}) {
  const run = newRun('A-same-pool');
  const events = [];
  events.push(await recycleStep(['test_app'], 'start from clean backends'));

  // Client A = the ad-hoc script, logged in as the SAME role as the app.
  const scriptConns = await openClients(PATHS.appTx, 'Client A (ad-hoc script, test_app)', poisonConnections);
  const poisonEvents = await Promise.all(scriptConns.map((c) => sessionSetReadOnly(c, poisonConnections > 1 ? 400 : 0)));
  events.push(...poisonEvents);
  const poisoned = uniq(poisonEvents.map((e) => e.pid));
  for (const c of scriptConns) await safeEnd(c);
  const afterDisconnect = snapshotEvent(await snapshotTestBackends(), 'Client A has disconnected; are its backends still alive?');
  afterDisconnect.detail += ` (poisoned: ${poisoned.join(', ')})`;
  events.push(afterDisconnect);

  // Client B = the application, separate client connection, same role + pool.
  const app = await connect(PATHS.appTx, 'Client B (application, test_app)');
  const writes = [];
  try {
    for (let i = 1; i <= attempts; i++) {
      const e = await appWrite(app, i, run);
      e.onPoisonedBackend = poisoned.includes(e.pid);
      writes.push(e);
      events.push(e);
      await sleep(100);
    }
  } finally {
    await safeEnd(app);
  }

  const hits = writes.filter((w) => w.onPoisonedBackend);
  const rejected = writes.filter((w) => w.result === READ_ONLY_VIOLATION);
  const rejectedOnPoisoned = rejected.filter((w) => w.onPoisonedBackend);

  // Clean up: closing clients does not reset a pooled backend, so terminate them.
  events.push(await recycleStep(['test_app'], 'remove the poisoned backends'));
  const after = await connect(PATHS.appTx, 'Client B after recycle');
  try {
    events.push(await appWrite(after, 'post-recycle', run));
  } finally {
    await safeEnd(after);
  }
  const db = await savedRows(run, attempts, { excludeNote: 'post-recycle' });
  events.push(db.event);

  let verdict;
  let headline;
  if (rejectedOnPoisoned.length) {
    verdict = 'BLOCKED';
    headline = `${rejected.length}/${attempts} application writes were rejected with 25006 and the table holds ${db.saved} rows for this run. Every rejected write ran on backend ${uniq(rejectedOnPoisoned.map((r) => r.pid)).join(', ')}, which Client A had set read-only.`;
  } else if (rejected.length) {
    verdict = 'BLOCKED';
    headline = `${rejected.length}/${attempts} writes rejected with 25006, but not on a backend Client A was seen to poison — investigate.`;
  } else if (!hits.length) {
    verdict = 'INCONCLUSIVE';
    headline = `Client B never landed on a poisoned backend in ${attempts} attempts. This does NOT show leakage is impossible.`;
  } else {
    verdict = 'NOT BLOCKED';
    headline = `Client B reused poisoned backend(s) ${uniq(hits.map((h) => h.pid)).join(', ')} but writes succeeded — the pooler may now reset session state.`;
  }

  return {
    id: 'same-pool',
    title: 'Experiment A · Same role, same transaction pool (incident reproduction)',
    verdict,
    headline,
    events,
    evidence: {
      poisonedPids: poisoned,
      appPids: uniq(writes.map((w) => w.pid)),
      attempts,
      okWrites: writes.filter((w) => w.result === 'OK').length,
      rejectedWrites: rejected.length,
      writesOnPoisonedBackend: hits.length,
      rowsSavedInTable: db.saved,
      runId: run.id,
      viewSql: viewRowsSql(run),
    },
    proves: [
      'A session-level SET committed by one client stays on the pooled Supavisor backend after that client disconnects.',
      'A different client using the same role and transaction pool can be given that backend and inherits the setting.',
    ],
    notProven: ['How often this happens under real production concurrency and pool size.'],
  };
}

// ---------- Test 3 / Experiment B: separate role (and separate pool) for Delivery ----------

export async function separateRole({ attempts = 30, deliveryPoisonConnections = 3 } = {}) {
  const run = newRun('B-separate-role');
  const events = [];
  events.push(await recycleStep(['test_app', 'test_delivery'], 'start from clean backends'));

  // Delivery path 1: its own transaction pool (role test_delivery).
  const delTx = await openClients(PATHS.deliveryTx, 'Delivery (test_delivery, tx pool)', deliveryPoisonConnections);
  const delTxEvents = await Promise.all(delTx.map((c) => sessionSetReadOnly(c, 400)));
  events.push(...delTxEvents);
  for (const c of delTx) await safeEnd(c);

  // Delivery path 2: session pooler (the closest IPv4 equivalent to a direct connection).
  // Plain session SET with no transaction, held open while the app writes.
  const delSession = await connect(PATHS.deliverySession, 'Delivery (test_delivery, session pool)');
  let app;
  const writes = [];
  let duringSnapshot = [];
  try {
    await delSession.client.query('set default_transaction_read_only = on');
    const p = await probe(delSession);
    events.push(event(delSession, 'SET default_transaction_read_only = on (session level, held open)', p, 'SETTING APPLIED',
      `Delivery's own session is now read-only (default_transaction_read_only=${p.default_ro}).`));
    try {
      await delSession.client.query(`insert into pool_test.events (source) values ('delivery')`);
      events.push(event(delSession, "Delivery's own INSERT", p, 'OK', 'unexpected'));
    } catch (err) {
      events.push(event(delSession, "Delivery's own INSERT (expected to be rejected)", p, errResult(err), err.message));
    }

    app = await connect(PATHS.appTx, 'App (test_app, tx pool)');
    for (let i = 1; i <= attempts; i++) {
      writes.push(await appWrite(app, i, run));
      events.push(writes.at(-1));
      if (i === Math.ceil(attempts / 2)) {
        duringSnapshot = await snapshotTestBackends();
        events.push(snapshotEvent(duringSnapshot, 'while Delivery is read-only and the app is writing'));
      }
      await sleep(100);
    }
  } finally {
    await safeEnd(app);
    await safeEnd(delSession);
  }
  events.push(await recycleStep(['test_app', 'test_delivery'], 'tidy up'));
  const db = await savedRows(run, attempts);
  events.push(db.event);

  const deliveryPids = uniq([
    ...delTxEvents.map((e) => e.pid),
    ...events.filter((e) => e.client?.startsWith('Delivery')).map((e) => e.pid),
    ...duringSnapshot.filter((r) => r.usename === 'test_delivery').map((r) => r.pid),
  ]);
  const appPids = uniq(writes.map((w) => w.pid));
  const overlap = appPids.filter((p) => deliveryPids.includes(p));
  const rejected = writes.filter((w) => w.result !== 'OK');
  const appSawReadOnly = writes.filter((w) => w.defaultReadOnly === 'on');
  const snapshotRoles = Object.fromEntries(duringSnapshot.map((r) => [r.pid, r.usename]));
  const appPidsServerRole = uniq(appPids.map((p) => snapshotRoles[p]).filter(Boolean));

  let verdict;
  let headline;
  if (rejected.some((w) => w.result === READ_ONLY_VIOLATION) || appSawReadOnly.length) {
    verdict = 'BLOCKED';
    headline = `Isolation FAILED: ${rejected.length} app writes rejected / ${appSawReadOnly.length} saw read-only.`;
  } else if (rejected.length) {
    verdict = 'INCONCLUSIVE';
    headline = `${rejected.length} app writes failed for a reason other than read-only — see events.`;
  } else if (overlap.length) {
    verdict = 'INCONCLUSIVE';
    headline = 'App and Delivery shared a backend PID — the separation assumption does not hold.';
  } else if (db.saved !== attempts) {
    verdict = 'INCONCLUSIVE';
    headline = `The client saw ${attempts} successful writes but the table holds ${db.saved} rows for this run — investigate.`;
  } else {
    verdict = 'NOT BLOCKED';
    headline = `All ${attempts}/${attempts} app writes succeeded and ${db.saved} rows are in the table, while Delivery's backends were read-only. App backends (${appPids.join(', ')}) and Delivery backends (${deliveryPids.join(', ')}) never overlapped.`;
  }

  return {
    id: 'separate-role',
    title: 'Experiment B · Delivery uses its own role (and therefore its own pools)',
    verdict,
    headline,
    events,
    evidence: {
      deliveryPids,
      appPids,
      overlap,
      appBackendsServerRole: appPidsServerRole,
      attempts,
      okWrites: writes.length - rejected.length,
      rejectedWrites: rejected.length,
      rowsSavedInTable: db.saved,
      runId: run.id,
      viewSql: viewRowsSql(run),
    },
    proves: [
      'Supavisor gave test_app and test_delivery disjoint server backends (no shared PID; server reports each PID under its own role).',
      "A Postgres backend is logged in as exactly one role for its whole life, so a test_delivery backend cannot be handed to a test_app client.",
      `${attempts} app writes in this run were unaffected by Delivery's session-level read-only setting on both Delivery paths.`,
    ],
    notProven: [
      'That nothing else can make app connections read-only: ALTER ROLE test_app SET …, ALTER DATABASE … SET …, or Delivery using the app login would all bypass this separation.',
      'Behaviour on the direct connection (db.<ref>.supabase.co is IPv6-only and was not reachable here) and on the dedicated PgBouncer pooler.',
      'Future Supavisor versions or a different pool config (staging/production).',
    ],
  };
}

// ---------- Test 5 / Experiment C: transaction-scoped read-only on the SAME pool ----------

export async function safePattern({ attempts = 20 } = {}) {
  const run = newRun('C-safe-pattern');
  const events = [];
  events.push(await recycleStep(['test_app'], 'start from clean backends'));

  const script = await connect(PATHS.appTx, 'Client A (script, test_app, BEGIN READ ONLY)');
  const scriptPids = [];
  try {
    // Pattern 1: BEGIN READ ONLY — applies to this one transaction only.
    await script.client.query('begin read only');
    let p = await probe(script);
    scriptPids.push(p.pid);
    try {
      await script.client.query(`insert into pool_test.events (source) values ('script')`);
      events.push(event(script, 'BEGIN READ ONLY; INSERT', p, 'OK', 'unexpected'));
    } catch (err) {
      events.push(event(script, 'BEGIN READ ONLY; INSERT (rejected as intended)', p, errResult(err),
        `transaction_read_only=${p.txn_ro} inside the transaction; default_transaction_read_only=${p.default_ro}`));
    }
    await rollbackQuietly(script);

    // Pattern 2: SET LOCAL — reverts at COMMIT.
    await script.client.query('begin');
    await script.client.query('set local default_transaction_read_only = on');
    p = await probe(script);
    scriptPids.push(p.pid);
    await script.client.query('commit');
    events.push(event(script, 'BEGIN; SET LOCAL default_transaction_read_only = on; COMMIT', p, 'SETTING APPLIED (transaction only)',
      `inside: default_transaction_read_only=${p.default_ro}`));

    // Same backend after the transaction ends?
    await script.client.query('begin');
    p = await probe(script);
    await script.client.query('commit');
    events.push(event(script, 'Next transaction from the script', p, 'INFO',
      `default_transaction_read_only=${p.default_ro} — the transaction-scoped setting is gone`));
  } finally {
    await safeEnd(script);
  }

  const app = await connect(PATHS.appTx, 'Client B (application, test_app)');
  const writes = [];
  try {
    for (let i = 1; i <= attempts; i++) {
      const e = await appWrite(app, i, run);
      e.onScriptBackend = scriptPids.includes(e.pid);
      writes.push(e);
      events.push(e);
      await sleep(100);
    }
  } finally {
    await safeEnd(app);
  }

  const db = await savedRows(run, attempts);
  events.push(db.event);
  const rejected = writes.filter((w) => w.result !== 'OK');
  const reused = writes.filter((w) => w.onScriptBackend);
  const verdict = rejected.length ? 'BLOCKED' : 'NOT BLOCKED';
  return {
    id: 'safe-pattern',
    title: 'Experiment C · Same pool, but the script uses BEGIN READ ONLY / SET LOCAL',
    verdict,
    headline: rejected.length
      ? `${rejected.length} app writes rejected — transaction-scoped settings leaked?`
      : `All ${attempts}/${attempts} app writes succeeded on the same pool${reused.length ? `, including ${reused.length} on backend ${uniq(reused.map((r) => r.pid)).join(', ')} that the script had just used` : ' (the app did not land on the script\'s backend this run)'}.`,
    events,
    evidence: {
      scriptPids: uniq(scriptPids),
      appPids: uniq(writes.map((w) => w.pid)),
      writesOnScriptBackend: reused.length,
      rejectedWrites: rejected.length,
      rowsSavedInTable: db.saved,
      runId: run.id,
      viewSql: viewRowsSql(run),
    },
    proves: [
      'BEGIN READ ONLY blocks writes inside that transaction only.',
      'SET LOCAL reverts at COMMIT, so the next transaction on the same backend is read-write.',
    ],
    notProven: ['Tools that cannot be told to use BEGIN READ ONLY (some GUI clients issue session-level SETs themselves).'],
  };
}

// ---------- Test 4: permissions ----------

const PERMISSION_CHECKS = [
  ['humanSession', 'Human read-only can SELECT', 'select count(*) from pool_test.events', 'allowed'],
  ['humanSession', 'Human read-only cannot INSERT', "insert into pool_test.events (source) values ('human')", 'denied'],
  ['humanSession', 'Human read-only cannot UPDATE', "update pool_test.events set note = 'x' where false", 'denied'],
  ['humanSession', 'Human read-only cannot DELETE', 'delete from pool_test.events where false', 'denied'],
  ['deliverySession', 'Delivery cannot INSERT', "insert into pool_test.events (source) values ('delivery')", 'denied'],
  ['deliverySession', 'Delivery cannot SET ROLE test_app', 'set role test_app', 'denied'],
  ['deliverySession', 'Delivery cannot SET SESSION AUTHORIZATION test_app', 'set session authorization test_app', 'denied'],
  ['deliverySession', 'Delivery is not a member of test_app', "do $$ begin if pg_has_role('test_delivery', 'test_app', 'member') then raise exception 'test_delivery IS a member of test_app'; end if; end $$", 'allowed'],
  ['appTx', 'App cannot UPDATE (append-only)', "update pool_test.events set note = 'x' where false", 'denied'],
  ['appTx', 'App cannot DELETE (append-only)', 'delete from pool_test.events where false', 'denied'],
  ['maintSession', 'Maintenance can SELECT', 'select count(*) from pool_test.events', 'allowed'],
  ['maintSession', 'Maintenance can DELETE test rows (0 rows targeted)', "delete from pool_test.events where source = '__none__'", 'allowed'],
  ['maintSession', 'Maintenance cannot INSERT', "insert into pool_test.events (source) values ('maint')", 'denied'],
  ['maintSession', 'Maintenance cannot CREATE TABLE in pool_test', 'create table pool_test.maint_probe (id int)', 'denied'],
  ['maintSession', 'Maintenance cannot CREATE ROLE', 'create role maint_probe_role', 'denied'],
  ['maintSession', 'Maintenance cannot read auth.users', 'select count(*) from auth.users', 'denied'],
  ['maintSession', 'Maintenance cannot SET ROLE test_app', 'set role test_app', 'denied'],
];

export async function permissions() {
  const events = [];
  const conns = {};
  let allMatch = true;
  try {
    for (const [pathKey, label, sql, expect] of PERMISSION_CHECKS) {
      conns[pathKey] ??= await connect(PATHS[pathKey], `${PATHS[pathKey].role}`);
      const conn = conns[pathKey];
      let p;
      let outcome;
      let detail;
      try {
        // Every check runs inside a transaction that is always rolled back: nothing persists.
        await conn.client.query('begin');
        p = await probe(conn);
        const r = await conn.client.query(sql);
        outcome = 'allowed';
        detail = `${r.command} ${r.rowCount ?? ''}`.trim();
      } catch (err) {
        outcome = err.code === '42501' ? 'denied' : `error ${err.code}`;
        detail = err.message;
      } finally {
        await rollbackQuietly(conn);
      }
      const ok = outcome === expect;
      allMatch &&= ok;
      events.push(event(conn, `${label}  [expect ${expect}]`, p, ok ? `PASS (${outcome})` : `FAIL (${outcome})`, `${sql}  →  ${detail}`));
    }
  } finally {
    for (const c of Object.values(conns)) await safeEnd(c);
  }

  const memberships = await adminQuery(`
    select m.rolname as member, r.rolname as member_of
    from pg_auth_members am join pg_roles m on m.oid = am.member join pg_roles r on r.oid = am.roleid
    where m.rolname like 'test\\_%' order by 1, 2;`);
  events.push({
    at: new Date().toISOString(), client: 'Admin (Management API)', path: 'pg_auth_members', mode: 'admin', loginRole: 'postgres', pid: null,
    step: 'Role memberships held by test_* roles [expect none]',
    result: memberships.length ? 'FAIL' : 'PASS',
    detail: memberships.map((m) => `${m.member}→${m.member_of}`).join(', ') || 'none',
  });
  allMatch &&= memberships.length === 0;

  return {
    id: 'permissions',
    title: 'Test 4 · Permission checks',
    verdict: allMatch ? 'PASS' : 'FAIL',
    headline: allMatch ? 'Every allowed action worked and every forbidden action was denied (42501).' : 'At least one permission check did not match expectations.',
    events,
    proves: ['The synthetic roles behave as designed on this disposable project.'],
    notProven: [
      'These four roles are a test fixture, NOT a production least-privilege policy: real roles also need RLS review, function/sequence grants, default privileges, connection limits, statement timeouts and password/rotation policy.',
    ],
  };
}

export const EXPERIMENTS = { baseline, samePool, separateRole, safePattern, permissions };
