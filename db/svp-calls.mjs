import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';
let initialized;

async function applyMigrations(pool) {
  await pool.query(await readFile(new URL('../migrations/0007_svp_calls.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/0008_svp_ringcx_calls.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/0009_svp_ringcx_report.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/0010_svp_report_connected.sql', import.meta.url), 'utf8'));
}

/** Reversible additive tables only, initialized after request authorization. */
export async function getSvpCallsDb() {
  const pool = getPool();
  initialized ??= applyMigrations(pool).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
