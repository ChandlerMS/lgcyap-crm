import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCustomRecruit } from '../lib/custom-recruit-reconcile.mjs';
import { PIPELINE_ID, stageIdForKey } from '../lib/recruiting-config.mjs';
import { createRecruitProperties } from '../lib/custom-recruit-model.mjs';

function fixture(ticket = {}, recruit = {}) {
  let state;
  const pair = { ticket: { id: 't1', properties: { ...ticket } }, contactId: 'c1', recruit: recruit === null ? null : { id: 'r1', properties: { ...recruit } } };
  const writes = [];
  const store = { async get() { return structuredClone(state); }, async put(id, value) { state = structuredClone(value); } };
  const provider = {
    async pair() { return structuredClone(pair); },
    async patchTicket(id, props) { writes.push(['ticket', props]); Object.assign(pair.ticket.properties, props); },
    async patchRecruit(id, props) { writes.push(['recruit', props]); Object.assign(pair.recruit.properties, props); },
    async createRecruit(id, contact, props) { writes.push(['create', props]); pair.recruit = { id: 'r1', properties: props }; return { id: 'r1' }; },
  };
  return { pair, writes, provider, store, get state() { return state; }, run() { return reconcileCustomRecruit('t1', { provider, store, secret: 'test-secret' }); } };
}
const ticket = { hs_pipeline: PIPELINE_ID, hs_pipeline_stage: stageIdForKey('application'), recruiting_path: 'genpop', recruit_name: 'Private Candidate', phone: '15551234567', orientation_date: '2026-11-19' };
const recruit = (props) => createRecruitProperties(props, 't1');

test('fills blank existing fields and persists only fingerprints', async () => {
  const f = fixture(ticket, recruit({ ...ticket, recruit_name: '', orientation_date: '' }));
  assert.equal((await f.run()).status, 'synced');
  assert.equal(f.writes.length, 1);
  assert.ok(!JSON.stringify(f.state).includes('Private Candidate'));
  assert.ok(!JSON.stringify(f.state).includes('2026-11-19'));
  assert.ok(!JSON.stringify(f.state).includes('15551234567'));
});
test('initial nonblank disagreement prevents all writes', async () => {
  const f = fixture(ticket, recruit({ ...ticket, orientation_date: '2026-11-20' }));
  assert.equal((await f.run()).status, 'conflict');
  assert.equal(f.writes.length, 0);
});
test('propagates changes both ways after baseline and protects simultaneous edits', async () => {
  const f = fixture(ticket, recruit(ticket));
  assert.equal((await f.run()).status, 'synced');
  Object.assign(f.pair.recruit.properties, recruit({ ...ticket, orientation_date: '2026-11-20' }));
  assert.equal((await f.run()).status, 'synced');
  assert.equal(f.pair.ticket.properties.orientation_date, '2026-11-20');
  f.pair.ticket.properties.orientation_date = '2026-11-21';
  assert.equal((await f.run()).status, 'synced');
  f.pair.ticket.properties.orientation_date = '2026-11-22';
  Object.assign(f.pair.recruit.properties, recruit({ ...ticket, orientation_date: '2026-11-23' }));
  const count = f.writes.length;
  assert.equal((await f.run()).status, 'conflict');
  assert.equal(f.writes.length, count);
});
test('never retries an uncertain create', async () => {
  const f = fixture(ticket, null);
  let creates = 0;
  f.provider.createRecruit = async () => { creates++; throw Error('timeout'); };
  assert.equal((await f.run()).status, 'uncertain');
  assert.equal((await f.run()).status, 'uncertain');
  assert.equal(creates, 1);
});
test('acknowledges a timed out update by reading without rewriting', async () => {
  const f = fixture(ticket, recruit({ ...ticket, recruit_name: '', orientation_date: '' }));
  const original = f.provider.patchRecruit;
  f.provider.patchRecruit = async (...args) => { await original(...args); throw Error('timeout'); };
  assert.equal((await f.run()).status, 'synced');
  assert.equal((await f.run()).status, 'synced');
  assert.equal(f.writes.length, 1);
});
test('a stale reread prevents patching', async () => {
  const f = fixture(ticket, recruit({ ...ticket, recruit_name: '', orientation_date: '' }));
  const original = f.provider.pair;
  let reads = 0;
  f.provider.pair = async () => { if (++reads === 2) f.pair.ticket.properties.orientation_date = '2026-11-20'; return original(); };
  assert.equal((await f.run()).status, 'conflict');
  assert.equal(f.writes.length, 0);
});
test('pending create adopts only a matching discovered recruit', async () => {
  const f = fixture(ticket, null);
  f.provider.createRecruit = async () => { throw Error('timeout'); };
  assert.equal((await f.run()).status, 'uncertain');
  f.pair.recruit = { id: 'r1', properties: recruit(ticket) };
  assert.equal((await f.run()).status, 'synced');
  assert.equal(f.state.recruitId, 'r1');
});
test('pending create rejects a discovered recruit with different values', async () => {
  const f = fixture(ticket, null);
  f.provider.createRecruit = async () => { throw Error('timeout'); };
  await f.run();
  f.pair.recruit = { id: 'r1', properties: recruit({ ...ticket, recruit_name: 'Someone else' }) };
  assert.equal((await f.run()).status, 'conflict');
  assert.equal(f.writes.length, 0);
});
test('unconfirmed update remains uncertain and is never replayed', async () => {
  const f = fixture(ticket, recruit({ ...ticket, recruit_name: '', orientation_date: '' }));
  let attempts = 0;
  f.provider.patchRecruit = async () => { attempts++; throw Error('timeout'); };
  assert.equal((await f.run()).status, 'uncertain');
  assert.equal((await f.run()).status, 'uncertain');
  assert.equal(attempts, 1);
});
test('contact or recruit reassociation stops writes', async () => {
  for (const kind of ['contact', 'recruit']) {
    const f = fixture(ticket, recruit(ticket));
    await f.run();
    if (kind === 'contact') f.pair.contactId = 'c2';
    else f.pair.recruit.id = 'r2';
    assert.equal((await f.run()).status, 'association_changed');
    assert.equal(f.writes.length, 0);
  }
});
test('unknown stage is unmapped without writes', async () => {
  const f = fixture({ ...ticket, hs_pipeline_stage: 'unknown' }, recruit(ticket));
  assert.equal((await f.run()).status, 'unmapped');
  assert.equal(f.writes.length, 0);
});
