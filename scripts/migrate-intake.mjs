import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

// Explicit Production deployment operation. Never pulls secrets to a local file.
if (process.argv[2] !== '--apply' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  console.error('Intake migration requires an explicit Production Vercel --apply operation. No database was changed.');
  process.exitCode = 1;
} else {
  let pool, client;
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Database unavailable');
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(key);
    pool = new Pool({ connectionString: url.href, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000 });
    pool.on('error', () => {});
    client = await pool.connect();
    const sql = await readFile(new URL('../migrations/0003_recruit_intake.sql', import.meta.url), 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='recruit_intake_requests' ORDER BY ordinal_position");
    const expected = ['user_id','request_id','phone_hash','email_hash','payload_hash','status','contact_id','ticket_id','created_at','updated_at'];
    if (columns.rows.map(row => row.column_name).join(',') !== expected.join(',')) throw new Error('Schema mismatch');
    const indexes = await client.query("SELECT c.relname AS indexname, i.indisunique, pg_get_indexdef(i.indexrelid) AS definition, pg_get_expr(i.indpred, i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='recruit_intake_requests' ORDER BY c.relname");
    const canonicalPredicate = value => String(value ?? '').replace(/::text/g, '').replace(/[()\s]/g, '').toLowerCase();
    for (const [name, columns, predicate] of [
      ['recruit_intake_requests_pkey', '(user_id, request_id)', ''],
      ['recruit_intake_one_phone', '(phone_hash)', "status<>'failed'"],
      ['recruit_intake_one_email', '(email_hash)', "email_hashisnotnullandstatus<>'failed'"],
    ]) {
      const index = indexes.rows.find(row => row.indexname === name);
      if (!index?.indisunique || !index.definition.includes(columns) || canonicalPredicate(index.predicate) !== predicate) throw new Error('Index mismatch');
    }
    const counts = await client.query('SELECT count(*)::int AS requests FROM recruit_intake_requests');
    await client.query('COMMIT');
    console.log(JSON.stringify({ migration: '0003_recruit_intake.sql', applied: true, verifiedColumns: expected.length, verifiedIndexes: indexes.rows.map(row => row.indexname), requestCount: counts.rows[0].requests }));
  } catch {
    if (client) { try { await client.query('ROLLBACK'); } catch { /* Original failure remains. */ } }
    console.error('Intake migration or schema verification failed. No connection details or credentials were logged.');
    process.exitCode = 1;
  } finally {
    client?.release();
    if (pool) await pool.end();
  }
}
