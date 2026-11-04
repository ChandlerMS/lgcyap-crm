import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';
let initialized;

async function applyMigrations(pool) {
  await pool.query(await readFile(new URL('../migrations/0011_lead_data.sql', import.meta.url), 'utf8'));
}

/** Reversible additive tables only, initialized after request authorization. */
export async function getLeadDataDb() {
  const pool = getPool();
  initialized ??= applyMigrations(pool).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
