import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { inactivityPeriod, followUpTask, reconcileNoContact, taskMarker } from '../lib/no-contact-tasks.mjs';
import { NO_CONTACT_SCHEMA, noContactStore } from '../db/no-contact-tasks.mjs';
import { noContactEnabled } from '../lib/no-contact-job.mjs';
const DAY = 86400000, now = Date.parse('2026-11-19T18:00:00Z');
const recruit = { id: '123', name: 'Synthetic Recruit', contactId: '456', contactStatus: 'available', stage: 'Training', createdAt: new Date(now - 20 * DAY).toISOString(), lastContactedAt: new Date(now - 16 * DAY).toISOString() };

async function fixture(run) {
 const db = new PGlite();
 try { await db.exec(NO_CONTACT_SCHEMA); await db.exec(NO_CONTACT_SCHEMA); await run(noContactStore(db), db); } finally { await db.close(); }
}
test('strictly more than 15 days qualifies at every stage, including never contacted, but unknown contact data does not', () => {
 for (const stage of ['Hiring Event','Application','Phone Interview','Offer','Licensing','Contracting','Training','Completed','Rejected','Withdrawn']) assert.equal(inactivityPeriod({ ...recruit, stage }, now).days, 16);
 assert.equal(inactivityPeriod({ ...recruit, lastContactedAt: new Date(now - 15 * DAY).toISOString() }, now), null);
 assert.ok(inactivityPeriod({ ...recruit, lastContactedAt: new Date(now - 15 * DAY - 1).toISOString() }, now));
 assert.equal(inactivityPeriod({ ...recruit, lastContactedAt: null }, now).days, 20);
 for (const contactStatus of ['unavailable','ambiguous']) assert.equal(inactivityPeriod({ ...recruit, contactStatus }, now), null);
});
test('tasks are unassigned, in Follow up, linked to both recruit and contact, and escape recorded stage', () => {
 const period = inactivityPeriod(recruit, now), task = followUpTask({ ...recruit, stage: '<script>' }, period, now);
 assert.equal(task.properties.hubspot_owner_id, undefined);
 assert.equal(task.properties.hs_queue_membership_ids, '12956231');
 assert.deepEqual(task.associations.map(item => item.to.id), ['123','456']);
 assert.ok(task.properties.hs_task_body.includes(taskMarker('123', period.since)));
 assert.ok(task.properties.hs_task_body.includes('&lt;script&gt;'));
});
test('only one task is created per inactivity period and new contact completes it before a later period creates another', () => fixture(async (store) => {
 const created = [], completed = [];
 const provider = { create: async body => { created.push(body); return { id: String(900 + created.length) }; }, find: async () => [], complete: async id => completed.push(id) };
 assert.equal((await reconcileNoContact(recruit, { now, store, provider })).status, 'created');
 assert.equal((await reconcileNoContact(recruit, { now, store, provider })).status, 'already_recorded');
 const contacted = { ...recruit, lastContactedAt: new Date(now).toISOString() };
 assert.equal((await reconcileNoContact(contacted, { now, store, provider })).status, 'current');
 assert.deepEqual(completed, ['901']);
 assert.equal((await reconcileNoContact(contacted, { now: now + 16 * DAY, store, provider })).status, 'created');
 assert.equal(created.length, 2);
}));
test('an interrupted POST is not repeated; finding its existing HubSpot task reconciles it', () => fixture(async (store) => {
 let writes = 0, found = [];
 const provider = { create: async () => { writes++; throw new Error('connection lost'); }, find: async () => found, complete: async () => {} };
 assert.equal((await reconcileNoContact(recruit, { now, store, provider })).status, 'uncertain');
 assert.equal((await reconcileNoContact(recruit, { now, store, provider })).status, 'uncertain');
 assert.equal(writes, 1);
 found = [{ id: '999' }];
 assert.equal((await reconcileNoContact(recruit, { now, store, provider })).status, 'already_recorded');
 assert.equal((await store.periods('123'))[0].taskId, '999');
 assert.equal(writes, 1);
}));
test('durable claims reject competing workers for the same recruit and period', () => fixture(async (store) => {
 const since = inactivityPeriod(recruit, now).since;
 assert.deepEqual(await Promise.all([store.claim('123', since), store.claim('123', since)]), [true, false]);
}));
test('automation writes are production-only and honor the existing write switch and explicit disable', () => {
 const env = { VERCEL: '1', VERCEL_ENV: 'production', RECRUITING_WRITES_ENABLED: 'true' };
 assert.equal(noContactEnabled(env), true);
 for (const change of [{ VERCEL_ENV: 'preview' }, { RECRUITING_WRITES_ENABLED: 'false' }, { RECRUITING_NO_CONTACT_TASKS_ENABLED: 'false' }]) assert.equal(noContactEnabled({ ...env, ...change }), false);
});

test('a definite rate-limit rejection retries after backoff without treating it as an ambiguous write', () => fixture(async (store) => {
 let calls = 0;
 const provider = { create: async () => { calls++; if (calls === 1) throw Object.assign(new Error('429'), { definite: true, retryAfterMs: 60000 }); return { id: '999' }; }, find: async () => [], complete: async () => {} };
 assert.equal((await reconcileNoContact(recruit, { now, store, provider })).status, 'retryable');
 assert.equal((await reconcileNoContact(recruit, { now: now + 1000, store, provider })).status, 'already_recorded');
 assert.equal(calls, 1);
 assert.equal((await reconcileNoContact(recruit, { now: now + 61000, store, provider })).status, 'created');
 assert.equal(calls, 2);
}));

test('queue validation accepts external queue options without requiring embedded enum values', async () => {
 const { noContactProvider } = await import('../lib/no-contact-provider.mjs');
 const provider = noContactProvider({ accessToken: 'synthetic', deadline: now + 10000, clock: () => now, fetchImpl: async () => Response.json({ name: 'hs_queue_membership_ids', type: 'enumeration', externalOptions: true, options: [] }) });
 await provider.verifyQueue();
});
