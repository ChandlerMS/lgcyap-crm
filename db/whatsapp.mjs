import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';
let initialized, svpInitialized;

/** Reversible additive tables only, initialized after request authorization. */
export async function getWhatsappDb() {
  const pool = getPool();
  initialized ??= readFile(new URL('../migrations/0006_whatsapp_sales.sql', import.meta.url), 'utf8').then(sql => pool.query(sql)).catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}

/** The separate Standard vs Preferred chat dataset (migration 0020), also additive and reversible. */
export async function getWhatsappSvpDb() {
  const pool = getPool();
  svpInitialized ??= readFile(new URL('../migrations/0020_whatsapp_svp_sales.sql', import.meta.url), 'utf8').then(sql => pool.query(sql)).catch(error => { svpInitialized = null; throw error; });
  await svpInitialized;
  return pool;
}
