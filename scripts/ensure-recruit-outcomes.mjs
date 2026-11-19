import { getPool } from '../db/pool.mjs';
import { ensureRecruitOutcomeSchema } from '../lib/recruit-outcome-schema.mjs';
if (process.env.VERCEL_ENV !== 'production') {
  console.log('Recruiting outcome setup skipped outside Production.');
} else if (process.argv[2] !== '--apply' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production' || process.env.VERCEL_PROJECT_ID !== 'prj_tAhuHcbCr3HXxant1EGPbaFLjc6E') {
  console.error('Recruiting outcome setup requires the existing Production project and --apply.'); process.exitCode = 1;
} else {
  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
    await client.query("SET statement_timeout = '90s'");
    await client.query('SELECT pg_advisory_lock(50894788, 924992940)');
    const outcomes = await ensureRecruitOutcomeSchema({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
    console.log(JSON.stringify({ recruitingOutcomeSetup: 'verified', ...outcomes }));
  } catch (error) { console.error(error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, '[redacted]') : 'Recruiting outcome setup failed'); process.exitCode = 1; }
  finally { if (client) { try { await client.query('SELECT pg_advisory_unlock(50894788, 924992940)'); } finally { client.release(); } } await pool.end(); }
}
