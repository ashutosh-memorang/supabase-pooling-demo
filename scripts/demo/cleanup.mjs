// Remove everything the sign-up demo created: public.signups and the Delivery login.
//   npm run demo:cleanup
import pg from 'pg';
import { APP, DELIVERY } from '../../lib/simple-config.mjs';

const c = new pg.Client({ connectionString: APP.url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const ended = await c.query({ text: 'select count(pg_terminate_backend(pid))::int as n from pg_stat_activity where usename = $1', values: [DELIVERY.role] });
  await c.query('drop table if exists public.signups');
  await c.query(`drop role if exists ${pg.escapeIdentifier(DELIVERY.role)}`);
  console.log(`Removed public.signups and login "${DELIVERY.role}" (${ended.rows[0].n} of its processes ended).`);
} finally {
  await c.end();
}
