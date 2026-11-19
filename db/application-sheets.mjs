import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';
let initialized;
export async function getApplicationSheetsDb() {
  const pool = getPool();
  initialized ??= readFile(new URL('../migrations/0015_application_sheets.sql', import.meta.url), 'utf8').then(sql => pool.query(sql)).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
