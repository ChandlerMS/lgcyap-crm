import { readFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { getPool } from '../db/pool.mjs';

nextEnv.loadEnvConfig(process.cwd());

if (process.argv[2] !== '--apply') {
  console.error('No database was changed. Run npm run db:migrate -- --apply only against the new Vercel database.');
  process.exitCode = 1;
} else {
  let pool;
  try {
    pool = getPool();
    const sql = await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    console.log('Recruiting ledger migration applied. Auth tables are managed by the separate auth migration.');
  } catch {
    console.error('Migration failed. Check the database configuration and connectivity. Credentials were not logged.');
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
