import { noContactDb, noContactStore } from '../db/no-contact-tasks.mjs';
import { noContactProvider } from './no-contact-provider.mjs';
import { reconcileNoContact, inactivityPeriod } from './no-contact-tasks.mjs';
import { verifyToolWriteAccess } from './hubspot-tool-write.mjs';
export function noContactEnabled(env = process.env) { return env.RECRUITING_NO_CONTACT_TASKS_ENABLED !== 'false' && env.RECRUITING_WRITES_ENABLED === 'true' && env.VERCEL === '1' && env.VERCEL_ENV === 'production'; }
/** @param {{accessToken?: string, pool?: any, fetchImpl?: typeof fetch, clock?: () => number}} options */
export async function runNoContactJob({ accessToken, pool, fetchImpl = fetch, clock = Date.now } = {}) {
  const db = pool ?? await noContactDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(50894788, 1516) AS acquired');
    if (!lock.rows[0]?.acquired) return { status: 'busy' };
    const deadline = clock() + 48000;
    await verifyToolWriteAccess('tasks', { accessToken, fetchImpl });
    const provider = noContactProvider({ accessToken, fetchImpl, deadline, clock });
    await provider.verifyQueue();
    const cursor = (await db.query('SELECT cursor_id FROM recruit_no_contact_job WHERE id=1')).rows[0]?.cursor_id;
    if (cursor === undefined) throw new Error('Follow-up cursor unavailable');
    const page = await provider.list(cursor);
    const summary = { processed: 0, created: 0, attention: 0, remaining: page.more };
    let next = cursor;
    for (const row of page.recruits) {
      if (clock() > deadline - 15000) { summary.remaining = true; break; }
      try {
        const store = noContactStore(db);
        const period = inactivityPeriod(row, clock());
        const prior = await store.periods(row.id);
        const recorded = prior.find(item => item.since === period?.since);
        const fresh = period && (!recorded || (recorded.status === 'retryable' && recorded.retryAt <= clock())) ? await provider.fresh(row.id) : row;
        if (fresh) { const result = await reconcileNoContact(fresh, { now: clock(), store: noContactStore(db), provider }); if (result.status === 'created') summary.created++; if (['uncertain', 'retryable', 'contact_unavailable', 'invalid_date'].includes(result.status)) summary.attention++; }
      } catch { summary.attention++; }
      summary.processed++; next = row.id;
    }
    if (summary.processed === page.recruits.length && !page.more) next = '0';
    await db.query('UPDATE recruit_no_contact_job SET cursor_id=$1 WHERE id=1', [next]);
    return summary;
  } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
}
