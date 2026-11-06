// The Delivery script, written the way the incident script was: it switches its session to
// read-only "to be safe" (SET without LOCAL), runs a check, and exits.
//
//   npm run delivery:app-login    BAD:  uses APP_DATABASE_URL      (same login as the app)
//   npm run delivery:own-login    GOOD: uses DELIVERY_DATABASE_URL (its own login)
//
// Optional: --connections N  (default 1) to behave like a tool with a small connection pool.
import { runScript } from '../../lib/signup.mjs';

const args = process.argv.slice(2);
const login = args.includes('--own') ? 'own' : args.includes('--app') ? 'same' : null;
if (!login) {
  console.error('Usage: node scripts/demo/delivery-script.mjs --app | --own [--connections N]');
  process.exit(2);
}
const i = args.indexOf('--connections');
const connections = i >= 0 ? Number(args[i + 1]) : 1;

const r = await runScript({ login, connections });
console.log(`🔧 Delivery script ran as "${r.login}" ${r.ownLogin ? "(its OWN login)" : "(the APP's login)"}`);
console.log(`   SET default_transaction_read_only = on  →  database process(es) ${r.pids.join(', ')} are now read-only`);
console.log('   Script exited. Those processes stay open in the pool for that login.');
console.log(r.ownLogin
  ? '   They belong to the Delivery login\'s pool, so the app will never be given them. Try: npm run signup'
  : '   They belong to the APP login\'s pool, so the app can be given one of them. Try: npm run signup');
process.exit(0);
