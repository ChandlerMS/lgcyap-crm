import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInboxThread, updateInboxThread, handleInboxThreadRequest } from '../lib/inbox-thread.mjs';
const now = 1795090000000, user = { userId: 'employee', email: 'agent@example.test' };
function setup({ archived = false, failPatch = false, scopes = ['conversations.read', 'conversations.write', 'crm.objects.owners.read'] } = {}) {
  const thread = { id: '101', status: 'OPEN', archived, latestMessageTimestamp: '2026-11-19T10:00:00Z' }, patches = [], claims = new Map();
  const ledger = {
    async claim(input) { const old = claims.get(input.requestId); if (old) return { acquired: false, ...old }; claims.set(input.requestId, { hash: input.hash, status: 'pending' }); return { acquired: true }; },
    async finish(input) { claims.set(input.requestId, { hash: input.hash, status: input.status }); return true; },
  };
  const options = { user, accessToken: 'synthetic-token', hmacSecret: 's'.repeat(32), now: () => now, ledger, fetchImpl: async (url, request) => {
    if (url.endsWith('/access-token-info')) return Response.json({ hubId: 50894788, appId: 59264745, scopes });
    if (request.method === 'PATCH') { const patch = JSON.parse(request.body); patches.push(patch); if (failPatch) throw Error('private provider details'); Object.assign(thread, patch); return Response.json(thread); }
    if (thread.archived && !url.endsWith('?archived=true')) return Response.json({}, { status: 404 });
    return Response.json(thread);
  } };
  return { options, thread, patches, claims };
}
const inputFor = (prepared, operation = 'close') => ({ threadId: '101', contextToken: prepared.contextToken, operation, requestId: '9e283fd5-8e92-4cbe-b97f-af16cc216659' });
test('thread edits use exact sparse patches, confirm HubSpot response, and replay without a second write', async () => {
  const s = setup(), input = inputFor(await prepareInboxThread('101', s.options));
  assert.equal((await updateInboxThread(input, s.options)).status, 'saved');
  assert.equal((await updateInboxThread(input, s.options)).replayed, true);
  assert.deepEqual(s.patches, [{ status: 'CLOSED' }]);
  const reopen = { ...inputFor(await prepareInboxThread('101', s.options), 'reopen'), requestId: '9e283fd5-8e92-4cbe-b97f-af16cc216660' };
  await updateInboxThread(reopen, s.options);
  assert.deepEqual(s.patches[1], { status: 'OPEN' });
  assert.ok(!JSON.stringify([...s.claims.values()]).includes(user.email));
});
test('changed status or newly received message, expired signature and different employee block edits', async () => {
  for (const change of [s => { s.thread.status = 'CLOSED'; }, s => { s.thread.latestMessageTimestamp = '2026-11-19T10:01:00Z'; }, s => { s.options.now = () => now + 600001; }, s => { s.options.user = { ...user, userId: 'other' }; }]) {
    const s = setup(), input = inputFor(await prepareInboxThread('101', s.options)); change(s);
    await assert.rejects(updateInboxThread(input, s.options), error => error.code === 'THREAD_CHANGED');
    assert.equal(s.patches.length, 0);
  }
});
test('archived conversations can be restored, but cannot have their status changed until restored', async () => {
  const s = setup({ archived: true }), prepared = await prepareInboxThread('101', s.options);
  assert.equal(prepared.archived, true);
  await assert.rejects(updateInboxThread(inputFor(prepared), s.options), error => error.code === 'THREAD_CHANGED');
  await updateInboxThread({ ...inputFor(prepared, 'restore'), requestId: '9e283fd5-8e92-4cbe-b97f-af16cc216660' }, s.options);
  assert.deepEqual(s.patches, [{ archived: false }]);
});
test('uncertain updates are not blindly replayed and missing permission prevents all edits', async () => {
  const s = setup({ failPatch: true }), input = inputFor(await prepareInboxThread('101', s.options));
  await assert.rejects(updateInboxThread(input, s.options), error => error.uncertain);
  await assert.rejects(updateInboxThread(input, s.options), error => error.uncertain);
  assert.equal(s.patches.length, 1);
  await assert.rejects(prepareInboxThread('101', setup({ scopes: ['conversations.read'] }).options), /conversations.write/);
});
test('thread HTTP boundary rejects anonymous, unauthorized, foreign-origin, extra-field and preview writes', async () => {
  const s = setup(); let calls = 0;
  const options = { ...s.options, getUser: async () => user, editorEmails: user.email, allowedOrigin: 'https://crm.test', writesEnabled: 'true', vercel: '1', vercelEnv: 'production', getLedger: () => s.options.ledger, fetchImpl: async () => { calls++; throw Error(); } };
  const request = (body, origin = 'https://crm.test') => new Request('https://crm.test/api/inbox-thread', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { action: 'prepare', threadId: '101' };
  assert.equal((await handleInboxThreadRequest(request(body), { ...options, getUser: async () => null })).status, 401);
  assert.equal((await handleInboxThreadRequest(request(body), { ...options, editorEmails: 'other@example.test' })).status, 403);
  assert.equal((await handleInboxThreadRequest(request(body, 'https://evil.test'), options)).status, 403);
  assert.equal((await handleInboxThreadRequest(request({ ...body, assignedTo: 'A-123' }), options)).status, 400);
  assert.equal((await handleInboxThreadRequest(request(body), { ...options, vercelEnv: 'preview' })).status, 403);
  assert.equal(calls, 0);
});
