// Terminates test-role backends and drops all test roles/data.
import { readFileSync } from 'node:fs';
import '../lib/config.mjs';
import { adminQuery } from '../lib/admin.mjs';

export async function cleanup() {
  return adminQuery(readFileSync(new URL('../sql/cleanup.sql', import.meta.url), 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.table(await cleanup());
  console.log('Lab cleanup complete.');
}
