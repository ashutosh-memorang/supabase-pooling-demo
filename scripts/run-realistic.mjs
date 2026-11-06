// Runs the realistic scenario: Run 1 (shared login) then Run 2 (own login, tx and session pooler).
// Writes results/realistic-report.md. Run 1 is probabilistic, so it is attempted up to 3 times
// and every attempt is reported (an INCONCLUSIVE attempt is never hidden).
import { mkdirSync, writeFileSync } from 'node:fs';
import { PROJECT_REF } from '../lib/config.mjs';
import { REALISTIC, setupRealistic } from '../lib/realistic.mjs';

console.log(`Target: disposable project ${PROJECT_REF}`);
console.log((await setupRealistic()).headline);

const results = [];
for (let attempt = 1; attempt <= 3; attempt++) {
  process.stdout.write(`Run 1 (shared login), attempt ${attempt} … `);
  const r = await REALISTIC.realisticShared({});
  console.log(r.verdict);
  results.push({ ...r, title: `${r.title} — attempt ${attempt}` });
  if (r.verdict === 'BLOCKED') break;
}
for (const [name, label] of [['realisticOwnTx', 'transaction pooler'], ['realisticOwnSession', 'session pooler']]) {
  process.stdout.write(`Run 2 (own login, ${label}) … `);
  const r = await REALISTIC[name]({});
  console.log(r.verdict);
  results.push(r);
}

const stamp = new Date().toISOString();
mkdirSync('results', { recursive: true });
writeFileSync(`results/realistic-${stamp.replaceAll(':', '-')}.json`, JSON.stringify({ stamp, projectRef: PROJECT_REF, results }, null, 2));

const md = [
  `# Realistic run report — ${stamp}`,
  '',
  `Disposable project \`${PROJECT_REF}\`, real hosted Supavisor. Services: app, hub, assessment (2 connections each) on`,
  '`test_shared` via the transaction pooler for 30 s; migration starts at 6 s.',
  '',
  '| Run | Verdict | Attempted | Saved in tables | Rejected 25006 | Shared PIDs | Migration read-only PIDs |',
  '|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.title} | **${r.verdict}** | ${r.evidence.serviceWritesAttempted} | ${r.evidence.rowsSavedInTable} | ${r.evidence.serviceWritesRejected25006} | ${r.evidence.sharedPids.join(', ') || 'none'} | ${r.evidence.migrationReadOnlyPids.join(', ')} |`),
  '',
  ...results.flatMap((r) => [
    `## ${r.title} — ${r.verdict}`,
    '',
    r.headline,
    '',
    `Run id \`${r.runId}\`. Migration path: ${r.migrationPath}.`,
    '',
    '| Service | Table | Attempted | Saved in table | Rejected 25006 | Other errors | Login in rows |',
    '|---|---|---|---|---|---|---|',
    ...r.services.map((s) => `| ${s.service} | ${s.table} | ${s.attempted} | ${s.savedInTable} | ${s.rejected25006} | ${s.otherErrors} | ${s.loginRolesInTable} |`),
    '',
    '| At | Client | Login | PID | default_ro | Migration step | Result |',
    '|---|---|---|---|---|---|---|',
    ...r.migrationLog.map((m) => `| ${(m.t / 1000).toFixed(1)}s | ${m.client} | ${m.loginRole ?? ''} | ${m.pid ?? ''} | ${m.ro ?? ''} | ${m.step} | ${m.result} |`),
    '',
    ...r.events.filter((e) => /snapshot/i.test(e.step)).map((e) => `Server view at end of run (PID=login): ${e.detail}`),
    '',
    'Check in Supabase SQL Editor:',
    '```sql',
    r.evidence.viewSql,
    '```',
    '',
  ]),
].join('\n');
writeFileSync('results/realistic-report.md', md);
console.log('\nWrote results/realistic-report.md');
process.exit(0);
