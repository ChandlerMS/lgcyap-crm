import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';
let initialized;

/** Reversible additive tables only, initialized after request authorization. */
export async function getSvpCallsDb() {
  const pool = getPool();
  initialized ??= readFile(new URL('../migrations/0007_svp_calls.sql', import.meta.url), 'utf8').then(sql => pool.query(sql)).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
