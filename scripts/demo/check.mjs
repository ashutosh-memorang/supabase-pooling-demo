// Show what actually got saved. Failed sign-ups never become rows.
//   npm run demo:check
import { closeApp, countUsers, recentSignups } from '../../lib/signup.mjs';

console.log(`public.signups has ${await countUsers()} rows. Latest 10:`);
console.table((await recentSignups(10)).map((r) => ({ ...r, created_at: r.created_at.toISOString() })));
await closeApp();
process.exit(0);
