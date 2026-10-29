import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createContact, createContactPostgresLedger, verifyContactAccess, checkContactCreationCapability, handleContactCreateRequest } from '../lib/hubspot-contact-create.mjs';

const migration = await readFile(new URL('../migrations/0002_contact_creation_ledger.sql', import.meta.url), 'utf8');
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const third = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secret = 'synthetic-key-for-contact-tests-0123456789';
const input = { requestId: first, firstName: 'Synthetic', lastName: 'Recruit', phone: '(407) 555-0123', licensed: false };
const access = { hubId: 50894788, appId: 59264745, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] };
const user = { userId: 'synthetic-user', email: 'allowed@example.invalid' };
const origin = 'https://recruiting.example.invalid';
const clock = () => 1700000000000;
function json(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
async function fixture() {
  const db = new PGlite(); await db.exec(migration);
  return { db, ledger: createContactPostgresLedger(db) };
}
function provider(replies) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(new URL(url).origin, 'https://api.hubapi.com');
    assert.equal(url.includes('synthetic-token'), false);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    assert.ok(reply instanceof Response, 'unexpected extra provider call');
    return reply;
  };
  return { calls, fetchImpl };
}
function confirmation(licensed = false) { return { id: '123', properties: { firstname: 'Synthetic', lastname: 'Recruit', phone: '+14075550123', licensed_2_14_2_15: licensed ? 'Yes' : 'No' } }; }
function options(ledger, fetchImpl) { return { userId: user.userId, accessToken: 'synthetic-token', hmacSecret: secret, ledger, fetchImpl, now: clock }; }

test('contact migration repeats, keeps metadata only, arbitrates global concurrent phones and retains crash claims', async () => {
  const { db, ledger } = await fixture();
  try {
    await db.exec(migration);
    const claim = { userId: 'one', requestId: first, hash: 'payload-hash', phoneHash: 'phone-hmac', keyHash: 'key-hmac', now: clock() };
    const results = await Promise.all([ledger.claim(claim), createContactPostgresLedger(db).claim({ ...claim, userId: 'two', requestId: second })]);
    assert.equal(results.filter(value => value.acquired).length, 1);
    assert.equal(results.find(value => !value.acquired).source, 'phone');
    const owner = (await db.query('SELECT user_id, request_id FROM contact_create_requests')).rows[0];
    assert.equal((await ledger.claim({ ...claim, userId: owner.user_id, requestId: owner.request_id, now: clock() + 120001 })).status, 'uncertain');
    assert.equal((await ledger.claim({ ...claim, requestId: third, now: clock() + 120001 })).status, 'uncertain');
    assert.equal(await ledger.finish({ ...claim, userId: owner.user_id, requestId: owner.request_id, status: 'failed', now: clock() + 120001 }), false);
    await assert.rejects(ledger.claim({ ...claim, keyHash: 'rotated-key', requestId: third }), { code: 'CREATE_UNAVAILABLE' });
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='contact_create_requests' ORDER BY ordinal_position")).rows.map(row => row.column_name);
    assert.deepEqual(columns, ['user_id', 'request_id', 'phone_hash', 'payload_hash', 'status', 'contact_id', 'created_at', 'updated_at']);
    await assert.rejects(db.query("UPDATE contact_create_requests SET status='unexpected'"), /check constraint/);
  } finally { await db.close(); }
});

test('create sends only four approved properties, confirms readback and replays without another provider call', async () => {
  const { db, ledger } = await fixture();
  try {
    const { calls, fetchImpl } = provider([json(access), json({ total: 0, results: [] }), json({ id: '123' }, 201), json(confirmation())]);
    const result = await createContact(input, options(ledger, fetchImpl));
    assert.equal(result.status, 'created'); assert.equal(result.contact.id, '123');
    assert.equal(result.contact.hubspotUrl, 'https://app.hubspot.com/contacts/50894788/record/0-1/123');
    assert.deepEqual(calls.map(call => [new URL(call.url).pathname, call.method]), [
      ['/oauth/v2/private-apps/get/access-token-info', 'POST'], ['/crm/v3/objects/contacts/search', 'POST'], ['/crm/v3/objects/contacts', 'POST'], ['/crm/v3/objects/contacts/123', 'GET'],
    ]);
    assert.deepEqual(JSON.parse(calls[0].body), { tokenKey: 'synthetic-token' });
    assert.deepEqual(JSON.parse(calls[1].body), { properties: ['phone', 'mobilephone'], limit: 200, query: '4075550123' });
    assert.deepEqual(JSON.parse(calls[2].body), { properties: confirmation().properties });
    const replay = await createContact({ ...input, phone: '+1 (407) 555-0123' }, options(createContactPostgresLedger(db), fetchImpl));
    assert.equal(replay.replayed, true); assert.equal(calls.length, 4);
    await assert.rejects(createContact({ ...input, licensed: true }, options(ledger, fetchImpl)), { code: 'REQUEST_ID_REUSED' });
    await assert.rejects(createContact({ ...input, requestId: second }, { ...options(ledger, fetchImpl), userId: 'other-user' }), { code: 'CONTACT_EXISTS', contact: { id: '123', hubspotUrl: result.contact.hubspotUrl } });
    const persisted = JSON.stringify((await db.query('SELECT * FROM contact_create_requests')).rows);
    assert.equal(persisted.includes('Synthetic'), false); assert.equal(persisted.includes('4075550123'), false); assert.equal(persisted.includes('synthetic-token'), false);
    assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'created');
  } finally { await db.close(); }
});

test('duplicate mobilephone is canonical-compared and persisted without creation or personal response fields', async () => {
  const { db, ledger } = await fixture();
  try {
    const { calls, fetchImpl } = provider([json(access), json({ total: 1, results: [{ id: '234', properties: { phone: null, mobilephone: '1 (407) 555-0123' } }] })]);
    await assert.rejects(createContact(input, options(ledger, fetchImpl)), error => error.code === 'CONTACT_EXISTS' && Object.keys(error.contact).join(',') === 'id,hubspotUrl');
    await assert.rejects(createContact({ ...input, requestId: second }, options(ledger, fetchImpl)), { code: 'CONTACT_EXISTS' });
    assert.equal(calls.length, 2); assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'duplicate');
  } finally { await db.close(); }
});

test('concurrent callers on separate functions issue only one contact creation across users', async () => {
  const { db, ledger } = await fixture();
  try {
    const { calls, fetchImpl } = provider([json(access), json({ total: 0, results: [] }), json({ id: '123' }, 201), json(confirmation())]);
    const results = await Promise.allSettled([
      createContact(input, options(ledger, fetchImpl)),
      createContact({ ...input, requestId: second, phone: '+14075550123' }, { ...options(createContactPostgresLedger(db), fetchImpl), userId: 'another-user' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const blocked = results.find(result => result.status === 'rejected');
    assert.ok(['CREATE_IN_PROGRESS', 'CONTACT_EXISTS'].includes(blocked.reason.code));
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/contacts').length, 1);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM contact_create_requests')).rows[0].count, 1);
  } finally { await db.close(); }
});

test('failed database confirmation after provider success and crashed claims cannot release phone or retry create', async () => {
  for (const throws of [false, true]) {
    const { db, ledger } = await fixture();
    try {
      const { calls, fetchImpl } = provider([json(access), json({ total: 0, results: [] }), json({ id: '123' }, 201), json(confirmation())]);
      const failingLedger = { ...ledger, finish: async () => { if (throws) throw new Error('synthetic DB interruption'); return false; } };
      await assert.rejects(createContact(input, options(failingLedger, fetchImpl)), { code: 'CREATE_UNCERTAIN' });
      await assert.rejects(createContact({ ...input, requestId: second }, options(createContactPostgresLedger(db), fetchImpl)), { code: 'CREATE_IN_PROGRESS' });
      assert.equal(calls.length, 4);
      assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'pending');
    } finally { await db.close(); }
  }
});

test('a timed-out contact POST aborts once and freezes the durable phone claim', async () => {
  const { db, ledger } = await fixture();
  try {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(new URL(url).pathname);
      if (url.includes('access-token-info')) return json(access);
      if (url.endsWith('/search')) return json({ total: 0, results: [] });
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true }));
    };
    await assert.rejects(createContact(input, { ...options(ledger, fetchImpl), timeoutMs: 5 }), { code: 'CREATE_UNCERTAIN' });
    await assert.rejects(createContact({ ...input, requestId: second }, options(ledger, fetchImpl)), { code: 'CREATE_UNCERTAIN' });
    assert.equal(calls.filter(path => path === '/crm/v3/objects/contacts').length, 1);
    assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'uncertain');
  } finally { await db.close(); }
});

test('wrong portal/app/missing scopes fail before search or creation; disabled capabilities never inspect token', async () => {
  for (const info of [{ ...access, hubId: 1 }, { ...access, appId: 2 }, { ...access, scopes: ['crm.objects.contacts.read'] }]) {
    const { db, ledger } = await fixture();
    try {
      const { calls, fetchImpl } = provider([json(info)]);
      await assert.rejects(createContact(input, options(ledger, fetchImpl)), { code: 'CONTACT_ACCESS_REQUIRED' });
      assert.equal(calls.length, 1); assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'failed');
    } finally { await db.close(); }
  }
  const base = { editorEmails: user.email, writesEnabled: 'true', contactCreationEnabled: 'true', vercel: '1', vercelEnv: 'production', hmacSecret: secret, ledger: { claim() {}, finish() {} }, accessToken: 'synthetic-token' };
  for (const override of [{ contactCreationEnabled: 'false' }, { writesEnabled: 'false' }, { vercelEnv: 'preview' }, { vercel: undefined }, { editorEmails: 'other@example.invalid' }, { hmacSecret: 'short' }, { ledger: undefined }]) {
    assert.equal(await checkContactCreationCapability(user, { ...base, ...override, fetchImpl: () => { assert.fail('disabled permission check contacted provider'); } }), false);
  }
  assert.equal(await checkContactCreationCapability(user, { ...base, fetchImpl: async () => json(access) }), true);
  assert.equal(await checkContactCreationCapability(user, { ...base, fetchImpl: async () => { throw new Error('secret synthetic failure'); } }), false);
});

test('truncated/malformed search fails closed, failed request UUID stays consumed and a new deliberate UUID may retry', async () => {
  for (const search of [{ total: 201, results: [] }, { total: 0, results: [], paging: { next: { after: '1' } } }, { results: [] }, { total: 1, results: [{ id: '123', properties: { phone: '123 ext9' } }] }]) {
    const { db, ledger } = await fixture();
    try {
      const { calls, fetchImpl } = provider([json(access), json(search)]);
      await assert.rejects(createContact(input, options(ledger, fetchImpl)), { code: 'CONTACT_SEARCH_UNAVAILABLE' });
      await assert.rejects(createContact(input, options(ledger, fetchImpl)), { code: 'CREATE_ALREADY_PROCESSED' });
      assert.equal(calls.length, 2);
      assert.equal((await ledger.claim({ userId: user.userId, requestId: second, hash: 'new-hash', phoneHash: (await db.query('SELECT phone_hash FROM contact_create_requests')).rows[0].phone_hash, keyHash: (await db.query('SELECT key_hash FROM contact_create_ledger_key')).rows[0].key_hash, now: clock() })).acquired, true);
    } finally { await db.close(); }
  }
});

test('network/5xx/redirect/malformed create and failed confirmation stay uncertain across new users and UUIDs', async () => {
  for (const replies of [
    [new Error('synthetic network interruption')], [json({}, 500)], [json({}, 302)], [new Response('not JSON', { status: 201 })],
    [json({ id: 'unsafe-id' }, 201)], [json({ id: '123' }, 201), json({}, 503)],
    [json({ id: '123' }, 201), json(confirmation(true))],
  ]) {
    const { db, ledger } = await fixture();
    try {
      const { calls, fetchImpl } = provider([json(access), json({ total: 0, results: [] }), ...replies]);
      await assert.rejects(createContact(input, options(ledger, fetchImpl)), { code: 'CREATE_UNCERTAIN' });
      const count = calls.length;
      await assert.rejects(createContact(input, options(createContactPostgresLedger(db), fetchImpl)), { code: 'CREATE_UNCERTAIN' });
      await assert.rejects(createContact({ ...input, requestId: second }, { ...options(createContactPostgresLedger(db), fetchImpl), userId: 'another-user' }), { code: 'CREATE_UNCERTAIN' });
      assert.equal(calls.length, count); assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v3/objects/contacts').length, 1);
      assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'uncertain');
    } finally { await db.close(); }
  }
});

test('definite provider rejection releases phone without automatic retry and caps safe rate-limit delay', async () => {
  for (const [status, code] of [[400, 'CREATE_UNAVAILABLE'], [403, 'CONTACT_ACCESS_REQUIRED'], [409, 'CONTACT_CONFLICT'], [429, 'HUBSPOT_RATE_LIMITED']]) {
    const { db, ledger } = await fixture();
    try {
      const { calls, fetchImpl } = provider([json(access), json({ total: 0, results: [] }), json({ secret: 'provider error must not leak' }, status, { 'Retry-After': '999999999999' })]);
      await assert.rejects(createContact(input, options(ledger, fetchImpl)), error => error.code === code && !error.message.includes('provider error') && (status !== 429 || error.retryAfterSeconds === 86400));
      assert.equal(calls.length, 3); assert.equal((await db.query('SELECT status FROM contact_create_requests')).rows[0].status, 'failed');
    } finally { await db.close(); }
  }
});

test('international search remains bounded and licensed true maps only to confirmed Yes enum', async () => {
  const { db, ledger } = await fixture();
  try {
    const international = { ...input, phone: '+44 20 7946 0958', licensed: true };
    const record = { id: '123', properties: { ...confirmation(true).properties, phone: '+442079460958' } };
    const { calls, fetchImpl } = provider([json(access), json({ total: 0, results: [] }), json({ id: '123' }, 201), json(record)]);
    await createContact(international, options(ledger, fetchImpl));
    const search = JSON.parse(calls[1].body);
    assert.equal(search.limit, 200); assert.equal(search.filterGroups.length, 4);
    assert.deepEqual(search.properties, ['phone', 'mobilephone']);
    assert.equal(JSON.parse(calls[2].body).properties.licensed_2_14_2_15, 'Yes');
  } finally { await db.close(); }
});

test('contact HTTP boundary requires session, current exact list, same origin, production flags and bounded JSON', async () => {
  let creates = 0;
  const base = { getUser: async () => user, editorEmails: user.email, writesEnabled: 'true', contactCreationEnabled: 'true', hmacSecret: secret, ledger: { claim() {}, finish() {} }, vercel: '1', vercelEnv: 'production', allowedOrigin: origin,
    createData: async value => { creates++; assert.equal(value.licensed, false); return { status: 'created', contact: { id: '123', hubspotUrl: 'safe' }, requestId: value.requestId }; } };
  const request = (body = input, headers = {}, method = 'POST') => new Request(origin + '/api/contacts', { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await handleContactCreateRequest(request(undefined, {}, 'GET'), base)).status, 405);
  assert.equal((await handleContactCreateRequest(request(), { ...base, getUser: async () => null })).status, 401);
  for (const override of [{ editorEmails: 'different@example.invalid' }, { vercelEnv: 'preview' }, { writesEnabled: 'false' }, { contactCreationEnabled: 'false' }]) assert.equal((await handleContactCreateRequest(request(), { ...base, ...override })).status, 403);
  assert.equal((await handleContactCreateRequest(request(input, { Origin: 'https://evil.example.invalid' }), base)).status, 403);
  assert.equal((await handleContactCreateRequest(request(input, { 'Content-Type': 'text/plain' }), base)).status, 415);
  assert.equal((await handleContactCreateRequest(request({ ...input, firstName: 'x'.repeat(5000) }), base)).status, 413);
  const invalid = await handleContactCreateRequest(request({ ...input, licensed: 'Yes' }), base);
  assert.equal(invalid.status, 400); assert.ok((await invalid.json()).error.fieldErrors.licensed);
  assert.equal(creates, 0);
  const success = await handleContactCreateRequest(request(), base);
  assert.equal(success.status, 201); assert.match(success.headers.get('Cache-Control'), /no-store/); assert.equal(creates, 1);
});

test('metadata redirects/oversized JSON/timeouts are bounded safe errors and never expose token', async () => {
  for (const fetchImpl of [async () => json({}, 302), async () => new Response('x'.repeat(512 * 1024 + 1)), async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('synthetic-token')), { once: true }))]) {
    await assert.rejects(verifyContactAccess({ accessToken: 'synthetic-token', fetchImpl, timeoutMs: 5 }), error => error.code === 'CREATE_UNAVAILABLE' && !error.message.includes('synthetic-token'));
  }
});
