import { timingSafeEqual } from 'node:crypto';
import { PIPELINE_ID } from './recruiting-config.mjs';
import { CONTACT_RECRUITING_STAGE, contactStageForTicket, lifecycleDecision } from './recruit-lifecycle.mjs';
import { verifyRecruitIntakeAccess } from './recruit-intake.mjs';

const validId = id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id);
const ticketFields = ['hs_pipeline', 'hs_pipeline_stage', 'recruiting_path', 'licensing_branch'];
const fail = status => Object.assign(new Error('Recruiting lifecycle sync could not be confirmed.'), { syncStatus: status });
export const lifecycleEnabled = (env = process.env) => env.RECRUITING_LIFECYCLE_SYNC_ENABLED === 'true'
  && env.RECRUITING_WRITES_ENABLED === 'true' && env.VERCEL === '1' && env.VERCEL_ENV === 'production';

export function cronAuthorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A transaction-scoped lock works with Neon's transaction pooler. Ledger intents
 * use separate committed statements so a dropped lock transaction cannot erase them. */
export async function withLifecycleLock(pool, work, job = false) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(50894788, $1) AS acquired', [job ? 924992939 : 924992938]);
    if (!lock.rows[0]?.acquired) throw fail('busy');
    return await work();
  } finally {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    client.release(broken);
  }
}

export function createLifecycleStore(pool) {
  return {
    async get(ticketId) {
      const { rows } = await pool.query('SELECT * FROM recruit_lifecycle_sync WHERE ticket_id=$1', [ticketId]);
      const row = rows[0];
      return row ? { contactId: row.contact_id, ticketStage: row.ticket_stage, contactStage: row.contact_stage,
        status: row.status, pending: row.pending } : null;
    },
    async put(ticketId, state) {
      await pool.query(`INSERT INTO recruit_lifecycle_sync(ticket_id,contact_id,ticket_stage,contact_stage,status,pending,checked_at,synced_at)
        VALUES($1,$2,$3,$4,$5,$6,now(),CASE WHEN $5='synced' THEN now() END)
        ON CONFLICT(ticket_id) DO UPDATE SET contact_id=$2,ticket_stage=$3,contact_stage=$4,status=$5,pending=$6,checked_at=now(),
          synced_at=CASE WHEN $5='synced' THEN now() ELSE recruit_lifecycle_sync.synced_at END`,
      [ticketId, state.contactId ?? null, state.ticketStage ?? null, state.contactStage ?? null, state.status, state.pending ?? null]);
    },
  };
}

export function createLifecycleProvider({ accessToken, fetchImpl = fetch, deadline = Date.now() + 45000, now = Date.now }) {
  async function request(path, body, method = body ? 'POST' : 'GET') {
    const remaining = deadline - now();
    if (remaining <= 0) throw fail('unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(5000, remaining));
    try {
      const response = await fetchImpl(`https://api.hubapi.com${path}`, { method, redirect: 'manual', signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status !== 200) throw fail('unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw fail('unavailable');
      const chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw fail('unavailable'); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { clearTimeout(timer); }
  }
  function record(raw, id, properties) {
    if (raw?.id !== id || raw.archived || !raw.properties || properties.some(key => !Object.hasOwn(raw.properties, key)
      || (raw.properties[key] !== null && typeof raw.properties[key] !== 'string'))) throw fail('unavailable');
    return raw.properties;
  }
  async function associations(from, id, to) {
    const ids = new Set(), cursors = new Set(); let after;
    for (let page = 0; page < 5; page++) {
      const raw = await request(`/crm/v4/objects/${from}/${id}/associations/${to}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      if (!Array.isArray(raw?.results) || raw.results.length > 100) throw fail('unavailable');
      for (const row of raw.results) { const value = String(row.toObjectId); if (!validId(value)) throw fail('unavailable'); ids.add(value); }
      const next = raw.paging?.next?.after;
      if (next === undefined || next === null) return [...ids];
      after = String(next);
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(after) || cursors.has(after) || !raw.results.length) throw fail('ambiguous');
      cursors.add(after);
    }
    throw fail('ambiguous'); // Never treat a truncated relationship list as unique.
  }
  async function pair(ticketId) {
    if (!validId(ticketId)) throw fail('unavailable');
    const ticket = record(await request(`/crm/v3/objects/tickets/${ticketId}?properties=${ticketFields.join(',')}`), ticketId, ticketFields);
    if (ticket.hs_pipeline !== PIPELINE_ID) throw fail('unmapped');
    const contacts = await associations('tickets', ticketId, 'contacts');
    if (contacts.length !== 1) throw fail(contacts.length ? 'ambiguous' : 'unlinked');
    const contactId = contacts[0], tickets = await associations('contacts', contactId, 'tickets');
    const recruitingIds = [];
    for (let i = 0; i < tickets.length; i += 100) {
      const requested = tickets.slice(i, i + 100);
      const raw = await request('/crm/v3/objects/tickets/batch/read', { inputs: requested.map(id => ({ id })), properties: ['hs_pipeline'] });
      if (raw?.status !== 'COMPLETE' || raw.numErrors || raw.errors?.length || !Array.isArray(raw.results)
        || raw.results.length !== requested.length || new Set(raw.results.map(row => row.id)).size !== requested.length) throw fail('ambiguous');
      for (const row of raw.results) {
        if (!requested.includes(row.id)) throw fail('ambiguous');
        const props = record(row, row.id, ['hs_pipeline']);
        if (props.hs_pipeline === PIPELINE_ID) recruitingIds.push(row.id);
      }
    }
    if (recruitingIds.length !== 1 || recruitingIds[0] !== ticketId) throw fail('ambiguous');
    const contact = record(await request(`/crm/v3/objects/contacts/${contactId}?properties=${CONTACT_RECRUITING_STAGE}`), contactId, [CONTACT_RECRUITING_STAGE]);
    return { ticketId, contactId, ticketStage: ticket.hs_pipeline_stage, contactStage: contact[CONTACT_RECRUITING_STAGE] ?? '',
      path: ticket.recruiting_path ?? '', licenseRoute: ticket.licensing_branch ?? '' };
  }
  return {
    pair,
    async write(pair, decision) {
      const contact = decision.target === 'contact';
      if (decision.status !== 'write' || !['contact', 'ticket'].includes(decision.target) || !validId(pair.ticketId) || !validId(pair.contactId)
        || (contact ? decision.value !== contactStageForTicket(pair.ticketStage) : contactStageForTicket(decision.value) !== pair.contactStage)) throw fail('unmapped');
      await request(`/crm/v3/objects/${contact ? 'contacts' : 'tickets'}/${contact ? pair.contactId : pair.ticketId}`,
        { properties: { [contact ? CONTACT_RECRUITING_STAGE : 'hs_pipeline_stage']: decision.value } }, 'PATCH');
    },
    async list(cursor = '0') {
      if (!/^\d{1,20}$/.test(cursor)) throw fail('unavailable');
      const raw = await request('/crm/v3/objects/tickets/search', { filterGroups: [{ filters: [
        { propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID },
        { propertyName: 'hs_object_id', operator: 'GT', value: cursor },
      ] }], properties: ['hs_pipeline'], sorts: ['hs_object_id'], limit: 20 });
      if (!Array.isArray(raw?.results) || raw.results.length > 20) throw fail('unavailable');
      let previous = BigInt(cursor);
      for (const row of raw.results) { if (!validId(row.id) || BigInt(row.id) <= previous || row.properties?.hs_pipeline !== PIPELINE_ID) throw fail('unavailable'); previous = BigInt(row.id); }
      return { ids: raw.results.map(row => row.id), more: Boolean(raw.paging?.next) };
    },
  };
}

/** Must run under withLifecycleLock. Durable intent precedes every provider PATCH. */
export async function reconcileLifecycle(ticketId, { provider, store }) {
  let state = await store.get(ticketId);
  let pair;
  const report = async status => { state = { ...state, status }; await store.put(ticketId, state); return { status }; };
  try {
    pair = await provider.pair(ticketId);
    const decision = lifecycleDecision(pair, state);
    if (decision.status === 'synced') {
      // A previously ambiguous write is resolved only by observing both matching sides.
      await store.put(ticketId, { ...pair, status: 'synced', pending: null });
      return { status: 'synced' };
    }
    if (decision.status !== 'write') return report(decision.status);
    const latest = await provider.pair(ticketId);
    if (JSON.stringify(latest) !== JSON.stringify(pair)) return report('conflict');
    state = { ...state, contactId: pair.contactId, status: 'pending', pending: { ...decision, ticketStage: pair.ticketStage, contactStage: pair.contactStage } };
    await store.put(ticketId, state);
    await provider.write(pair, decision);
    const confirmed = await provider.pair(ticketId);
    const expectedTicket = decision.target === 'ticket' ? decision.value : pair.ticketStage;
    const expectedContact = decision.target === 'contact' ? decision.value : pair.contactStage;
    if (confirmed.contactId !== pair.contactId || confirmed.ticketStage !== expectedTicket || confirmed.contactStage !== expectedContact
      || confirmed.path !== pair.path || confirmed.licenseRoute !== pair.licenseRoute) return report('uncertain');
    await store.put(ticketId, { ...confirmed, status: 'synced', pending: null });
    return { status: 'synced', direction: decision.target === 'contact' ? 'ticket_to_contact' : 'contact_to_ticket' };
  } catch (error) { return report(state?.pending ? 'uncertain' : error.syncStatus ?? 'unavailable'); }
}

export async function runLifecycleJob({ pool, accessToken, fetchImpl = fetch, now = Date.now }) {
  return withLifecycleLock(pool, async () => {
    const deadline = now() + 48000;
    await verifyRecruitIntakeAccess({ accessToken, fetchImpl, deadline, now });
    const cursor = (await pool.query('SELECT cursor_id FROM recruit_lifecycle_job WHERE id=1')).rows[0]?.cursor_id;
    if (cursor === undefined) throw fail('unavailable');
    const provider = createLifecycleProvider({ accessToken, fetchImpl, deadline, now });
    const store = createLifecycleStore(pool), page = await provider.list(cursor);
    const summary = { processed: 0, synced: 0, attention: 0, remaining: page.more };
    let nextCursor = cursor;
    for (const id of page.ids) {
      if (now() > deadline - 12000) { summary.remaining = true; break; }
      const result = await withLifecycleLock(pool, () => reconcileLifecycle(id, { provider, store }));
      summary.processed++;
      if (result.status === 'synced') summary.synced++; else summary.attention++;
      nextCursor = id;
    }
    if (summary.processed === page.ids.length && !page.more) nextCursor = '0';
    await pool.query('UPDATE recruit_lifecycle_job SET cursor_id=$1,checked_at=now(),summary=$2 WHERE id=1', [nextCursor, summary]);
    return summary;
  }, true);
}

export async function lifecycleReadStatus(pool, recruits) {
  if (!recruits.length) return recruits;
  const result = await pool.query('SELECT ticket_id,status,ticket_stage,contact_stage,contact_id,checked_at,synced_at FROM recruit_lifecycle_sync WHERE ticket_id=ANY($1::text[])', [recruits.map(row => row.id)]);
  const byId = new Map(result.rows.map(row => [row.ticket_id, row]));
  return recruits.map(recruit => {
    const row = byId.get(recruit.id);
    const status = row?.status === 'synced' && (row.ticket_stage !== recruit.stageId || row.contact_id !== recruit.contactId) ? 'pending' : row?.status ?? 'pending';
    return { ...recruit, lifecycleSync: { status, checkedAt: row?.checked_at ?? null, syncedAt: row?.synced_at ?? null } };
  });
}
