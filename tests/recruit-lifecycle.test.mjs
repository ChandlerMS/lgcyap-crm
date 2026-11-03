import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { LIFECYCLE_STAGES, lifecycleDecision, ticketStageForContact, contactStageForTicket } from '../lib/recruit-lifecycle.mjs';
import { createLifecycleProvider, createLifecycleStore, cronAuthorized, lifecycleEnabled, lifecycleReadStatus, reconcileLifecycle, withLifecycleLock } from '../lib/recruit-lifecycle-sync.mjs';

const stage = ticketStageForContact;
const initial = () => ({ ticketId: '101', contactId: '201', ticketStage: stage('application'), contactStage: 'application', path: 'mass_recruiting', licenseRoute: '' });
function harness(pair = initial(), baseline = { ...initial(), status: 'synced' }) {
  let current = structuredClone(pair), state = structuredClone(baseline), writes = 0;
  const store = { get: async () => structuredClone(state), put: async (_, next) => { state = structuredClone(next); } };
  const provider = { pair: async () => structuredClone(current), write: async (_, decision) => {
    assert.equal(state.status, 'pending'); assert.ok(state.pending); writes++;
    if (decision.target === 'contact') current.contactStage = decision.value; else current.ticketStage = decision.value;
  } };
  return { provider, store, set: next => { current = next; }, state: () => state, writes: () => writes };
}

test('the nine visible stages are bijective; branches and Withdrawn are excluded', () => {
  assert.equal(LIFECYCLE_STAGES.length, 9);
  for (const entry of LIFECYCLE_STAGES) assert.equal(contactStageForTicket(stage(entry.value)), entry.value);
  for (const value of ['withdrawn', 'licensed', 'genpop', 'mass_recruiting']) assert.equal(stage(value), null);
});
test('blank new Contact initializes from ticket without altering its stage', async () => {
  const h = harness({ ...initial(), contactStage: '' }, null);
  assert.equal((await reconcileLifecycle('101', h)).direction, 'ticket_to_contact');
  assert.equal(h.state().contactStage, 'application');
  assert.equal(h.state().ticketStage, stage('application'));
});
test('ticket edit propagates once and the next run performs no echo write', async () => {
  const h = harness({ ...initial(), ticketStage: stage('phone_interview') });
  assert.equal((await reconcileLifecycle('101', h)).direction, 'ticket_to_contact');
  assert.deepEqual(await reconcileLifecycle('101', h), { status: 'synced' });
  assert.equal(h.writes(), 1);
});
test('Contact edit moves ticket, including a backward move', async () => {
  const h = harness({ ...initial(), contactStage: 'hiring_event' });
  assert.equal((await reconcileLifecycle('101', h)).direction, 'contact_to_ticket');
  assert.equal(h.state().ticketStage, stage('hiring_event'));
});
test('simultaneous disagreeing edits and existing bootstrap disagreement are held', async () => {
  for (const baseline of [null, { ...initial(), status: 'synced' }]) {
    const h = harness({ ...initial(), ticketStage: stage('offer'), contactStage: 'training' }, baseline);
    assert.equal((await reconcileLifecycle('101', h)).status, 'conflict'); assert.equal(h.writes(), 0);
  }
});
test('explicit Contact clear is held; licensed branch cannot enter licensing', () => {
  assert.equal(lifecycleDecision({ ...initial(), contactStage: '' }, initial()).status, 'conflict');
  assert.equal(lifecycleDecision({ ...initial(), licenseRoute: 'licensed', contactStage: 'licensing_reminders' }, initial()).status, 'branch_conflict');
});
test('an association change is never accepted even if stages match', async () => {
  const h = harness({ ...initial(), contactId: '202' });
  assert.equal((await reconcileLifecycle('101', h)).status, 'association_changed'); assert.equal(h.writes(), 0);
});
test('pair changes after the first read stop the write', async () => {
  const h = harness({ ...initial(), ticketStage: stage('offer') }); let reads = 0;
  h.provider.pair = async () => ({ ...initial(), ticketStage: stage('offer'), contactStage: ++reads === 1 ? 'application' : 'training' });
  assert.equal((await reconcileLifecycle('101', h)).status, 'conflict'); assert.equal(h.writes(), 0);
});
test('timeout after a possible PATCH preserves intent and does not retry/reverse', async () => {
  const h = harness({ ...initial(), ticketStage: stage('offer') }); let attempts = 0;
  h.provider.write = async () => { attempts++; throw new Error('timeout'); };
  assert.equal((await reconcileLifecycle('101', h)).status, 'uncertain');
  assert.equal((await reconcileLifecycle('101', h)).status, 'uncertain');
  assert.equal(attempts, 1); assert.ok(h.state().pending);
  h.set({ ...initial(), ticketStage: stage('offer'), contactStage: 'offer' });
  assert.equal((await reconcileLifecycle('101', h)).status, 'synced');
  assert.equal(h.state().pending, null); assert.equal(attempts, 1);
});
test('failed confirmation is not claimed as successful sync', async () => {
  const h = harness({ ...initial(), ticketStage: stage('offer') });
  h.provider.write = async () => {};
  assert.equal((await reconcileLifecycle('101', h)).status, 'uncertain');
});
test('a missing/ambiguous link and malformed provider read never write', async () => {
  for (const syncStatus of ['ambiguous', 'unlinked', 'unavailable', 'unmapped']) {
    const h = harness(); h.provider.pair = async () => { throw Object.assign(new Error('read failed'), { syncStatus }); };
    assert.equal((await reconcileLifecycle('101', h)).status, syncStatus); assert.equal(h.writes(), 0);
  }
});
test('cron fails closed without exact secret or with non-production flags', () => {
  const secret = 'x'.repeat(40);
  assert.equal(cronAuthorized(new Request('https://example.test'), secret), false);
  assert.equal(cronAuthorized(new Request('https://example.test', { headers: { authorization: `Bearer ${secret}` } }), secret), true);
  assert.equal(cronAuthorized(new Request('https://example.test', { headers: { authorization: 'Bearer undefined' } }), undefined), false);
  const env = { RECRUITING_LIFECYCLE_SYNC_ENABLED: 'true', RECRUITING_WRITES_ENABLED: 'true', VERCEL: '1', VERCEL_ENV: 'production' };
  assert.equal(lifecycleEnabled(env), true);
  for (const key of Object.keys(env)) assert.equal(lifecycleEnabled({ ...env, [key]: '' }), false);
});
test('lock uses a pinned transaction connection and releases it when work fails', async () => {
  const calls = [], client = { query: async (sql, params) => { calls.push([sql, params]); return { rows: [{ acquired: true }] }; }, release: broken => calls.push(['release', broken]) };
  await assert.rejects(withLifecycleLock({ connect: async () => client }, async () => { throw new Error('job failed'); }));
  assert.equal(calls[0][0], 'BEGIN'); assert.match(calls[1][0], /pg_try_advisory_xact_lock/);
  assert.equal(calls.at(-2)[0], 'ROLLBACK'); assert.deepEqual(calls.at(-1), ['release', false]);
});
test('overlapping writer does no work when the transaction lock is held', async () => {
  let ran = false;
  const client = { query: async () => ({ rows: [{ acquired: false }] }), release() {} };
  await assert.rejects(withLifecycleLock({ connect: async () => client }, async () => { ran = true; }), /could not be confirmed/);
  assert.equal(ran, false);
});
test('durable ledger survives recreation and read status detects a later ticket change', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/0004_recruit_lifecycle_sync.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../migrations/0004_recruit_lifecycle_sync.sql', import.meta.url), 'utf8'));
    const store = createLifecycleStore(db);
    await store.put('101', { ...initial(), status: 'pending', pending: { target: 'contact', value: 'offer' } });
    assert.equal((await createLifecycleStore(db).get('101')).pending.value, 'offer');
    await store.put('101', { ...initial(), status: 'synced', pending: null });
    const rows = await lifecycleReadStatus(db, [{ id: '101', contactId: '201', stageId: stage('offer') }]);
    assert.equal(rows[0].lifecycleSync.status, 'pending');
  } finally { await db.close(); }
});

function providerFixture(mode = '') {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init }); const path = new URL(url).pathname;
    const response = data => new Response(JSON.stringify(data), { status: 200 });
    if (path.endsWith('/tickets/101/associations/contacts')) return response({ results: mode === 'multi-contact' ? [{ toObjectId: 201 }, { toObjectId: 202 }] : [{ toObjectId: 201 }] });
    if (path.endsWith('/contacts/201/associations/tickets')) return response({ results: [{ toObjectId: 101 }, { toObjectId: 102 }], ...(mode === 'cursor-loop' ? { paging: { next: { after: 'same' } } } : {}) });
    if (path.endsWith('/tickets/batch/read')) return response({ status: 'COMPLETE', results: [
      { id: '101', properties: { hs_pipeline: '924992938' } },
      { id: '102', properties: { hs_pipeline: mode === 'multi-recruiting' ? '924992938' : '0' } },
    ] });
    if (path.endsWith('/tickets/101')) return response({ id: '101', properties: { hs_pipeline: mode === 'wrong-pipeline' ? '0' : '924992938', hs_pipeline_stage: stage('application'), recruiting_path: 'mass_recruiting', licensing_branch: '' } });
    if (path.endsWith('/contacts/201')) return response({ id: '201', properties: { recruiting_lifecycle_stage: 'application' } });
    throw new Error('Unexpected provider request');
  };
  return { calls, provider: createLifecycleProvider({ accessToken: 'synthetic-token', fetchImpl }) };
}
test('provider verifies reverse links and ignores a separate Support ticket', async () => {
  const { provider, calls } = providerFixture(); assert.deepEqual(await provider.pair('101'), initial());
  assert.ok(calls.every(call => call.init.redirect === 'manual' && new URL(call.url).hostname === 'api.hubapi.com'));
});
test('provider refuses ambiguous, truncated, and out-of-pipeline records', async () => {
  for (const mode of ['multi-contact', 'multi-recruiting', 'cursor-loop', 'wrong-pipeline']) {
    const { provider, calls } = providerFixture(mode); await assert.rejects(provider.pair('101'));
    assert.ok(calls.every(call => call.init.method !== 'PATCH'));
  }
});
test('provider only PATCHes the allowlisted stage field, never sales lifecycle or branches', async () => {
  const { provider, calls } = providerFixture();
  const pair = initial();
  await provider.write(pair, { status: 'write', target: 'contact', value: 'application' });
  const write = calls.find(call => call.init.method === 'PATCH');
  assert.deepEqual(JSON.parse(write.init.body), { properties: { recruiting_lifecycle_stage: 'application' } });
  await assert.rejects(provider.write(pair, { status: 'write', target: 'contact', value: 'customer' }));
});
