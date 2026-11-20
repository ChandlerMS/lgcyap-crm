import { readFile } from 'node:fs/promises';
import { getApplicationSheetsDb, sharingSchema } from './application-sheets.mjs';
let initialized;
export async function getSignInSheetsDb() {
  const pool = await getApplicationSheetsDb();
  initialized ??= readFile(new URL('../migrations/0016_sign_in_sheets.sql', import.meta.url), 'utf8').then(sql => pool.query(sql))
    .then(() => pool.query(sharingSchema('sign_in_sheets_months'))).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
