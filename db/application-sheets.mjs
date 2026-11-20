import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';

// Keep in sync with migrations/0018_monthly_sheets_sharing.sql. Inline SQL is deliberate, as in db/gmail.mjs.
export const sharingSchema = table => ['shared_with text[] NOT NULL DEFAULT \'{}\'', 'share_checked_day text', 'share_error text']
  .map(column => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column};`).join('\n');

let initialized;
export async function getApplicationSheetsDb() {
  const pool = getPool();
  initialized ??= readFile(new URL('../migrations/0015_application_sheets.sql', import.meta.url), 'utf8').then(sql => pool.query(sql))
    .then(() => pool.query(sharingSchema('application_sheets_months'))).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
