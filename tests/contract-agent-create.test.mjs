import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresLedger } from '../lib/hubspot-write.mjs';
import { createContractAgent, handleContractAgentCreate } from '../lib/contract-agent-create.mjs';
import { validateContractAgent } from '../lib/contract-agent-input.mjs';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = { requestId, properties: { full_name: 'Synthetic Agent', email: 'agent@example.invalid', npn: '0012345' } };
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
    if (url.endsWith('/access-token-info')) return json({ hubId: 50894788, appId: 59264745, scopes: ['crm.objects.custom.read', 'crm.objects.custom.write'] });
    if (url.endsWith('/search')) { assert.equal(options.method, 'POST'); if (overrides.search) return overrides.search(); return json({ total: 0, results: [] }); }
    if (url === 'https://api.hubapi.com/crm/v3/objects/2-64481801') {
      mutationCount++; savedProperties = JSON.parse(options.body).properties;
      assert.equal(options.method, 'POST');
      assert.deepEqual(savedProperties, input.properties);
      if (overrides.create) return overrides.create();
      return json({ id: '101', properties: savedProperties }, 201);
    }
    assert.ok(url.startsWith('https://api.hubapi.com/crm/v3/objects/2-64481801/101?properties='));
    assert.equal(options.method, 'GET');
    if (overrides.confirm) return overrides.confirm();
    return json({ id: '101', properties: savedProperties });
  };
  return { options: { userId: 'synthetic-user', accessToken: 'synthetic-token', hmacSecret: 's'.repeat(32), ledger, fetchImpl }, claims, mutations: () => mutationCount };
}

test('agent input accepts only bounded allowed fields and requires full name', () => {
  assert.equal(validateContractAgent(input).properties.npn, '0012345');
  assert.equal(validateContractAgent({ ...input, properties: { full_name: ' Name ', email: ' A@EXAMPLE.invalid ' } }).properties.email, 'a@example.invalid');
  for (const properties of [{ full_name: '' }, { full_name: 'x'.repeat(251) }, { full_name: 'Bad\nName' }, { full_name: 'Name', email: 'bad' }, { full_name: 'Name', agent_status: 'active' }, { full_name: 'Name', hubspot_owner_id: '123' }, { full_name: 'Name', hs_pipeline: '0' }]) assert.throws(() => validateContractAgent({ ...input, properties }));
  assert.throws(() => validateContractAgent({ ...input, requestId: 'not-uuid' }));
  assert.throws(() => validateContractAgent({ ...input, endpoint: 'elsewhere' }));
});

test('creates one custom object agent, confirms saved fields and replays without another POST', async () => {
  const f = fixture();
  const created = await createContractAgent(input, f.options);
  assert.equal(created.status, 'created'); assert.equal(created.agent.id, '101');
  assert.equal(f.claims.get(requestId).status, 'saved');
  assert.match(created.agent.hubspotUrl, /\/50894788\/record\/2-64481801\/101$/);
  assert.equal((await createContractAgent(input, f.options)).replayed, true);
  assert.equal(f.mutations(), 1);
  await assert.rejects(createContractAgent({ ...input, properties: { ...input.properties, full_name: 'Changed' } }, f.options), error => error.code === 'REQUEST_ID_REUSED');
  assert.equal(f.mutations(), 1);
});

test('persistent existing Postgres ledger serializes simultaneous creation requests and contains no agent content', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8'));
    const f = fixture(); f.options.ledger = createPostgresLedger(db);
    const results = await Promise.allSettled([createContractAgent(input, f.options), createContractAgent(input, f.options)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length >= 1, true);
    assert.equal(f.mutations(), 1);
    assert.equal((await createContractAgent(input, f.options)).replayed, true);
    const row = (await db.query('SELECT * FROM recruit_write_requests')).rows[0];
    assert.equal(row.status, 'saved'); assert.match(row.ticket_id, /^agent-create:/);
    assert.equal(JSON.stringify(row).includes(input.properties.full_name), false);
  } finally { await db.close(); }
});

test('network errors, ambiguous provider rejection and confirmation mismatch never retry a possible creation', async () => {
  for (const overrides of [{ create: () => { throw new Error('private provider data'); } }, { create: () => json({ private: 'data' }, 503) }, { create: () => json({ private: 'data' }, 302) }, { create: () => json({ id: 'invalid' }, 201) }, { confirm: () => json({ id: '101', properties: { subject: 'mismatch' } }) }, { confirm: () => json({}, 403) }]) {
    const f = fixture(overrides);
    await assert.rejects(createContractAgent(input, f.options), error => error.uncertain === true && !error.message.includes('private'));
    assert.equal(f.claims.get(requestId).status, 'uncertain');
    await assert.rejects(createContractAgent(input, f.options));
    assert.equal(f.mutations(), 1);
  }
});

test('definite provider rejection records failure without retry; missing access and duplicate checks stop before create', async () => {
  const f = fixture({ create: () => json({}, 429) });
  await assert.rejects(createContractAgent(input, f.options), error => error.status === 429 && !error.uncertain);
  assert.equal(f.mutations(), 1); assert.equal(f.claims.get(requestId).status, 'failed');
  for (const kind of ['scope', 'account', 'duplicate', 'search']) {
    const next = fixture(); const original = next.options.fetchImpl;
    next.options.fetchImpl = (url, options) => {
      if (url.endsWith('/access-token-info') && ['scope', 'account'].includes(kind)) return json({ hubId: kind === 'account' ? 1 : 50894788, appId: 59264745, scopes: kind === 'scope' ? [] : ['crm.objects.custom.read', 'crm.objects.custom.write'] });
      if (kind === 'duplicate' && url.endsWith('/search')) return json({ total: 1, results: [{ id: '102' }] });
      if (kind === 'search' && url.endsWith('/search')) return json({ total: 'bad', results: [] });
      return original(url, options);
    };
    await assert.rejects(createContractAgent(input, next.options)); assert.equal(next.mutations(), 0);
  }
});

test('request boundary checks session, editor allowlist, production writes, origin and body before creation', async () => {
  const f = fixture(); let calls = 0;
  const options = { ...f.options, getUser: () => ({ userId: 'synthetic-user', email: 'editor@example.com' }), editorEmails: 'editor@example.com', writesEnabled: 'true', vercel: '1', vercelEnv: 'production', allowedOrigin: 'https://private.example', createData: async () => { calls++; return { status: 'created', requestId }; } };
  const request = (body = input, headers = {}, method = 'POST') => new Request('https://private.example/api/contract-agents', { method, headers: { Origin: 'https://private.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  for (const [req, changes, status] of [[request(), { getUser: () => null }, 401], [request(), { editorEmails: '' }, 403], [request(), { vercelEnv: 'preview' }, 403], [request(), { writesEnabled: 'false' }, 403], [request(input, { Origin: 'https://invalid.example' }), {}, 403], [request(input, { 'Content-Type': 'text/plain' }), {}, 415], [request('x'.repeat(32769)), {}, 413], [request('not json'), {}, 400], [request({ ...input, hs_pipeline: 'evil' }), {}, 400], [request(input, {}, 'GET'), {}, 405]]) {
    const result = await handleContractAgentCreate(req, { ...options, ...changes }); assert.equal(result.status, status); assert.equal(calls, 0);
  }
  const success = await handleContractAgentCreate(request(), options);
  assert.equal(success.status, 201); assert.equal(calls, 1); assert.match(success.headers.get('Cache-Control'), /no-store/);
});
