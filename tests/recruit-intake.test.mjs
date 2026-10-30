import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createRecruitIntakePostgresLedger, createRecruitIntake, checkRecruitIntakeCapability, handleRecruitIntakeRequest } from '../lib/recruit-intake.mjs';
import { normalizeRecruitIntakeRow, validateRecruitIntakeInput } from '../lib/recruit-intake-input.mjs';

const migration = await readFile(new URL('../migrations/0003_recruit_intake.sql', import.meta.url), 'utf8');
const one = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', two = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', three = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const user = { userId: 'synthetic-user', email: 'editor@example.invalid' };
const input = { requestId: one, firstName: 'Synthetic', lastName: 'Recruit', phone: '(407) 555-0123', email: 'example@example.invalid', recruitingPath: 'genpop' };
const secret = 'synthetic-only-recruit-intake-hmac-key-0123456789';
const origin = 'https://recruiting.example.invalid';
const clock = () => 1700000000000;
const scopes = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write'];
const access = { hubId: 50894788, appId: 59264745, scopes };
const labels = { results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 16 }, { category: 'USER_DEFINED', label: 'Synthetic custom label', typeId: 999 }] };
const contact = (id = '123', overrides = {}) => ({ id, properties: { firstname: 'Synthetic', lastname: 'Recruit', phone: '+14075550123', mobilephone: null, email: input.email, ...overrides } });
const ticket = (id = '456', overrides = {}) => ({ id, properties: { subject: 'Recruiting: Synthetic Recruit', recruit_name: 'Synthetic Recruit', hs_pipeline: '924992938', hs_pipeline_stage: '1473318768', recruiting_path: 'genpop', ...overrides }, associations: { contacts: { results: [{ id: '123', type: 'ticket_to_contact' }] } } });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function fixture() { const db = new PGlite(); await db.exec(migration); return { db, ledger: createRecruitIntakePostgresLedger(db) }; }
function options(ledger, fetchImpl) { return { userId: user.userId, accessToken: 'synthetic-token', hmacSecret: secret, ledger, fetchImpl, now: clock }; }
function provider(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    assert.equal(new URL(url).origin, 'https://api.hubapi.com');
    assert.equal(url.includes('synthetic-token'), false); assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
    const reply = replies.shift(); if (reply instanceof Error) throw reply;
    assert.ok(reply instanceof Response, `unexpected provider call ${new URL(url).pathname}`); return reply;
  };
  return { fetchImpl, calls };
}
function newReplies() { return [json(access), json(labels), json({ total: 0, results: [] }), json({ total: 0, results: [] }), json({ id: '123' }, 201), json(contact()), json({ results: [] }), json({ id: '456' }, 201), json(ticket())]; }

test('intake input normalizes contact fields and an explicitly selected recruiting path; rejects unsupported authority', () => {
  assert.deepEqual(normalizeRecruitIntakeRow({ firstName: ' Synthetic ', lastName: 'Recruit', phone: '407.555.0123', email: ' EXAMPLE@Example.Invalid ', recruitingPath: 'genpop' }), { firstName: 'Synthetic', lastName: 'Recruit', phone: '+14075550123', email: 'example@example.invalid', recruitingPath: 'genpop' });
  assert.equal(validateRecruitIntakeInput({ ...input, email: '' }).email, '');
  for (const change of [{ email: 'bad\nmail@example.invalid' }, { firstName: '' }, { firstName: 'a'.repeat(101) }, { phone: '4075550123 ext2' }, { email: true }, { hs_pipeline_stage: '4' }, { licensed: true }, { requestId: 'bad' }]) assert.throws(() => validateRecruitIntakeInput({ ...input, ...change }), { code: 'INVALID_INTAKE' });
  assert.throws(() => normalizeRecruitIntakeRow({ ...input }), { code: 'INVALID_INTAKE' });
});

test('every intake row requires a canonical path and never guesses a default', () => {
  for (const recruitingPath of [undefined, null, '', 'Referrals', 'genpop ', 'mass recruiting', 'in-house_recruit', true]) {
    assert.throws(() => validateRecruitIntakeInput({ ...input, recruitingPath }), error =>
      error.code === 'INVALID_INTAKE' && error.fieldErrors.recruitingPath === 'Choose Referrals or Recruiters for this recruit.');
  }
  assert.equal(validateRecruitIntakeInput({ ...input, recruitingPath: 'mass_recruiting' }).recruitingPath, 'mass_recruiting');
});

test('payload HMAC binds the selected path in v2 while identity indexes and key fingerprints stay v1', async () => {
  const claims = [];
  const ledger = { claim: async claim => { claims.push(claim); return { acquired: false, status: 'pending' }; }, finish: async () => true };
  for (const recruitingPath of ['genpop', 'mass_recruiting']) {
    await assert.rejects(createRecruitIntake({ ...input, recruitingPath }, options(ledger, () => { throw Error('No provider calls expected'); })), { code: 'INTAKE_IN_PROGRESS' });
  }
  assert.notEqual(claims[0].hash, claims[1].hash);
  assert.equal(claims[0].hash, createHmac('sha256', secret).update('legacy-recruit-intake:payload:v2\0').update(JSON.stringify(['Synthetic', 'Recruit', '+14075550123', 'example@example.invalid', 'genpop'])).digest('hex'));
  for (const claim of claims) {
    assert.equal(claim.phoneHash, createHmac('sha256', secret).update('legacy-recruit-intake:phone:v1\0').update('+14075550123').digest('hex'));
    assert.equal(claim.emailHash, createHmac('sha256', secret).update('legacy-recruit-intake:email:v1\0').update('example@example.invalid').digest('hex'));
    assert.equal(claim.keyHash, createHmac('sha256', secret).update('legacy-recruit-intake:key:v1\0').update('singleton').digest('hex'));
  }
});

test('legacy payloads require reconciliation and cannot acquire a path through replay or resume', async () => {
  for (const status of ['created', 'needs_ticket']) {
    for (const source of ['request', 'identity']) {
      const oldHash = createHmac('sha256', secret).update('legacy-recruit-intake:payload:v1\0').update(JSON.stringify(['Synthetic', 'Recruit', '+14075550123', 'example@example.invalid'])).digest('hex');
      let providerCalls = 0, finishes = 0;
      const ledger = { claim: async () => ({ acquired: false, source, hash: oldHash, status, contactId: '123', ticketId: status === 'created' ? '456' : null }), finish: async () => { finishes++; return true; } };
      await assert.rejects(createRecruitIntake(input, options(ledger, () => { providerCalls++; throw Error('No writes expected'); })), { code: 'INTAKE_RECONCILIATION_REQUIRED', status: 409 });
      assert.equal(providerCalls, 0); assert.equal(finishes, 0);
    }
  }
});

test('intake migration repeats and atomically claims both phone and email without storing PII', async () => {
  const { db, ledger } = await fixture();
  try {
    await db.exec(migration);
    const claim = { userId: 'a', requestId: one, hash: 'payload-hmac', phoneHash: 'phone-hmac', emailHash: 'email-hmac', keyHash: 'key-hmac', now: clock() };
    const outcomes = await Promise.all([ledger.claim(claim), createRecruitIntakePostgresLedger(db).claim({ ...claim, userId: 'b', requestId: two, phoneHash: 'other-phone' })]);
    assert.equal(outcomes.filter(result => result.acquired).length, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM recruit_intake_requests')).rows[0].count, 1);
    const owner = (await db.query('SELECT * FROM recruit_intake_requests')).rows[0];
    const aged = await ledger.claim({ ...claim, userId: owner.user_id, requestId: owner.request_id, phoneHash: owner.phone_hash, now: clock() + 120001 });
    assert.equal(aged.status, 'uncertain');
    assert.equal(await ledger.finish({ ...claim, userId: owner.user_id, requestId: owner.request_id, from: 'pending', status: 'failed', now: clock() + 120001 }), false);
    await assert.rejects(ledger.claim({ ...claim, keyHash: 'changed-key', requestId: three }), { code: 'INTAKE_UNAVAILABLE' });
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='recruit_intake_requests' ORDER BY ordinal_position")).rows.map(row => row.column_name);
    assert.deepEqual(columns, ['user_id', 'request_id', 'phone_hash', 'email_hash', 'payload_hash', 'status', 'contact_id', 'ticket_id', 'created_at', 'updated_at']);
    await assert.rejects(db.query("UPDATE recruit_intake_requests SET status='bad-state'"), /check constraint/);
  } finally { await db.close(); }
});

test('one submission confirms Contact, creates Ticket with discovered association and replays without writes', async () => {
  const { db, ledger } = await fixture();
  try {
    const { fetchImpl, calls } = provider(newReplies());
    const result = await createRecruitIntake(input, options(ledger, fetchImpl));
    assert.equal(result.status, 'created'); assert.equal(result.contact.id, '123'); assert.equal(result.recruit.id, '456');
    const writes = calls.filter(call => call.method === 'POST' && !new URL(call.url).pathname.endsWith('/search') && !call.url.includes('access-token-info'));
    assert.equal(writes.length, 2);
    assert.deepEqual(JSON.parse(writes[0].body), { properties: { firstname: 'Synthetic', lastname: 'Recruit', phone: '+14075550123', email: input.email } });
    assert.deepEqual(JSON.parse(writes[1].body), { properties: ticket().properties, associations: [{ to: { id: '123' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }] }] });
    assert.ok(calls.some(call => new URL(call.url).pathname === '/crm/v4/associations/tickets/contacts/labels'));
    const replay = await createRecruitIntake({ ...input, phone: '+1 (407) 555-0123' }, options(createRecruitIntakePostgresLedger(db), fetchImpl));
    assert.equal(replay.replayed, true); assert.equal(calls.length, 9);
    const duplicate = await createRecruitIntake({ ...input, requestId: two }, { ...options(ledger, fetchImpl), userId: 'other-user' });
    assert.equal(duplicate.status, 'already_exists'); assert.equal(calls.length, 9);
    await assert.rejects(createRecruitIntake({ ...input, lastName: 'Changed' }, options(ledger, fetchImpl)), { code: 'REQUEST_ID_REUSED' });
    await assert.rejects(createRecruitIntake({ ...input, recruitingPath: 'mass_recruiting' }, options(ledger, fetchImpl)), { code: 'REQUEST_ID_REUSED' });
    assert.equal(calls.length, 9);
    const metadata = JSON.stringify((await db.query('SELECT * FROM recruit_intake_requests')).rows);
    for (const privateValue of ['Synthetic', '4075550123', 'example@example.invalid', 'synthetic-token']) assert.equal(metadata.includes(privateValue), false);
  } finally { await db.close(); }
});

test('each explicitly chosen intake path starts in its bound entry stage without inventing a license branch', async () => {
  for (const [recruitingPath, stageId] of [['genpop', '1473318768'], ['mass_recruiting', '1473318769']]) {
    const { db, ledger } = await fixture();
    try {
      const replies = newReplies(); replies[8] = json(ticket('456', { hs_pipeline_stage: stageId, recruiting_path: recruitingPath }));
      const { fetchImpl, calls } = provider(replies);
      await createRecruitIntake({ ...input, recruitingPath }, options(ledger, fetchImpl));
      const properties = JSON.parse(calls.find(call => new URL(call.url).pathname === '/crm/v3/objects/tickets').body).properties;
      assert.equal(properties.hs_pipeline_stage, stageId);
      assert.equal(properties.recruiting_path, recruitingPath);
      assert.equal(Object.hasOwn(properties, 'licensing_branch'), false);
      assert.equal(Object.hasOwn(properties, 'intake_license_status'), false);
    } finally { await db.close(); }
  }
});

test('intake cannot report success if fresh Ticket confirmation lacks the selected path or entry stage', async () => {
  for (const mismatch of [{ recruiting_path: '' }, { recruiting_path: 'mass_recruiting' }, { hs_pipeline_stage: '1473318769' }]) {
    const { db, ledger } = await fixture();
    try {
      const replies = newReplies(); replies[8] = json(ticket('456', mismatch));
      const { fetchImpl, calls } = provider(replies);
      await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
      assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/tickets').length, 1);
    } finally { await db.close(); }
  }
});

test('exact existing Contact and recruiting association return already_exists without overwrites or stage moves', async () => {
  const { db, ledger } = await fixture();
  try {
    const { fetchImpl, calls } = provider([
      json(access), json(labels), json({ total: 1, results: [contact()] }), json({ total: 1, results: [contact()] }), json(contact()),
      json({ results: [{ toObjectId: 456 }] }), json({ status: 'COMPLETE', results: [ticket('456', { hs_pipeline_stage: '1416243218' })] }), json(ticket('456', { hs_pipeline_stage: '1416243218' })),
    ]);
    const result = await createRecruitIntake(input, options(ledger, fetchImpl));
    assert.equal(result.status, 'already_exists');
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/contacts' || new URL(call.url).pathname === '/crm/v3/objects/tickets').length, 0);
    assert.equal((await db.query('SELECT status FROM recruit_intake_requests')).rows[0].status, 'already_exists');
  } finally { await db.close(); }
});

test('an existing recruiting Ticket keeps its different assigned path and legacy stage untouched', async () => {
  const { db, ledger } = await fixture();
  try {
    const existing = ticket('456', { hs_pipeline_stage: '1473225367', recruiting_path: 'mass_recruiting', licensing_branch: 'not_licensed' });
    const { fetchImpl, calls } = provider([
      json(access), json(labels), json({ total: 1, results: [contact()] }), json({ total: 1, results: [contact()] }), json(contact()),
      json({ results: [{ toObjectId: 456 }] }), json({ status: 'COMPLETE', results: [existing] }), json(existing),
    ]);
    assert.equal((await createRecruitIntake(input, options(ledger, fetchImpl))).status, 'already_exists');
    assert.equal(calls.some(call => ['PATCH', 'PUT'].includes(call.method) || ['/crm/v3/objects/contacts', '/crm/v3/objects/tickets'].includes(new URL(call.url).pathname)), false);
  } finally { await db.close(); }
});

test('exact existing Contact with no recruiting Ticket is reused and only the linked Ticket is created', async () => {
  const { db, ledger } = await fixture();
  try {
    const { fetchImpl, calls } = provider([
      json(access), json(labels), json({ total: 1, results: [contact()] }), json({ total: 1, results: [contact()] }), json(contact()),
      json({ results: [] }), json({ id: '456' }, 201), json(ticket()),
    ]);
    const result = await createRecruitIntake(input, options(ledger, fetchImpl));
    assert.equal(result.status, 'created'); assert.equal(result.contact.id, '123');
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/contacts').length, 0);
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/tickets').length, 1);
  } finally { await db.close(); }
});

test('email/phone identity conflicts and truncated searches never create Contacts or Tickets', async () => {
  for (const replies of [
    [json(access), json(labels), json({ total: 1, results: [contact('123', { firstname: 'Different' })] }), json({ total: 1, results: [contact('123', { firstname: 'Different' })] })],
    [json(access), json(labels), json({ total: 1, results: [contact()] }), json({ total: 1, results: [contact('234', { phone: '+14075550999' })] })],
    [json(access), json(labels), json({ total: 201, results: [] })],
  ]) {
    const { db, ledger } = await fixture();
    try {
      const { fetchImpl, calls } = provider(replies);
      await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), error => ['CONTACT_IDENTITY_CONFLICT', 'INTAKE_SEARCH_UNAVAILABLE'].includes(error.code));
      assert.equal(calls.some(call => new URL(call.url).pathname === '/crm/v3/objects/contacts' || new URL(call.url).pathname === '/crm/v3/objects/tickets'), false);
      assert.equal((await db.query('SELECT status FROM recruit_intake_requests')).rows[0].status, 'failed');
    } finally { await db.close(); }
  }
});

test('search responses missing requested identity fields cannot establish contact absence', async () => {
  for (const [missing, emailPhase] of [[['firstname', 'lastname', 'phone', 'mobilephone', 'email'], false], [['phone', 'mobilephone'], false], [['email'], true]]) {
    const { db, ledger } = await fixture();
    try {
      const malformed = contact(); for (const key of missing) delete malformed.properties[key];
      const replies = [json(access), json(labels), ...(emailPhase ? [json({ total: 0, results: [] })] : []), json({ total: 1, results: [malformed] })];
      const { fetchImpl, calls } = provider(replies);
      await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), { code: 'INTAKE_SEARCH_UNAVAILABLE' });
      assert.equal(calls.some(call => ['/crm/v3/objects/contacts', '/crm/v3/objects/tickets'].includes(new URL(call.url).pathname)), false);
    } finally { await db.close(); }
  }
});

test('definite Ticket rejection retains Contact and allows only explicit same-UUID safe resume', async () => {
  const { db, ledger } = await fixture();
  try {
    const replies = newReplies(); replies.splice(7, 2, json({ error: 'synthetic rejection' }, 400));
    const first = provider(replies);
    await assert.rejects(createRecruitIntake(input, options(ledger, first.fetchImpl)), error => error.code === 'INTAKE_TICKET_REQUIRED' && error.canResume && error.contact.id === '123');
    assert.equal((await db.query('SELECT status,contact_id FROM recruit_intake_requests')).rows[0].status, 'needs_ticket');
    await assert.rejects(createRecruitIntake({ ...input, requestId: two }, options(ledger, first.fetchImpl)), { code: 'CONTACT_IDENTITY_CONFLICT' });
    const resumed = provider([json(access), json(labels), json(contact()), json({ results: [] }), json({ id: '456' }, 201), json(ticket())]);
    assert.equal((await createRecruitIntake(input, options(createRecruitIntakePostgresLedger(db), resumed.fetchImpl))).status, 'created');
    assert.equal(resumed.calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/contacts').length, 0);
    assert.equal(resumed.calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/tickets').length, 1);
  } finally { await db.close(); }
});

test('concurrent same-UUID Resume requests cannot both create a Ticket', async () => {
  const { db, ledger } = await fixture();
  try {
    const rejected = newReplies(); rejected.splice(7, 2, json({}, 400));
    await assert.rejects(createRecruitIntake(input, options(ledger, provider(rejected).fetchImpl)), { code: 'INTAKE_TICKET_REQUIRED' });
    const resumed = provider([json(access), json(labels), json(contact()), json({ results: [] }), json({ id: '456' }, 201), json(ticket())]);
    const outcomes = await Promise.allSettled([
      createRecruitIntake(input, options(ledger, resumed.fetchImpl)),
      createRecruitIntake(input, options(createRecruitIntakePostgresLedger(db), resumed.fetchImpl)),
    ]);
    assert.ok(outcomes.some(item => item.status === 'fulfilled'));
    assert.equal(resumed.calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/tickets').length, 1);
    assert.equal((await db.query('SELECT status FROM recruit_intake_requests')).rows[0].status, 'created');
  } finally { await db.close(); }
});

test('uncertain Contact or Ticket writes never retry even with a new UUID or restarted ledger', async () => {
  for (const mutationIndex of [4, 7]) {
    const { db, ledger } = await fixture();
    try {
      const replies = newReplies(); replies.splice(mutationIndex, replies.length - mutationIndex, new Error('synthetic network interruption'));
      const { fetchImpl, calls } = provider(replies);
      await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
      await assert.rejects(createRecruitIntake(input, options(createRecruitIntakePostgresLedger(db), fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
      await assert.rejects(createRecruitIntake({ ...input, requestId: two }, options(ledger, fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
      assert.equal(calls.length, mutationIndex + 1);
      assert.equal((await db.query('SELECT status FROM recruit_intake_requests')).rows[0].status, 'uncertain');
    } finally { await db.close(); }
  }
});

test('Contact acknowledgement followed by a failed confirmation retains its ID and freezes identity claims', async () => {
  const { db, ledger } = await fixture();
  try {
    const replies = newReplies(); replies.splice(5, replies.length - 5, new Error('synthetic confirmation failure'));
    const { fetchImpl, calls } = provider(replies);
    await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), error => error.code === 'INTAKE_UNCERTAIN' && error.contact.id === '123');
    await assert.rejects(createRecruitIntake({ ...input, requestId: two }, options(createRecruitIntakePostgresLedger(db), fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
    assert.equal(calls.length, 6);
    assert.deepEqual((await db.query('SELECT status,contact_id,ticket_id FROM recruit_intake_requests')).rows, [{ status: 'uncertain', contact_id: '123', ticket_id: null }]);
  } finally { await db.close(); }
});

test('separate callers sharing phone or email can reach at most one pair of creates', async () => {
  const { db, ledger } = await fixture();
  try {
    const { fetchImpl, calls } = provider(newReplies());
    const outcomes = await Promise.allSettled([
      createRecruitIntake(input, options(ledger, fetchImpl)),
      createRecruitIntake({ ...input, requestId: two }, { ...options(createRecruitIntakePostgresLedger(db), fetchImpl), userId: 'other-user' }),
    ]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/contacts').length, 1);
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/tickets').length, 1);
  } finally { await db.close(); }
});

test('acknowledged Ticket without confirmed association stays uncertain and cannot be resubmitted', async () => {
  const { db, ledger } = await fixture();
  try {
    const replies = newReplies(); const bad = ticket(); bad.associations.contacts.results = []; replies[8] = json(bad);
    const { fetchImpl, calls } = provider(replies);
    await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), error => error.code === 'INTAKE_UNCERTAIN' && error.contact.id === '123' && error.recruit.id === '456');
    await assert.rejects(createRecruitIntake({ ...input, requestId: two }, options(ledger, fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
    assert.equal(calls.length, 9);
  } finally { await db.close(); }
});

test('capability requires all four grants, exact app/portal, association labels and only the new feature flag', async () => {
  const base = { editorEmails: user.email, writesEnabled: 'true', intakeEnabled: 'true', vercel: '1', vercelEnv: 'production', hmacSecret: secret, ledger: { claim() {}, finish() {} }, accessToken: 'synthetic-token' };
  for (const overrides of [{ intakeEnabled: 'false' }, { writesEnabled: 'false' }, { vercelEnv: 'preview' }, { editorEmails: 'other@example.invalid' }, { hmacSecret: 'short' }, { ledger: undefined }]) assert.equal(await checkRecruitIntakeCapability(user, { ...base, ...overrides, fetchImpl() { assert.fail('disabled check contacted provider'); } }), false);
  for (const info of [{ ...access, scopes: scopes.slice(0, 3) }, { ...access, hubId: 1 }, { ...access, appId: 2 }]) assert.equal(await checkRecruitIntakeCapability(user, { ...base, fetchImpl: async () => json(info) }), false);
  const allowed = provider([json(access), json(labels)]);
  assert.equal(await checkRecruitIntakeCapability(user, { ...base, contactCreationEnabled: 'false', fetchImpl: allowed.fetchImpl }), true);
  const noDefault = provider([json(access), json({ results: [{ category: 'USER_DEFINED', label: 'not default', typeId: 16 }] })]);
  assert.equal(await checkRecruitIntakeCapability(user, { ...base, fetchImpl: noDefault.fetchImpl }), false);
});

test('HTTP intake boundary denies forged/anonymous/disabled/cross-origin/oversized callers before provider writes', async () => {
  let creates = 0;
  const base = { getUser: async () => user, createData: async () => { creates++; return { status: 'created', requestId: one, contact: { id: '123' }, recruit: { id: '456' } }; }, editorEmails: user.email, writesEnabled: 'true', intakeEnabled: 'true', hmacSecret: secret, vercel: '1', vercelEnv: 'production', ledger: { claim() {}, finish() {} }, allowedOrigin: origin };
  const request = (body = input, extra = {}) => new Request(origin + '/api/recruit-intake', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });
  for (const [req, overrides, status] of [
    [request(), { getUser: async () => null }, 401], [request(), { intakeEnabled: 'false' }, 403], [request(), { vercelEnv: 'preview' }, 403], [request(), { editorEmails: 'other@example.invalid' }, 403],
    [request(input, { headers: { Origin: 'https://other.example.invalid', 'Content-Type': 'application/json' } }), {}, 403],
    [request({ ...input, unexpected: 'x'.repeat(5000) }), {}, 413], [request({ ...input, hs_pipeline: '0' }), {}, 400],
  ]) { const response = await handleRecruitIntakeRequest(req, { ...base, ...overrides }); assert.equal(response.status, status); assert.match(response.headers.get('Cache-Control'), /private.*no-store/); }
  assert.equal(creates, 0);
  const method = await handleRecruitIntakeRequest(new Request(origin + '/api/recruit-intake'), base); assert.equal(method.status, 405);
  const success = await handleRecruitIntakeRequest(request(), { ...base, contactCreationEnabled: 'false' }); assert.equal(success.status, 201); assert.equal(creates, 1);
});

test('optional email is omitted without inventing license status or Contact lifecycle values', async () => {
  const { db, ledger } = await fixture();
  try {
    const replies = newReplies(); replies.splice(3, 1); replies[4] = json(contact('123', { email: null }));
    const { fetchImpl, calls } = provider(replies);
    assert.equal((await createRecruitIntake({ ...input, email: '' }, options(ledger, fetchImpl))).status, 'created');
    const sent = calls.find(call => new URL(call.url).pathname === '/crm/v3/objects/contacts');
    assert.deepEqual(JSON.parse(sent.body), { properties: { firstname: 'Synthetic', lastname: 'Recruit', phone: '+14075550123' } });
  } finally { await db.close(); }
});

test('failed durable checkpoint after successful creation retains claims and cannot repeat a provider write', async () => {
  const { db, ledger } = await fixture();
  try {
    const { fetchImpl, calls } = provider(newReplies());
    const failing = { ...ledger, finish: async args => args.status === 'created' ? false : ledger.finish(args) };
    await assert.rejects(createRecruitIntake(input, options(failing, fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
    await assert.rejects(createRecruitIntake({ ...input, requestId: two }, options(createRecruitIntakePostgresLedger(db), fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
    assert.equal(calls.length, 9);
    assert.deepEqual((await db.query('SELECT status,contact_id,ticket_id FROM recruit_intake_requests')).rows, [{ status: 'uncertain', contact_id: '123', ticket_id: '456' }]);
  } finally { await db.close(); }
});

test('timed-out Ticket POST aborts once and preserves the confirmed Contact without retry', async () => {
  const { db, ledger } = await fixture();
  try {
    const leading = provider(newReplies().slice(0, 7));
    let ticketPosts = 0;
    const fetchImpl = (url, init) => {
      if (new URL(url).pathname === '/crm/v3/objects/tickets') {
        ticketPosts++; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true }));
      }
      return leading.fetchImpl(url, init);
    };
    await assert.rejects(createRecruitIntake(input, { ...options(ledger, fetchImpl), timeoutMs: 5 }), error => error.code === 'INTAKE_UNCERTAIN' && error.contact.id === '123' && !error.canResume);
    await assert.rejects(createRecruitIntake(input, options(ledger, fetchImpl)), { code: 'INTAKE_UNCERTAIN' });
    assert.equal(ticketPosts, 1);
  } finally { await db.close(); }
});
