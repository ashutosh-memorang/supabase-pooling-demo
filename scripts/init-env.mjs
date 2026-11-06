// Creates .env with random passwords for the synthetic test roles.
// Usage: npm run lab:init-env -- <project-ref> <pooler-host> [--i-confirm-disposable]
// If .env already exists, only missing password keys are appended (existing ones are never changed,
// because changing a role's password makes Supavisor's cached auth secret stale for a while).
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const PASSWORD_KEYS = [
  'TEST_APP_PASSWORD',
  'TEST_DELIVERY_PASSWORD',
  'TEST_HUMAN_PASSWORD',
  'TEST_MAINT_PASSWORD',
  'TEST_SHARED_PASSWORD',
  'TEST_MIGRATOR_PASSWORD',
];
const pw = () => randomBytes(24).toString('base64url');

if (existsSync('.env')) {
  const current = readFileSync('.env', 'utf8');
  const missing = PASSWORD_KEYS.filter((k) => !new RegExp(`^${k}=.+`, 'm').test(current));
  if (missing.length) {
    appendFileSync('.env', `${current.endsWith('\n') ? '' : '\n'}${missing.map((k) => `${k}=${pw()}`).join('\n')}\n`);
    console.log(`Added ${missing.join(', ')} to .env (values not printed).`);
  } else {
    console.log('.env already has every password key; nothing changed.');
  }
  process.exit(0);
}

const args = process.argv.slice(2);
const confirm = args.includes('--i-confirm-disposable');
const [ref, poolerHost] = args.filter((a) => !a.startsWith('--'));
if (!ref || !poolerHost) {
  console.error('Usage: npm run lab:init-env -- <project-ref> <pooler-host> [--i-confirm-disposable]');
  process.exit(1);
}

writeFileSync(
  '.env',
  `PROJECT_REF=${ref}
ALLOWED_PROJECT_REF=${ref}
CONFIRM_DISPOSABLE=${confirm ? 'yes' : 'no'}
POOLER_HOST=${poolerHost}
POOLER_TRANSACTION_PORT=6543
POOLER_SESSION_PORT=5432
${PASSWORD_KEYS.map((k) => `${k}=${pw()}`).join('\n')}
`,
  { mode: 0o600 },
);
console.log('Wrote .env (mode 600). Passwords were not printed.');
if (!confirm) console.log('Edit .env and set CONFIRM_DISPOSABLE=yes once you are sure the project is disposable.');
