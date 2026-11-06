// Ends server backends of the test roles so any leftover session setting is gone.
// Closing your client is NOT enough in transaction mode: the pooler keeps the backend.
import '../lib/config.mjs';
import { recycleBackends } from '../lib/admin.mjs';

const { terminated, remaining } = await recycleBackends();
console.log(`Terminated ${terminated.length} test backend(s).`);
console.table(terminated);
console.log(remaining.length ? `WARNING: still present: ${remaining.map((r) => r.pid).join(', ')}` : 'None of them remain.');
