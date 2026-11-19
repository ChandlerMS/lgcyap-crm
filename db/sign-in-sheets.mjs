import { readFile } from 'node:fs/promises';
import { getApplicationSheetsDb } from './application-sheets.mjs';
let initialized;
export async function getSignInSheetsDb() {
  const pool = await getApplicationSheetsDb();
  initialized ??= readFile(new URL('../migrations/0016_sign_in_sheets.sql', import.meta.url), 'utf8').then(sql => pool.query(sql)).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
