// Sign up one (or more) users, exactly like the app does, with APP_DATABASE_URL.
//   npm run signup              one sign-up
//   npm run signup -- 5         five sign-ups in a row
import { closeApp, signup } from '../../lib/signup.mjs';

const count = Math.max(1, Math.min(50, Number(process.argv[2]) || 1));
const names = ['Priya', 'Arjun', 'Meera', 'Rahul', 'Ananya', 'Vikram', 'Sara', 'Kabir', 'Isha', 'Rohan'];
let failed = 0;
for (let i = 0; i < count; i++) {
  const name = names[Math.floor(Math.random() * names.length)];
  const r = await signup({ name, email: `${name.toLowerCase()}.${Date.now()}@example.test` });
  if (r.ok) {
    console.log(`✅ Sign-up saved: ${r.name} (row ${r.id})   [database process ${r.pid}, read-only=${r.readOnly}]`);
  } else {
    failed++;
    console.log(`❌ Sign-up FAILED for ${r.name}: ${r.error}   [database process ${r.pid}, read-only=${r.readOnly}]`);
  }
}
await closeApp();
process.exit(failed ? 1 : 0);
