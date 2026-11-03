import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresLedger } from '../lib/hubspot-write.mjs';
import { createSupportTicket, handleSupportTicketCreate, validateSupportTicket } from '../lib/support-ticket-create.mjs';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = { requestId, title: 'Synthetic support issue', description: 'First line\nSecond line', priority: 'HIGH' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(overrides = {}) {
  let mutationCount = 0, savedProperties;
  const claims = new Map();
  const ledger = {
    async claim(value) { const found = claims.get(value.requestId); if (found) return { acquired: false, ...found }; claims.set(value.requestId, { hash: value.hash, status: 'pending' }); return { acquired: true }; },
    async finish(value) { const found = claims.get(value.requestId); if (!found || found.status !== 'pending') return false; found.status = value.status; return true; },
  };
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url.endsWith('/access-token-info')) return json({ hubId: 50894788, appId: 59264745, scopes: ['crm.objects.tickets.read', 'crm.objects.tickets.write'] });
    if (url.endsWith('/pipelines/tickets/0')) return json({ id: '0', stages: [{ id: '4', displayOrder: 0, metadata: { ticketState: 'CLOSED' } }, { id: '1', displayOrder: 1, metadata: { ticketState: 'OPEN' } }] });
    if (url === 'https://api.hubapi.com/crm/v3/objects/tickets') {
      mutationCount++; savedProperties = JSON.parse(options.body).properties;
      assert.equal(options.method, 'POST');
      assert.deepEqual(savedProperties, { subject: input.title, content: input.description, hs_ticket_priority: 'HIGH', hs_pipeline: '0', hs_pipeline_stage: '1' });
      if (overrides.create) return overrides.create();
      return json({ id: '101', properties: savedProperties }, 201);
    }
    assert.ok(url.startsWith('https://api.hubapi.com/crm/v3/objects/tickets/101?properties='));
    assert.equal(options.method, 'GET');
    if (overrides.confirm) return overrides.confirm();
    return json({ id: '101', properties: savedProperties });
  };
  return { options: { userId: 'synthetic-user', accessToken: 'synthetic-token', hmacSecret: 's'.repeat(32), ledger, fetchImpl }, claims, mutations: () => mutationCount };
}

test('support input is bounded and cannot choose a pipeline, owner, stage or endpoint', () => {
  assert.equal(validateSupportTicket({ ...input, title: '  Title  ' }).title, 'Title');
  for (const change of [{ title: '' }, { title: 'x'.repeat(201) }, { title: 'Bad\nTitle' }, { description: 'x'.repeat(4001) }, { description: '\0' }, { priority: 'hacked' }, { requestId: 'not-uuid' }, { hs_pipeline: '924992938' }, { hs_pipeline_stage: '4' }, { hubspot_owner_id: '123' }, { endpoint: 'https://invalid.example' }]) assert.throws(() => validateSupportTicket({ ...input, ...change }));
});

test('creates one support ticket in an open stage, confirms saved fields and replays without another POST', async () => {
  const f = fixture();
  const created = await createSupportTicket(input, f.options);
  assert.equal(created.status, 'created'); assert.equal(created.ticket.id, '101');
  assert.equal(f.claims.get(requestId).status, 'saved');
  assert.match(created.ticket.hubspotUrl, /\/50894788\/record\/0-5\/101$/);
  assert.equal((await createSupportTicket(input, f.options)).replayed, true);
  assert.equal(f.mutations(), 1);
  await assert.rejects(createSupportTicket({ ...input, title: 'Changed' }, f.options), error => error.code === 'REQUEST_ID_REUSED');
  assert.equal(f.mutations(), 1);
});

test('persistent existing Postgres ledger serializes simultaneous creation requests and contains no ticket content', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8'));
    const f = fixture(); f.options.ledger = createPostgresLedger(db);
    const results = await Promise.allSettled([createSupportTicket(input, f.options), createSupportTicket(input, f.options)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length >= 1, true);
    assert.equal(f.mutations(), 1);
    assert.equal((await createSupportTicket(input, f.options)).replayed, true);
    const row = (await db.query('SELECT * FROM recruit_write_requests')).rows[0];
    assert.equal(row.status, 'saved'); assert.match(row.ticket_id, /^support-create:/);
    assert.equal(JSON.stringify(row).includes(input.title), false);
  } finally { await db.close(); }
});

test('network errors, ambiguous provider rejection and confirmation mismatch never retry a possible creation', async () => {
  for (const overrides of [{ create: () => { throw new Error('private provider data'); } }, { create: () => json({ private: 'data' }, 503) }, { create: () => json({ private: 'data' }, 302) }, { create: () => json({ id: 'invalid' }, 201) }, { confirm: () => json({ id: '101', properties: { subject: 'mismatch' } }) }, { confirm: () => json({}, 403) }]) {
    const f = fixture(overrides);
    await assert.rejects(createSupportTicket(input, f.options), error => error.uncertain === true && !error.message.includes('private'));
    assert.equal(f.claims.get(requestId).status, 'uncertain');
    await assert.rejects(createSupportTicket(input, f.options));
    assert.equal(f.mutations(), 1);
  }
});

test('definite provider rejection records failure without retry; missing access and pipeline stage stop before create', async () => {
  const f = fixture({ create: () => json({}, 429) });
  await assert.rejects(createSupportTicket(input, f.options), error => error.status === 429 && !error.uncertain);
  assert.equal(f.mutations(), 1); assert.equal(f.claims.get(requestId).status, 'failed');
  for (const kind of ['scope', 'account', 'pipeline']) {
    const next = fixture(); const original = next.options.fetchImpl;
    next.options.fetchImpl = (url, options) => {
      if (url.endsWith('/access-token-info') && kind !== 'pipeline') return json({ hubId: kind === 'account' ? 1 : 50894788, appId: 59264745, scopes: kind === 'scope' ? [] : ['crm.objects.tickets.read', 'crm.objects.tickets.write'] });
      if (kind === 'pipeline' && url.endsWith('/pipelines/tickets/0')) return json({ id: '0', stages: [{ id: '4', displayOrder: 0, metadata: { ticketState: 'CLOSED' } }] });
      return original(url, options);
    };
    await assert.rejects(createSupportTicket(input, next.options)); assert.equal(next.mutations(), 0);
  }
});

test('request boundary checks session, editor allowlist, production writes, origin and body before creation', async () => {
  const f = fixture(); let calls = 0;
  const options = { ...f.options, getUser: () => ({ userId: 'synthetic-user', email: 'editor@example.com' }), editorEmails: 'editor@example.com', writesEnabled: 'true', vercel: '1', vercelEnv: 'production', allowedOrigin: 'https://private.example', createData: async () => { calls++; return { status: 'created', requestId }; } };
  const request = (body = input, headers = {}, method = 'POST') => new Request('https://private.example/api/support-tickets', { method, headers: { Origin: 'https://private.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  for (const [req, changes, status] of [[request(), { getUser: () => null }, 401], [request(), { editorEmails: '' }, 403], [request(), { vercelEnv: 'preview' }, 403], [request(), { writesEnabled: 'false' }, 403], [request(input, { Origin: 'https://invalid.example' }), {}, 403], [request(input, { 'Content-Type': 'text/plain' }), {}, 415], [request('x'.repeat(32769)), {}, 413], [request('not json'), {}, 400], [request({ ...input, hs_pipeline: 'evil' }), {}, 400], [request(input, {}, 'GET'), {}, 405]]) {
    const result = await handleSupportTicketCreate(req, { ...options, ...changes }); assert.equal(result.status, status); assert.equal(calls, 0);
  }
  const success = await handleSupportTicketCreate(request(), options);
  assert.equal(success.status, 201); assert.equal(calls, 1); assert.match(success.headers.get('Cache-Control'), /no-store/);
});
