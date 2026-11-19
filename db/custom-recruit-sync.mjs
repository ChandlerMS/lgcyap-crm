export const CUSTOM_RECRUIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS recruit_custom_sync (
 ticket_id text PRIMARY KEY, contact_id text, recruit_id text UNIQUE,
 state jsonb NOT NULL DEFAULT '{}'::jsonb, checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recruit_custom_intake (
 contact_id text PRIMARY KEY, state jsonb NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recruit_custom_applications (
 note_id text PRIMARY KEY, ticket_id text NOT NULL, contact_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS recruit_custom_applications_ticket ON recruit_custom_applications(ticket_id);
CREATE TABLE IF NOT EXISTS recruit_custom_application_retry (note_id text PRIMARY KEY, status text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS recruit_custom_job (
 id integer PRIMARY KEY CHECK(id=1), cursor_id text NOT NULL DEFAULT '0', application_cursor text NOT NULL DEFAULT '0',
 custom_cursor text NOT NULL DEFAULT '0', checked_at timestamptz, summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE recruit_custom_job ADD COLUMN IF NOT EXISTS custom_cursor text NOT NULL DEFAULT '0';
INSERT INTO recruit_custom_job(id) VALUES(1) ON CONFLICT DO NOTHING;
`;
export async function initializeCustomRecruitStore(pool) { await pool.query(CUSTOM_RECRUIT_SCHEMA); }
export function createCustomRecruitStore(pool) {
  return {
    async get(ticketId) { return (await pool.query('SELECT state FROM recruit_custom_sync WHERE ticket_id=$1', [ticketId])).rows[0]?.state ?? null; },
    async put(ticketId, state) { await pool.query(`INSERT INTO recruit_custom_sync(ticket_id,contact_id,recruit_id,state) VALUES($1,$2,$3,$4)
      ON CONFLICT(ticket_id) DO UPDATE SET contact_id=$2,recruit_id=$3,state=$4,checked_at=now()`, [ticketId, state.contactId ?? null, state.recruitId ?? null, state]); },
    async getIntake(contactId) { return (await pool.query('SELECT state FROM recruit_custom_intake WHERE contact_id=$1', [contactId])).rows[0]?.state ?? null; },
    async putIntake(contactId, state) { await pool.query('INSERT INTO recruit_custom_intake(contact_id,state) VALUES($1,$2) ON CONFLICT(contact_id) DO UPDATE SET state=$2,checked_at=now()', [contactId, state]); },
    async markApplication(noteId, ticketId, contactId) { await pool.query('INSERT INTO recruit_custom_applications(note_id,ticket_id,contact_id) VALUES($1,$2,$3) ON CONFLICT(note_id) DO NOTHING', [noteId, ticketId, contactId]); },
    async hasApplication(ticketId) { return (await pool.query('SELECT 1 FROM recruit_custom_applications WHERE ticket_id=$1 LIMIT 1', [ticketId])).rows.length > 0; },
    async retryApplications() { return (await pool.query('SELECT note_id FROM recruit_custom_application_retry ORDER BY checked_at LIMIT 3')).rows.map(row => row.note_id); },
    async deferApplication(noteId, status) { await pool.query('INSERT INTO recruit_custom_application_retry(note_id,status) VALUES($1,$2) ON CONFLICT(note_id) DO UPDATE SET status=$2,checked_at=now()', [noteId, status]); },
    async clearApplicationRetry(noteId) { await pool.query('DELETE FROM recruit_custom_application_retry WHERE note_id=$1', [noteId]); },
    async job() { return (await pool.query('SELECT * FROM recruit_custom_job WHERE id=1')).rows[0]; },
    async finishJob(cursor, applicationCursor, summary, customCursor = '0') { await pool.query('UPDATE recruit_custom_job SET cursor_id=$1,application_cursor=$2,summary=$3,custom_cursor=$4,checked_at=now() WHERE id=1', [cursor, applicationCursor, summary, customCursor]); },
  };
}
/** Hold a transaction lock for Neon's transaction pooler. Durable intents use separate committed queries. */
export async function withCustomRecruitLock(pool, key, work) {
  const client = await pool.connect(); let broken = false;
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`50894788:custom-recruit:${key}`]);
    if (!lock.rows[0]?.acquired) return { status: 'busy' };
    return await work();
  } finally {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    client.release(broken);
  }
}
