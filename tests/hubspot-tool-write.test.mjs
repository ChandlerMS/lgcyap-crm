import test from 'node:test';
import assert from 'node:assert/strict';
import { validateToolWriteInput, saveHubSpotToolRecord, handleHubSpotToolWriteRequest, toolWriteCapability, verifyToolWriteAccess, checkToolWriteCapability } from '../lib/hubspot-tool-write.mjs';
import { editableFields, toolEditValues } from '../lib/hubspot-tool-edit-config.mjs';
import { HUBSPOT_TOOL_CONFIG } from '../lib/hubspot-tools.mjs';
import { createPostgresLedger } from '../lib/hubspot-write.mjs';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const beforeTime = '2026-10-29T12:00:00.000Z', afterTime = '2026-10-29T12:01:00.000Z';
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', uuid2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = { userId: 'synthetic-user', email: 'editor@example.invalid' };
const token = 'synthetic-token', secret = 'synthetic-test-hmac-secret-at-least-32-characters';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function record(tool, changes = {}, id = '101') {
  const p = { ...Object.fromEntries([...HUBSPOT_TOOL_CONFIG[tool].fields, ...editableFields(tool).map(field => field.property)].map(key => [key, ''])), hs_lastmodifieddate: beforeTime, lastmodifieddate: beforeTime, hs_current_customer: 'yes', hs_pipeline: '924992938', hs_pipeline_stage: '1416243218', subject: 'Synthetic ticket', firstname: 'Synthetic', lastname: 'Person', name: 'Synthetic company', hs_task_subject: 'Synthetic task', hs_meeting_title: 'Synthetic meeting', hs_meeting_start_time: '2026-11-01T12:00:00Z', hs_meeting_end_time: '2026-11-01T13:00:00Z', ...changes };
  return { id, properties: p, updatedAt: p.lastmodifieddate || p.hs_lastmodifieddate };
}
function rawInput(tool, changes, requestId = uuid, before = record(tool)) { const values = toolEditValues(tool, before.properties); return { requestId, expectedUpdatedAt: beforeTime, expectedValues: Object.fromEntries(Object.keys(changes).map(key => [key, values[key] ?? ''])), changes }; }
const input = (tool, changes, requestId = uuid, before = record(tool)) => validateToolWriteInput(tool, '101', rawInput(tool, changes, requestId, before));
class Ledger {
  rows = new Map();
  async claim(value) { const key = value.userId + ':' + value.requestId, previous = this.rows.get(key); if (previous) return { acquired: false, hash: previous.hash, status: previous.status }; if ([...this.rows.values()].some(row => row.ticketId === value.ticketId && row.status === 'pending')) return { acquired: false, status: 'busy' }; this.rows.set(key, { ...value, status: 'pending' }); return { acquired: true }; }
  async finish(value) { const row = this.rows.get(value.userId + ':' + value.requestId); if (!row || row.status !== 'pending' || row.hash !== value.hash) return false; row.status = value.status; return true; }
  status(requestId = uuid) { return this.rows.get(user.userId + ':' + requestId)?.status; }
}
const grantInfo = { hubId: 50894788, appId: 59264745, scopes: ['contacts', 'tickets', 'companies'].flatMap(kind => [`crm.objects.${kind}.read`, `crm.objects.${kind}.write`]) };
const options = (fetchImpl, ledger = new Ledger()) => ({ userId: user.userId, accessToken: token, hmacSecret: secret, ledger, fetchImpl: async (url, init) => url.endsWith('/access-token-info') ? json(grantInfo) : fetchImpl(url, init), now: () => Date.parse(afterTime) });

test('wrong portal, app or per-tool grants fail before any record read, ledger claim or PATCH', async () => {
  for (const info of [{ ...grantInfo, hubId: 123 }, { ...grantInfo, appId: 59299825 }, { ...grantInfo, scopes: ['crm.objects.contacts.read'] }]) {
    let calls = 0; const ledger = new Ledger();
    await assert.rejects(saveHubSpotToolRecord(input('contacts', { firstname: 'Revised' }), { ...options(() => { throw Error('must not call'); }, ledger), fetchImpl: async (url, init) => {
      calls++; assert.equal(url, 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info'); assert.equal(init.redirect, 'manual'); assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body), { tokenKey: token }); return json(info);
    } }), { code: 'HUBSPOT_WRITE_ACCESS_REQUIRED' });
    assert.equal(calls, 1); assert.equal(ledger.rows.size, 0);
  }
  const contactsOnly = { ...grantInfo, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] };
  await assert.rejects(verifyToolWriteAccess('customer-success', { accessToken: token, fetchImpl: async () => json(contactsOnly) }), { code: 'HUBSPOT_WRITE_ACCESS_REQUIRED' });
});

test('valid credential-scoped introspection cache is short-lived and optional read capabilities fail closed', async () => {
  let calls = 0, time = 0;
  const fetchImpl = async (_url, init) => { calls++; assert.equal(init.headers.Authorization, `Bearer ${token}`); return json(grantInfo); };
  await verifyToolWriteAccess('contacts', { accessToken: token, fetchImpl, now: () => time });
  await verifyToolWriteAccess('tickets', { accessToken: token, fetchImpl, now: () => time }); assert.equal(calls, 1);
  time = 60001; await verifyToolWriteAccess('contacts', { accessToken: token, fetchImpl, now: () => time }); assert.equal(calls, 2);
  const enabled = { editorEmails: user.email, writesEnabled: 'true', vercel: '1', vercelEnv: 'production', ledger: new Ledger(), accessToken: token, hmacSecret: secret, fetchImpl: async () => json({ ...grantInfo, hubId: 123 }) };
  assert.equal(await checkToolWriteCapability('contacts', user, enabled), false);
});

test('only five tools and their approved editable properties are accepted; routing, creation and demo authority are rejected', () => {
  for (const tool of ['contacts', 'tickets', 'tasks', 'customer-success', 'meetings']) assert.ok(editableFields(tool).length > 0);
  for (const tool of ['calendar', 'calls', 'inbox', 'constructor']) assert.throws(() => input(tool, { subject: 'No' }));
  for (const changes of [{ hs_pipeline_stage: '1473318770' }, { hs_pipeline: '0' }, { licensing_branch: 'licensed' }, { recruiting_path: 'genpop' }, { properties: 'bad' }]) assert.throws(() => input('tickets', changes));
  assert.throws(() => input('customer-success', { hs_next_renewal_date: '2026-11-01' }));
  assert.throws(() => validateToolWriteInput('contacts', 'demo-101', rawInput('contacts', { firstname: 'Example' })));
  assert.throws(() => validateToolWriteInput('contacts', '101', { ...rawInput('contacts', { firstname: 'Example' }), isDemo: true }));
});

test('validation canonicalizes email/domain, keeps sparse expected values and rejects invalid enums, dates and unsupported authority', () => {
  assert.deepEqual(input('contacts', { email: ' Example@EXAMPLE.invalid ' }).changes, { email: 'example@example.invalid' });
  assert.deepEqual(input('customer-success', { domain: ' EXAMPLE.invalid ' }).changes, { domain: 'example.invalid' });
  for (const [tool, changes] of [['contacts', { email: 'bad' }], ['contacts', { firstname: 'bad\nname' }], ['customer-success', { domain: 'https://example.invalid' }], ['customer-success', { hs_csm_sentiment: 'constructor' }], ['tasks', { hs_task_status: 'UNKNOWN' }], ['tasks', { hs_timestamp: '2026-02-31T12:00:00.000Z' }], ['meetings', { hs_meeting_outcome: 'no_show' }], ['tickets', { hubspot_owner_id: '../123' }]]) assert.throws(() => input(tool, changes));
  assert.throws(() => validateToolWriteInput('contacts', '101', { ...rawInput('contacts', { firstname: 'Example' }), expectedValues: {} }));
});

test('each tool uses one sparse fixed PATCH and fresh confirmation, preserving other properties', async () => {
  for (const [tool, changes] of [['contacts', { firstname: 'Revised' }], ['tickets', { hs_ticket_priority: 'HIGH' }], ['tasks', { hs_task_status: 'COMPLETED' }], ['customer-success', { hs_csm_sentiment: 'healthy' }], ['meetings', { hs_meeting_location: 'New office' }]]) {
    const before = record(tool), after = record(tool, { ...changes, hs_lastmodifieddate: afterTime, lastmodifieddate: afterTime }); let calls = 0;
    const ledger = new Ledger(), result = await saveHubSpotToolRecord(input(tool, changes), options(async (url, init) => {
      calls++; const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.hubapi.com'); assert.equal(parsed.pathname, `/crm/v3/objects/${HUBSPOT_TOOL_CONFIG[tool].object}/101`); assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (calls === 2) { assert.equal(init.method, 'PATCH'); assert.deepEqual(JSON.parse(init.body), { properties: changes }); return json({ id: '101' }); }
      assert.equal(init.method, 'GET'); assert.ok(parsed.searchParams.get('properties').includes(Object.keys(changes)[0])); return json(calls === 1 ? before : after);
    }, ledger));
    assert.equal(calls, 3); assert.equal(result.status, 'saved'); assert.equal(result.requestId, uuid); assert.equal(result.record.updatedAt, afterTime); assert.equal(ledger.status(), 'saved');
    for (const [key, value] of Object.entries(changes)) assert.equal(result.record.editValues[key], value);
    const metadata = [...ledger.rows.values()][0]; assert.match(metadata.hash, /^[a-f0-9]{64}$/); assert.equal(metadata.ticketId, tool === 'tickets' ? '101' : `${HUBSPOT_TOOL_CONFIG[tool].object}:101`); assert.doesNotMatch(JSON.stringify(metadata), /Revised|New office|healthy|properties|synthetic-token/);
  }
});

test('fresh timestamp and reviewed raw-field changes block PATCH even when timestamps are equal', async () => {
  for (const before of [record('contacts', { lastmodifieddate: afterTime }), record('contacts', { firstname: 'Changed elsewhere' })]) {
    let calls = 0; const ledger = new Ledger();
    await assert.rejects(saveHubSpotToolRecord(input('contacts', { firstname: 'Revised' }), options(async () => { calls++; return json(before); }, ledger)), { code: 'RECORD_CHANGED' });
    assert.equal(calls, 1); assert.equal(ledger.status(), 'failed');
  }
});

test('saved request replay is read-only, changed payload reuse is blocked and shared ticket locks serialize recruiting edits', async () => {
  const ledger = new Ledger(), change = input('tickets', { subject: 'Revised ticket' }); let patch = 0;
  const fetchImpl = async (_url, init) => init.method === 'PATCH' ? (patch++, json({ id: '101' })) : json(record('tickets', patch ? { subject: 'Revised ticket', lastmodifieddate: afterTime, hs_lastmodifieddate: afterTime } : {}));
  await saveHubSpotToolRecord(change, options(fetchImpl, ledger));
  assert.equal((await saveHubSpotToolRecord(change, options(fetchImpl, ledger))).replayed, true); assert.equal(patch, 1);
  await assert.rejects(saveHubSpotToolRecord(input('tickets', { subject: 'Different' }), options(fetchImpl, ledger)), { code: 'REQUEST_ID_REUSED' });
  const busy = new Ledger(); await busy.claim({ userId: 'other-user', requestId: uuid2, ticketId: '101', hash: 'recruiting-pending-hash', now: 0 });
  await assert.rejects(saveHubSpotToolRecord(change, options(async () => { throw Error('must not call'); }, busy)), { code: 'SAVE_ALREADY_PROCESSED' });
});

test('existing PostgreSQL schema shares ticket locks and permits independent object-prefixed records without migration', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8'));
    const ledger = createPostgresLedger(db), time = Date.parse(afterTime);
    await ledger.claim({ userId: 'other-recruiting-editor', requestId: uuid2, ticketId: '101', hash: 'existing-recruiting-hash', now: time });
    await assert.rejects(saveHubSpotToolRecord(input('tickets', { subject: 'Revised' }), options(async () => { throw Error('must not read or PATCH locked ticket'); }, ledger)), { code: 'SAVE_ALREADY_PROCESSED' });
    const contact = await saveHubSpotToolRecord(input('contacts', { firstname: 'Synthetic' }), options(async () => json(record('contacts')), ledger));
    assert.equal(contact.unchanged, true);
    const found = await db.query('SELECT ticket_id,status,payload_hash FROM recruit_write_requests ORDER BY ticket_id');
    assert.deepEqual(found.rows.map(row => [row.ticket_id, row.status]), [['101', 'pending'], ['contacts:101', 'saved']]);
    assert.match(found.rows[1].payload_hash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(found.rows), /Synthetic|firstname|synthetic-token/);
  } finally { await db.close(); }
});

test('definite PATCH rejections are failed, transport/server/redirect/read-back ambiguity remains uncertain without retry', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 302]) {
    const ledger = new Ledger(); let calls = 0;
    await assert.rejects(saveHubSpotToolRecord(input('contacts', { firstname: 'Revised' }), options(async () => ++calls === 1 ? json(record('contacts')) : new Response('private-provider-body', { status }), ledger)), error => { assert.doesNotMatch(error.message, /private-provider-body/); return true; });
    assert.equal(calls, 2); assert.equal(ledger.status(), [500, 302].includes(status) ? 'uncertain' : 'failed');
  }
  for (const mode of ['network', 'wrong-id', 'unconfirmed']) {
    const ledger = new Ledger(); let calls = 0;
    await assert.rejects(saveHubSpotToolRecord(input('contacts', { firstname: 'Revised' }), options(async () => { calls++; if (calls === 1) return json(record('contacts')); if (mode === 'network') throw Error('private-network-error'); if (calls === 2) return json({ id: mode === 'wrong-id' ? '999' : '101' }); return json(record('contacts')); }, ledger)), { code: 'SAVE_UNCERTAIN' });
    assert.equal(ledger.status(), 'uncertain'); assert.ok(calls <= 3);
  }
});

test('meeting date edits validate the merged final range before PATCH', async () => {
  let calls = 0;
  await assert.rejects(saveHubSpotToolRecord(input('meetings', { hs_meeting_end_time: '2026-10-31T13:00:00.000Z' }), options(async () => { calls++; return json(record('meetings')); })), /Meeting end must follow/);
  assert.equal(calls, 1);
});

test('unchanged reviewed values never PATCH and an unconfirmed ledger finish cannot report success', async () => {
  let calls = 0;
  const noop = await saveHubSpotToolRecord(input('contacts', { firstname: 'Synthetic' }), options(async () => { calls++; return json(record('contacts')); }));
  assert.equal(noop.unchanged, true); assert.equal(calls, 1);
  let phases = 0; const ledger = new Ledger(); ledger.finish = async () => false;
  await assert.rejects(saveHubSpotToolRecord(input('contacts', { firstname: 'Revised' }), options(async (_url, init) => {
    phases++; return json(init.method === 'PATCH' ? { id: '101' } : record('contacts', phases > 1 ? { firstname: 'Revised', lastmodifieddate: afterTime, hs_lastmodifieddate: afterTime } : {}));
  }, ledger)), { code: 'SAVE_UNCERTAIN' });
  assert.equal(phases, 3); assert.equal(ledger.status(), 'pending');
});

test('a timed-out PATCH is aborted once and the same uncertain request cannot replay a provider mutation', async () => {
  let calls = 0; const ledger = new Ledger(), edit = input('contacts', { firstname: 'Revised' });
  await assert.rejects(saveHubSpotToolRecord(edit, { ...options(async (_url, init) => {
    calls++; if (init.method === 'GET') return json(record('contacts'));
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private-timeout')), { once: true }));
  }, ledger), timeoutMs: 5 }), { code: 'SAVE_UNCERTAIN' });
  assert.equal(calls, 2); assert.equal(ledger.status(), 'uncertain');
  await assert.rejects(saveHubSpotToolRecord(edit, options(async () => { calls++; throw Error('must not call'); }, ledger)), { code: 'SAVE_UNCERTAIN' });
  assert.equal(calls, 2);
});

test('production capability requires exact allowlist, enabled writes, credential, HMAC secret and durable ledger', () => {
  const enabled = { editorEmails: user.email, writesEnabled: 'true', vercel: '1', vercelEnv: 'production', ledger: new Ledger(), accessToken: token, hmacSecret: secret };
  assert.equal(toolWriteCapability('contacts', user, enabled), true);
  for (const patch of [{ editorEmails: 'other@example.invalid' }, { writesEnabled: 'false' }, { vercelEnv: 'preview' }, { vercel: undefined }, { hmacSecret: '' }, { accessToken: '' }, { ledger: undefined }]) assert.equal(toolWriteCapability('contacts', user, { ...enabled, ...patch }), false);
  assert.equal(toolWriteCapability('calls', user, enabled), false);
});

test('write HTTP boundary denies anonymous, previews, forged origins, oversized bodies and demo payloads before saving', async () => {
  let calls = 0;
  const enabled = { getUser: () => user, editorEmails: user.email, writesEnabled: 'true', vercel: '1', vercelEnv: 'production', ledger: new Ledger(), accessToken: token, hmacSecret: secret, allowedOrigin: 'https://private.example', saveData: async () => { calls++; return {}; } };
  const make = (body = JSON.stringify(rawInput('contacts', { firstname: 'Revised' })), origin = 'https://private.example') => new Request('https://private.example/api/hubspot-tools/contacts/101', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
  assert.equal((await handleHubSpotToolWriteRequest(make(), 'contacts', '101', { ...enabled, getUser: () => null })).status, 401);
  assert.equal((await handleHubSpotToolWriteRequest(make(), 'contacts', '101', { ...enabled, vercelEnv: 'preview' })).status, 403);
  assert.equal((await handleHubSpotToolWriteRequest(make(undefined, 'https://attacker.invalid'), 'contacts', '101', enabled)).status, 403);
  assert.equal((await handleHubSpotToolWriteRequest(make(' '.repeat(8193)), 'contacts', '101', enabled)).status, 413);
  assert.equal((await handleHubSpotToolWriteRequest(make(JSON.stringify({ ...rawInput('contacts', { firstname: 'Revised' }), isDemo: true })), 'contacts', '101', enabled)).status, 400);
  assert.equal(calls, 0);
  const success = await handleHubSpotToolWriteRequest(make(), 'contacts', '101', enabled); assert.equal(success.status, 200); assert.equal(calls, 1); assert.match(success.headers.get('Cache-Control'), /private, no-store/);
});
