import { getPool } from './pool.mjs';
export const NO_CONTACT_SCHEMA = `CREATE TABLE IF NOT EXISTS recruit_no_contact_tasks (
 ticket_id text NOT NULL, since_at timestamptz NOT NULL, task_id text UNIQUE,
 status text NOT NULL DEFAULT 'pending', retry_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(ticket_id,since_at));
CREATE TABLE IF NOT EXISTS recruit_no_contact_job(id integer PRIMARY KEY CHECK(id=1), cursor_id text NOT NULL DEFAULT '0');
INSERT INTO recruit_no_contact_job(id) VALUES(1) ON CONFLICT DO NOTHING;`;
let initialized;
export async function noContactDb() {
 const pool = getPool();
 initialized ??= (async () => { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(50894788, 1515)'); await client.query(NO_CONTACT_SCHEMA); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } })().catch(error => { initialized = null; throw error; });
 await initialized; return pool;
}
export function noContactStore(db) {
 const update = (id, since, status, taskId) => db.query('UPDATE recruit_no_contact_tasks SET status=$3, task_id=COALESCE($4,task_id),retry_at=NULL,updated_at=now() WHERE ticket_id=$1 AND since_at=$2', [id, since, status, taskId ?? null]);
 return {
  periods: async id => (await db.query('SELECT since_at,task_id,status,retry_at FROM recruit_no_contact_tasks WHERE ticket_id=$1 ORDER BY since_at', [id])).rows.map(row => ({ since: new Date(row.since_at).toISOString(), taskId: row.task_id, status: row.status, retryAt: row.retry_at ? new Date(row.retry_at).getTime() : null })),
  claim: async (id, since, at = Date.now()) => (await db.query("INSERT INTO recruit_no_contact_tasks(ticket_id,since_at) VALUES($1,$2) ON CONFLICT(ticket_id,since_at) DO UPDATE SET status='pending',retry_at=NULL,updated_at=now() WHERE recruit_no_contact_tasks.status='retryable' AND recruit_no_contact_tasks.retry_at <= $3 RETURNING ticket_id", [id, since, new Date(at)])).rows.length === 1,
  retryable: (id,since,at) => db.query("UPDATE recruit_no_contact_tasks SET status='retryable',retry_at=$3,updated_at=now() WHERE ticket_id=$1 AND since_at=$2", [id,since,new Date(at)]),
  created: (id,since,task) => update(id,since,'created',task), completed: (id,since) => update(id,since,'completed'), uncertain: (id,since) => update(id,since,'uncertain'),
 };
}
export async function sharedFollowUpTaskIds() {
 const db = await noContactDb();
 const rows = (await db.query("SELECT task_id FROM recruit_no_contact_tasks WHERE task_id IS NOT NULL AND status='created' ORDER BY updated_at DESC LIMIT 1001")).rows;
 return { ids: rows.slice(0,1000).map(row => row.task_id), partial: rows.length > 1000 };
}
