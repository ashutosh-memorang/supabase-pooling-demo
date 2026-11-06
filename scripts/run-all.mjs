// Runs every test in order and writes results/latest-report.md (+ raw JSON).
import { mkdirSync, writeFileSync } from 'node:fs';
import { PATHS, PROJECT_REF, describeEndpoint } from '../lib/config.mjs';
import { EXPERIMENTS } from '../lib/experiments.mjs';
import { setup } from './setup.mjs';

const order = [
  ['baseline', {}],
  ['samePool', { poisonConnections: 1, attempts: 20 }],
  ['separateRole', { attempts: 30 }],
  ['safePattern', { attempts: 20 }],
  ['permissions', {}],
];

console.log(`Target: disposable project ${PROJECT_REF}`);
await setup();

const results = [];
for (const [name, opts] of order) {
  process.stdout.write(`Running ${name} … `);
  let r;
  try {
    r = await EXPERIMENTS[name](opts);
    // Experiment A is probabilistic: retry once with every backend poisoned before calling it inconclusive.
    if (name === 'samePool' && r.verdict === 'INCONCLUSIVE') {
      console.log('INCONCLUSIVE, retrying with 8 poisoned backends');
      r = await EXPERIMENTS.samePool({ poisonConnections: 8, attempts: 30 });
    }
  } catch (err) {
    r = { id: name, title: name, verdict: 'ERROR', headline: err.message, events: [], proves: [], notProven: [] };
  }
  console.log(r.verdict);
  results.push(r);
}

const stamp = new Date().toISOString();
mkdirSync('results', { recursive: true });
writeFileSync(`results/run-${stamp.replaceAll(':', '-')}.json`, JSON.stringify({ stamp, projectRef: PROJECT_REF, results }, null, 2));

const md = [
  `# Run report — ${stamp}`,
  '',
  `Target: disposable Supabase project \`${PROJECT_REF}\` via the shared **Supavisor** pooler (real Supavisor, hosted).`,
  '',
  '| Path | Endpoint |',
  '|---|---|',
  ...Object.values(PATHS).map((p) => `| ${p.label} | \`${describeEndpoint(p)}\` |`),
  '',
  '| Test | Verdict | Summary |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.title} | **${r.verdict}** | ${r.headline} |`),
  '',
  ...results.flatMap((r) => [
    `## ${r.title} — ${r.verdict}`,
    '',
    r.headline,
    '',
    r.evidence ? '```json\n' + JSON.stringify(r.evidence, null, 2) + '\n```\n' : '',
    '| Time (UTC) | Client | Login role | Mode | Backend PID | default_ro | Step | Result |',
    '|---|---|---|---|---|---|---|---|',
    ...r.events.map((e) => `| ${e.dbTime ?? e.at.slice(11, 23)} | ${e.client} | ${e.loginRole ?? ''} | ${e.mode} | ${e.pid ?? ''} | ${e.defaultReadOnly ?? ''} | ${e.step} | ${e.result}${e.detail && e.result !== 'OK' ? ` — ${e.detail.replaceAll('|', '\\|')}` : ''} |`),
    '',
    '**What this shows:** ' + r.proves.join(' '),
    '',
    r.notProven.length ? '**Not shown by this test:** ' + r.notProven.join(' ') : '',
    '',
  ]),
].join('\n');
writeFileSync('results/latest-report.md', md);
console.log('\nWrote results/latest-report.md');
