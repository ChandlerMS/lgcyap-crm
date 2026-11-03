import { readFile } from 'node:fs/promises';
import { getPool } from '../db/pool.mjs';

if (process.argv[2] !== '--apply' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  console.error('Lifecycle migration requires an explicit Production --apply operation.');
  process.exitCode = 1;
} else {
  const pool = getPool();
  try {
    await pool.query(await readFile(new URL('../migrations/0004_recruit_lifecycle_sync.sql', import.meta.url), 'utf8'));
    await pool.query('SELECT ticket_id,contact_id,ticket_stage,contact_stage,status,pending,checked_at,synced_at FROM recruit_lifecycle_sync LIMIT 0');
    await pool.query('SELECT cursor_id,checked_at,summary FROM recruit_lifecycle_job WHERE id=1');
    console.log('Recruiting lifecycle sync migration applied and verified.');
  } catch {
    console.error('Recruiting lifecycle migration failed. No credentials were logged.');
    process.exitCode = 1;
  } finally { await pool.end(); }
}
