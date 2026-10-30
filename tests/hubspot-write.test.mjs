import test from 'node:test';
import assert from 'node:assert/strict';
import { editorAllowed, hostingAllowsWrites, handleRecruitWriteRequest, saveRecruit, validateWriteInput, writeCapability } from '../lib/hubspot-write.mjs';
import { EDITABLE_PROPERTIES, EDIT_FIELDS } from '../lib/recruit-edit-config.mjs';
import { PIPELINE_ID, RECRUIT_PROPERTIES } from '../lib/recruiting-config.mjs';

const beforeTime = '2026-10-29T12:00:00.000Z';
const afterTime = '2026-10-29T12:01:00.000Z';
const clock = () => Date.parse(afterTime);
const id1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = { userId: 'synthetic-user', email: 'editor@example.invalid' };
const credential = 'synthetic-provider-credential';
const record = (properties = {}, id = '101') => ({ id, properties: {
  hs_pipeline: PIPELINE_ID, hs_pipeline_stage: '1416243212', hs_lastmodifieddate: beforeTime,
  recruit_name: 'Synthetic Recruit', subject: 'Recruiting: Synthetic Recruit', orientation_office: 'orlando',
  intake_license_status: 'unlicensed', recruit_type: 'in-house_recruit', orientation_registered: 'true',
  orientation_date: '2026-10-31', ...properties,
} });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const rawInput = (changes = { orientation_office: 'miami' }, requestId = id1) => ({ expectedUpdatedAt: beforeTime, expectedValues: Object.fromEntries(Object.keys(changes).map(property => [property, String(record().properties[property] ?? '')])), requestId, changes });
const input = (changes = { orientation_office: 'miami' }, requestId = id1) => validateWriteInput('101', rawInput(changes, requestId));

class MemoryLedger {
  rows = new Map();
  async claim(value) {
    const key = `${value.userId}:${value.requestId}`;
    const prior = this.rows.get(key);
    if (prior) return { acquired: false, hash: prior.hash, status: prior.status };
    if ([...this.rows.values()].some(row => row.ticketId === value.ticketId && row.status === 'pending')) return { acquired: false, status: 'busy' };
    this.rows.set(key, { ...value, status: 'pending' }); return { acquired: true };
  }
  async finish(value) {
    const row = this.rows.get(`${value.userId}:${value.requestId}`);
    if (!row || row.hash !== value.hash || row.status !== 'pending') return false;
    row.status = value.status; return true;
  }
  status(requestId = id1) { return this.rows.get(`${user.userId}:${requestId}`)?.status; }
}

function options(fetchImpl, ledger = new MemoryLedger()) { return { userId: user.userId, accessToken: credential, ledger, fetchImpl, now: clock }; }
function sequence(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init }); const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error('Unexpected provider call');
    return typeof response === 'function' ? response(url, init) : response;
  };
  return { fetchImpl, calls };
}

test('validation allows exactly the editable properties and preserves independent name/title edits', () => {
  assert.equal(EDITABLE_PROPERTIES.length, 12);
  assert.deepEqual(input({ recruit_name: '  Revised Name  ' }).changes, { recruit_name: 'Revised Name' });
  assert.deepEqual(input({ orientation_registered: '', orientation_date: '' }).changes, { orientation_date: '', orientation_registered: '' });
  for (const changes of [{ hs_pipeline: '0' }, { email: 'forbidden' }, { hs_pipeline_stage: '4' }, { orientation_date: '2026-02-31' }, { orientation_office: 'MIAMI' }, { orientation_registered: true }, { recruit_name: '' }, { subject: 'Bad\nTitle' }, {}]) {
    assert.throws(() => input(changes), /./);
  }
  for (const id of ['0', '../101', '101?properties=all', 'x']) assert.throws(() => validateWriteInput(id, input()), /valid recruiting record/);
  assert.throws(() => validateWriteInput('101', { ...rawInput(), extra: 'authority' }), /invalid/);
  assert.throws(() => validateWriteInput('101', { ...rawInput(), expectedUpdatedAt: '2026-02-31T12:00:00.000Z' }), /Refresh/);
  for (const expectedValues of [undefined, {}, { extra: 'wrong key' }, { orientation_office: true }, { orientation_office: 'x'.repeat(201) }]) assert.throws(() => validateWriteInput('101', { ...rawInput(), expectedValues }), /Refresh/);
});

test('stage edits accept the migrated pipeline and reject retired or foreign stages', () => {
  const ids = ['1473225367', '1473225368', '1416243212', '1416243213', '1416243216', '1416243214', '1416243217', '1416243218'];
  assert.deepEqual(EDIT_FIELDS.find(field => field.property === 'hs_pipeline_stage').options.map(option => option.value), ids);
  for (const stageId of ids) assert.equal(input({ hs_pipeline_stage: stageId }).changes.hs_pipeline_stage, stageId);
  for (const stageId of ['1416243215', '1416243219', '4', 'Recruits']) assert.throws(() => input({ hs_pipeline_stage: stageId }));
});

test('only the explicitly allowed trusted identity with enabled writes and a database can edit', () => {
  const ledger = new MemoryLedger();
  assert.equal(editorAllowed(user, 'EDITOR@example.invalid'), true);
  assert.equal(editorAllowed({ userId: 'synthetic-user' }, user.email), false);
  assert.equal(writeCapability(user, { editorEmails: user.email, writesEnabled: 'true', ledger, vercel: '1', vercelEnv: 'production' }), true);
  assert.equal(writeCapability(user, { editorEmails: user.email, writesEnabled: 'false', ledger }), false);
  assert.equal(writeCapability(user, { editorEmails: user.email, writesEnabled: 'true' }), false);
});

test('sends one sparse PATCH to the fixed provider and confirms saved state through a fresh GET', async () => {
  const provider = sequence([json(record()), json({ id: '101' }), json(record({ orientation_office: 'miami', hs_lastmodifieddate: afterTime }))]);
  const opts = options(provider.fetchImpl); const result = await saveRecruit(input(), opts);
  assert.equal(result.status, 'saved'); assert.equal(result.recruit.office, 'Miami'); assert.equal(opts.ledger.status(), 'saved');
  assert.deepEqual(provider.calls.map(call => call.init.method), ['GET', 'PATCH', 'GET']);
  for (const call of provider.calls) {
    const url = new URL(call.url); assert.equal(url.origin, 'https://api.hubapi.com'); assert.equal(url.pathname, '/crm/v3/objects/tickets/101');
    assert.equal(call.init.redirect, 'manual'); assert.equal(call.init.headers.Authorization, `Bearer ${credential}`);
  }
  assert.deepEqual(JSON.parse(provider.calls[1].init.body), { properties: { orientation_office: 'miami' } });
  assert.deepEqual(new URL(provider.calls[0].url).searchParams.get('properties').split(','), RECRUIT_PROPERTIES);
  assert.equal(result.recruit.name, 'Synthetic Recruit');
});

test('out-of-pipeline records and stale versions never reach PATCH and settle the request as failed', async () => {
  for (const [raw, code] of [[record({ hs_pipeline: '0' }), 'RECORD_NOT_FOUND'], [record({ hs_lastmodifieddate: afterTime }), 'RECORD_CHANGED'], [record({}, '999'), 'RECORD_NOT_FOUND']]) {
    const provider = sequence([json(raw)]); const opts = options(provider.fetchImpl);
    await assert.rejects(saveRecruit(input(), opts), error => error.code === code);
    assert.equal(provider.calls.length, 1); assert.equal(opts.ledger.status(), 'failed');
  }
});

test('identical current values are confirmed without performing a mutation', async () => {
  const provider = sequence([json(record())]); const opts = options(provider.fetchImpl);
  const result = await saveRecruit(input({ orientation_office: 'orlando' }), opts);
  assert.equal(result.unchanged, true); assert.equal(provider.calls.length, 1); assert.equal(opts.ledger.status(), 'saved');
});

test('changed reviewed field values block PATCH even if the provider timestamp stayed the same', async () => {
  const provider = sequence([json(record({ orientation_office: 'tampa' }))]);
  const opts = options(provider.fetchImpl);
  await assert.rejects(saveRecruit(input(), opts), error => error.code === 'RECORD_CHANGED');
  assert.equal(provider.calls.length, 1); assert.equal(opts.ledger.status(), 'failed');
});

test('a saved duplicate returns a fresh record without replaying PATCH, while changed payload reuse is rejected', async () => {
  const provider = sequence([json(record()), json({ id: '101' }), json(record({ orientation_office: 'miami', hs_lastmodifieddate: afterTime })), json(record({ orientation_office: 'tampa', hs_lastmodifieddate: afterTime }))]);
  const opts = options(provider.fetchImpl); await saveRecruit(input(), opts);
  const repeated = await saveRecruit(input(), opts);
  assert.equal(repeated.replayed, true); assert.equal(repeated.recruit.office, 'Tampa');
  assert.equal(provider.calls.filter(call => call.init.method === 'PATCH').length, 1);
  await assert.rejects(saveRecruit(input({ orientation_office: 'tampa' }), opts), error => error.code === 'REQUEST_ID_REUSED');
  assert.equal(provider.calls.length, 4);
});

test('concurrent requests for the same record cannot both reach the provider mutation', async () => {
  let release; const firstRead = new Promise(resolve => { release = resolve; });
  const provider = sequence([() => firstRead, json({ id: '101' }), json(record({ orientation_office: 'miami', hs_lastmodifieddate: afterTime }))]);
  const opts = options(provider.fetchImpl); const first = saveRecruit(input(), opts);
  while (!provider.calls.length) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(saveRecruit(input({ orientation_office: 'tampa' }, id2), opts), error => error.code === 'SAVE_ALREADY_PROCESSED');
  release(json(record())); await first;
  assert.equal(provider.calls.filter(call => call.init.method === 'PATCH').length, 1);
});

test('definite provider rejections are not retried and failed request IDs cannot be reused', async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const provider = sequence([json(record()), json({ secret: 'provider-details' }, status, { 'Retry-After': '120' })]);
    const opts = options(provider.fetchImpl);
    await assert.rejects(saveRecruit(input(), opts), error => status === 429 ? error.retryAfterSeconds === 120 : !error.uncertain);
    assert.equal(opts.ledger.status(), 'failed');
    await assert.rejects(saveRecruit(input(), opts), error => error.code === 'SAVE_ALREADY_PROCESSED');
    assert.equal(provider.calls.length, 2);
  }
});

test('ambiguous transport, server errors, redirects and malformed acknowledgements remain uncertain with no replay', async () => {
  for (const reply of [new Error('sensitive transport internals'), json({}, 500), json({}, 307), new Response('not-json'), json({ id: '999' })]) {
    const provider = sequence([json(record()), reply]); const opts = options(provider.fetchImpl);
    await assert.rejects(saveRecruit(input(), opts), error => error.code === 'SAVE_UNCERTAIN' && !error.message.includes('sensitive'));
    assert.equal(opts.ledger.status(), 'uncertain');
    await assert.rejects(saveRecruit(input(), opts), error => error.code === 'SAVE_UNCERTAIN');
    assert.equal(provider.calls.length, 2);
  }
});

test('failed or mismatched read-back cannot claim a successful save', async () => {
  for (const reply of [json({}, 503), json(record({ orientation_office: 'tampa', hs_lastmodifieddate: afterTime })), json(record({ hs_pipeline: '0' }))]) {
    const provider = sequence([json(record()), json({ id: '101' }), reply]); const opts = options(provider.fetchImpl);
    await assert.rejects(saveRecruit(input(), opts), error => error.code === 'SAVE_UNCERTAIN');
    assert.equal(opts.ledger.status(), 'uncertain'); assert.equal(provider.calls.length, 3);
  }
});

test('a timed-out PATCH is aborted once and remains uncertain', async () => {
  let patchCalls = 0;
  const opts = options(async (_url, init) => {
    if (init.method === 'GET') return json(record());
    patchCalls += 1;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout'))));
  });
  await assert.rejects(saveRecruit(input(), { ...opts, timeoutMs: 5 }), error => error.code === 'SAVE_UNCERTAIN');
  assert.equal(patchCalls, 1); assert.equal(opts.ledger.status(), 'uncertain');
});

function request(body = JSON.stringify(rawInput()), headers = {}, method = 'POST') {
  return new Request('https://private.example/api/recruits/101', { method, headers: { Origin: 'https://private.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body }) });
}
function boundary(overrides = {}) {
  let calls = 0;
  return { options: { getUser: () => user, editorEmails: user.email, writesEnabled: 'true', ledger: new MemoryLedger(), vercel: '1', vercelEnv: 'production', allowedOrigin: 'https://private.example', saveData: async () => { calls += 1; return { status: 'saved' }; }, ...overrides }, calls: () => calls };
}

test('the request boundary blocks anonymous, non-editor, disabled, cross-origin and non-POST requests before any save', async () => {
  const cases = [
    [request(), { getUser: () => null }, 401], [request(), { editorEmails: 'someone-else@example.invalid' }, 403],
    [request(), { writesEnabled: 'false' }, 403], [request(), { ledger: undefined }, 403],
    [request(undefined, { Origin: 'https://elsewhere.invalid' }), {}, 403], [request(undefined, {}, 'GET'), {}, 405],
  ];
  for (const [req, config, status] of cases) {
    const fixture = boundary(config); const response = await handleRecruitWriteRequest(req, '101', fixture.options);
    assert.equal(response.status, status); assert.equal(fixture.calls(), 0); assert.match(response.headers.get('cache-control'), /private, no-store/);
  }
});

test('invalid bodies and unsupported authority are rejected before any save', async () => {
  for (const [body, headers, status] of [
    ['{', {}, 400], [JSON.stringify({ ...rawInput(), portalId: 'attacker-selected' }), {}, 400],
    [JSON.stringify({ ...rawInput(), changes: { hs_pipeline: '0' } }), {}, 400],
    [JSON.stringify(rawInput()), { 'Content-Type': 'text/plain' }, 415], [' '.repeat(8193), {}, 413],
  ]) {
    const fixture = boundary(); const response = await handleRecruitWriteRequest(request(body, headers), '101', fixture.options);
    assert.equal(response.status, status); assert.equal(fixture.calls(), 0);
  }
});

test('the authenticated valid boundary passes only validated changes and redacts unexpected exceptions', async () => {
  const fixture = boundary({ saveData: async (value, identity) => { assert.deepEqual(value, input()); assert.equal(identity.userId, user.userId); return { status: 'saved' }; } });
  const response = await handleRecruitWriteRequest(request(), '101', fixture.options);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'saved' });
  const failed = await handleRecruitWriteRequest(request(), '101', boundary({ saveData: async () => { throw new Error('credential secret'); } }).options);
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /credential secret/);
});

test('Vercel previews cannot acquire write capability even when the write flag is true', () => {
  const base = { editorEmails: user.email, writesEnabled: 'true', ledger: new MemoryLedger() };
  for (const environment of [{}, { vercel: '1', vercelEnv: 'preview' }, { vercel: '1', vercelEnv: 'development' }, { vercel: '1' }, { vercelEnv: 'preview' }, { vercelEnv: 'production' }]) {
    assert.equal(hostingAllowsWrites(environment), false);
    assert.equal(writeCapability(user, { ...base, ...environment }), false);
  }
  assert.equal(writeCapability(user, { ...base, vercel: '1', vercelEnv: 'production' }), true);
  assert.equal(writeCapability(user, base), false);
});

test('preview and forged-host requests are blocked before a save', async () => {
  for (const [req, overrides] of [
    [request(), { vercel: '1', vercelEnv: 'preview' }],
    [new Request('https://attacker.invalid/api/recruits/101', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(rawInput()) }), {}],
    [request(), { allowedOrigin: undefined }],
  ]) {
    const fixture = boundary(overrides);
    assert.equal((await handleRecruitWriteRequest(req, '101', fixture.options)).status, 403);
    assert.equal(fixture.calls(), 0);
  }
});
