import { ADMIN_EMAILS, normalizeAccessEmail } from '../lib/admin-policy.mjs';
import { readFile } from 'node:fs/promises';
import { getPool } from './pool.mjs';
let initialized;
export async function adminDb() {
  const pool = getPool();
  initialized ??= (async () => {
    const sql = await readFile(new URL('../migrations/0013_admin_access.sql', import.meta.url), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(50894788, 1313)');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  })().catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
export async function accessOverrides() {
  return (await (await adminDb()).query('SELECT email, allowed, updated_by, updated_at FROM crm_access_overrides ORDER BY email')).rows;
}
export async function setCrmAccess(email, allowed, actor, database) {
  email = normalizeAccessEmail(email);
  if (!ADMIN_EMAILS.includes(actor) || typeof allowed !== 'boolean') throw Object.assign(new Error('Access denied.'), { status: 403 });
  if (!allowed && ADMIN_EMAILS.includes(email)) throw Object.assign(new Error('CRM administrators cannot be removed.'), { status: 400 });
  const db = database ?? await adminDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO crm_access_overrides(email, allowed, updated_by) VALUES ($1,$2,$3) ON CONFLICT(email) DO UPDATE SET allowed=excluded.allowed, updated_by=excluded.updated_by, updated_at=now()', [email, allowed, actor]);
    await client.query('INSERT INTO crm_admin_audit(actor, action, target) VALUES ($1,$2,$3)', [actor, allowed ? 'crm.grant' : 'crm.revoke', email]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function auditAction(actor, action, target) {
  await (await adminDb()).query('INSERT INTO crm_admin_audit(actor, action, target) VALUES ($1,$2,$3)', [actor, action, target]);
}
