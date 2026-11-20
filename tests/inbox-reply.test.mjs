import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInboxReply, sendInboxReply, handleInboxReplyRequest } from '../lib/inbox-reply.mjs';
const NOW = 1795090000000;
const user = { userId: 'employee', email: 'agent@example.test' };
const thread = { id: '101', archived: false };
const message = { id: 'm1', type: 'MESSAGE', direction: 'INCOMING', channelId: '1002', channelAccountId: '22', createdAt: '2026-11-19T10:00:00Z', subject: 'Question', senders: [{ deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: 'customer@example.test' } }] };
function setup({ scopes = ['conversations.read', 'conversations.write', 'crm.objects.owners.read'], mutate = () => {}, delivery = 'SENT', failSend = false, portalId = 50894788, archived = false, ownerEmail = user.email } = {}) {
  let posts = 0; const claims = new Map(), requests = [];
  const ledger = { async claim(identity) { const prior = claims.get(identity.requestId); if (prior) return { acquired: false, ...prior }; claims.set(identity.requestId, { hash: identity.hash, status: 'pending' }); return { acquired: true }; }, async finish(identity) { claims.set(identity.requestId, { hash: identity.hash, status: identity.status }); return true; } };
  const options = { user, accessToken: 'synthetic-token', hmacSecret: 's'.repeat(32), ledger, now: () => NOW, fetchImpl: async (url, request) => {
    requests.push({ url, request });
    const path = new URL(url).pathname;
    if (path.endsWith('/access-token-info')) return Response.json({ hubId: portalId, appId: 59264745, scopes });
    if (path === '/crm/v3/owners/') return Response.json({ results: [{ email: ownerEmail, userId: 555, archived: false }] });
    if (path.endsWith('/threads/101')) return Response.json({ ...thread, archived });
    if (path.endsWith('/messages') && request.method === 'GET') { const copy = structuredClone(message); mutate(copy); return Response.json({ results: [copy] }); }
    if (path.endsWith('/messages') && request.method === 'POST') { posts++; if (failSend) throw new Error('private provider body'); return Response.json({ id: 'sent1', type: 'MESSAGE', direction: 'OUTGOING', conversationsThreadId: '101', text: JSON.parse(request.body).text, status: { statusType: delivery } }, { status: 201 }); }
    throw new Error('Unexpected URL');
  } };
  return { options, claims, requests, posts: () => posts };
}
const inputFor = prepared => ({ threadId: '101', requestId: '9e283fd5-8e92-4cbe-b97f-af16cc216659', contextToken: prepared.contextToken, text: 'Thanks for your question.' });
test('reply uses verified employee user ID and server-read channel and recipient; duplicate request never sends twice', async () => {
  const s = setup(), prepared = await prepareInboxReply('101', s.options);
  assert.match(prepared.recipientLabel, /customer@example.test/);
  const input = inputFor(prepared);
  assert.equal((await sendInboxReply(input, s.options)).status, 'sent');
  assert.equal((await sendInboxReply(input, s.options)).replayed, true);
  assert.equal(s.posts(), 1);
  const sent = s.requests.find(item => item.request.method === 'POST' && item.url.endsWith('/messages'));
  const body = JSON.parse(sent.request.body);
  assert.equal(body.senderActorId, 'A-555');
  assert.equal(body.channelId, '1002');
  assert.equal(body.channelAccountId, '22');
  assert.equal(body.recipients[0].deliveryIdentifier.value, 'customer@example.test');
  assert.equal(body.type, 'MESSAGE');
  assert.equal(sent.request.redirect, 'manual');
  assert.ok([...s.claims.values()].every(claim => !JSON.stringify(claim).includes(input.text)));
});
test('missing scope, wrong HubSpot portal, archived thread and unsupported channel never send', async () => {
  const missing = setup({ scopes: ['conversations.read'] });
  await assert.rejects(prepareInboxReply('101', missing.options), /conversations.write/);
  const unsupported = setup({ mutate: value => { value.channelId = '9999'; } });
  await assert.rejects(prepareInboxReply('101', unsupported.options), /HubSpot/);
  await assert.rejects(prepareInboxReply('101', setup({ portalId: 999 }).options), /approved account/);
  await assert.rejects(prepareInboxReply('101', setup({ archived: true }).options), /archived/);
  await assert.rejects(prepareInboxReply('101', setup({ ownerEmail: 'different@example.test' }).options), /active HubSpot user/);
  assert.equal(missing.posts() + unsupported.posts(), 0);
});

test('live-chat reply preserves the visitor actor and unsupported recipient data cannot be guessed', async () => {
  const chat = setup({ mutate: value => { value.channelId = '1000'; value.senders = [{ actorId: 'V-123' }]; } });
  await sendInboxReply(inputFor(await prepareInboxReply('101', chat.options)), chat.options);
  const sent = chat.requests.find(item => item.url.endsWith('/messages') && item.request.method === 'POST');
  assert.equal(JSON.parse(sent.request.body).recipients[0].actorId, 'V-123');
  const invalid = setup({ mutate: value => { value.senders = [{ actorId: 'A-123' }]; } });
  await assert.rejects(prepareInboxReply('101', invalid.options), /verified reply recipient/);
  assert.equal(invalid.posts(), 0);
});
test('a changed channel or recipient and tampered employee context block sending', async () => {
  const s = setup(); const prepared = await prepareInboxReply('101', s.options);
  const changed = setup({ mutate: value => { value.senders[0].deliveryIdentifier.value = 'other@example.test'; } });
  await assert.rejects(sendInboxReply(inputFor(prepared), changed.options), /changed|refresh/i);
  const tampered = { ...inputFor(prepared), contextToken: prepared.contextToken + 'x' };
  await assert.rejects(sendInboxReply(tampered, s.options), /refresh|review/i);
  assert.equal(s.posts() + changed.posts(), 0);
});
test('an uncertain send is frozen and replay cannot send again', async () => {
  const s = setup({ failSend: true }), input = inputFor(await prepareInboxReply('101', s.options));
  await assert.rejects(sendInboxReply(input, s.options), /uncertain/i);
  await assert.rejects(sendInboxReply(input, s.options), /uncertain/i);
  assert.equal(s.posts(), 1);
});
test('HTTP boundary rejects anonymous, foreign origins, extra recipient fields and nonproduction writes', async () => {
  let calls = 0;
  const request = (body, origin = 'https://crm.test') => new Request('https://crm.test/api/inbox-reply', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const s = setup();
  const deps = { getUser: async () => null, editorEmails: user.email, allowedOrigin: 'https://crm.test', writesEnabled: 'true', vercel: '1', vercelEnv: 'production', getLedger: () => s.options.ledger, accessToken: 'synthetic-token', hmacSecret: 's'.repeat(32), prepare: async () => { calls++; return {}; } };
  const body = { action: 'prepare', threadId: '101' };
  assert.equal((await handleInboxReplyRequest(request(body), deps)).status, 401);
  assert.equal((await handleInboxReplyRequest(request(body, 'https://evil.test'), { ...deps, getUser: async () => user })).status, 403);
  assert.equal((await handleInboxReplyRequest(request({ ...body, recipients: [] }), { ...deps, getUser: async () => user })).status, 400);
  assert.equal((await handleInboxReplyRequest(request(body), { ...deps, getUser: async () => user, vercelEnv: 'preview' })).status, 403);
  assert.equal(calls, 0);
});
