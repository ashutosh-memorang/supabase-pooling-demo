// Creates the test roles, schema and table on the allow-listed disposable project.
import { readFileSync } from 'node:fs';
import { ROLE_PASSWORDS } from '../lib/config.mjs';
import { adminQuery } from '../lib/admin.mjs';

const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

export async function setup() {
  const sql = readFileSync(new URL('../sql/setup.sql', import.meta.url), 'utf8')
    .replace(":'test_app_pw'", lit(ROLE_PASSWORDS.test_app))
    .replace(":'test_delivery_pw'", lit(ROLE_PASSWORDS.test_delivery))
    .replace(":'test_human_pw'", lit(ROLE_PASSWORDS.test_readonly_human))
    .replace(":'test_maint_pw'", lit(ROLE_PASSWORDS.test_maint));
  return adminQuery(sql);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const roles = await setup();
  console.table(roles);
  console.log('Setup complete.');
}
