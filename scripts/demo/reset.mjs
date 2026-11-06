// Restart the app login's pooled database processes, which clears any leftover read-only setting.
// Only ends processes Supavisor opened for the APP login; Supabase's own workers are left alone.
//   npm run demo:reset
import { closeApp, reset } from '../../lib/signup.mjs';

const r = await reset();
console.log(`🔄 Reset done: restarted ${r.terminated} other pooled process(es) for the app login and cleared the setting on the one running this command. No read-only leftovers remain.`);
await closeApp();
process.exit(0);
