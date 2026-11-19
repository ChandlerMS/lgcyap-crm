import test from 'node:test';
import assert from 'node:assert/strict';
const OWNER = 'chandler@lgcyap.com';
const accounts = [{ id: '1', inboxId: '10', channelId: '1002', active: true, authorized: true, archived: false, name: 'Owner', deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: OWNER } }, { id: '2', inboxId: '20', channelId: '1002', active: true, authorized: true, archived: false, deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: 'support@example.invalid' } }];
const privateThread = { id: '11', inboxId: '10', originalChannelAccountId: '1', originalChannelId: '1002' };
const publicThread = { id: '22', inboxId: '20', originalChannelAccountId: '2', originalChannelId: '1002' };
function provider(rows = accounts) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname; calls.push({ path, init });
    if (path.endsWith('/channel-accounts')) return Response.json({ results: rows });
    if (path.endsWith('/threads')) return Response.json({ results: [privateThread, publicThread], paging: { next: { after: 'next' } } });
    if (path.endsWith('/threads/11')) return Response.json(privateThread);
    if (path.endsWith('/threads/22')) return Response.json(publicThread);
    if (path.endsWith('/messages')) return Response.json({ results: [{ id: 'm1', channelAccountId: path.includes('/11/') ? '1' : '2', text: 'Synthetic message' }] });
    throw new Error('Unexpected synthetic URL');
  };
  return { fetchImpl, calls };
}
test('discovers exact authorized email rather than a name and reports disconnected states', async () => {
  const { readMailboxAccounts, privateMailboxConnection } = await import('../lib/hubspot-mailbox.mjs');
  const data = await readMailboxAccounts({ accessToken: 'synthetic', fetchImpl: provider().fetchImpl });
  assert.equal(privateMailboxConnection(data).status, 'connected');
  assert.deepEqual(privateMailboxConnection(data).accountIds, ['1']);
  assert.equal(privateMailboxConnection([accounts[1]]).status, 'connection-required');
  assert.equal(privateMailboxConnection([{ ...accounts[0], authorized: false }]).status, 'authorization-required');
  assert.equal(privateMailboxConnection([{ ...accounts[1], name: OWNER }]).status, 'connection-required');
});
test('other CRM users cannot list or open Chandler threads through generic Conversations requests', async () => {
  const { privateMailboxFetch } = await import('../lib/hubspot-mailbox.mjs');
  const fake = provider();
  const safe = privateMailboxFetch({ viewerEmail: 'editor@example.invalid', accessToken: 'synthetic', fetchImpl: fake.fetchImpl });
  const response = await safe('https://api.hubapi.com/conversations/v3/conversations/threads?limit=100');
  const page = await response.json();
  assert.deepEqual(page.results.map(row => row.id), ['22']);
  assert.equal(page.paging.next.after, 'next');
  assert.equal((await safe('https://api.hubapi.com/conversations/v3/conversations/threads/11/messages')).status, 403);
  assert.equal(fake.calls.some(call => call.path.endsWith('/11/messages')), false);
  assert.equal((await safe('https://api.hubapi.com/conversations/v3/conversations/threads/11/messages', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await safe('https://api.hubapi.com/conversations/v3/conversations/threads/22/messages')).status, 200);
});
test('owner can read mailbox and unverified non-owner thread identities fail closed', async () => {
  const { privateMailboxFetch } = await import('../lib/hubspot-mailbox.mjs');
  const fake = provider();
  const owner = privateMailboxFetch({ viewerEmail: OWNER, accessToken: 'synthetic', fetchImpl: fake.fetchImpl });
  assert.equal((await owner('https://api.hubapi.com/conversations/v3/conversations/threads/11/messages')).status, 200);
  const safe = privateMailboxFetch({ viewerEmail: 'editor@example.invalid', accessToken: 'synthetic', fetchImpl: async url => new URL(url).pathname.endsWith('/channel-accounts') ? Response.json({ results: accounts }) : Response.json({ results: [{ id: '33' }] }) });
  assert.deepEqual((await (await safe('https://api.hubapi.com/conversations/v3/conversations/threads')).json()).results, []);
});
test('verified public threads retain system and comment events while mixed private messages stay hidden', async () => {
  const { privateMailboxFetch } = await import('../lib/hubspot-mailbox.mjs');
  const original = provider();
  const fetchImpl = async (url, init) => new URL(url).pathname.endsWith('/22/messages') ? Response.json({ results: [{ id: 'comment', type: 'COMMENT', text: 'Synthetic public note' }, { id: 'status', type: 'THREAD_STATUS_CHANGE' }, { id: 'private', type: 'MESSAGE', channelAccountId: '1' }] }) : original.fetchImpl(url, init);
  const safe = privateMailboxFetch({ viewerEmail: 'other@example.invalid', accessToken: 'synthetic', fetchImpl });
  const page = await (await safe('https://api.hubapi.com/conversations/v3/conversations/threads/22/messages')).json();
  assert.deepEqual(page.results.map(row => row.id), ['comment', 'status']);
});
test('filtering private rows does not turn a repeated nonempty provider page into false completion', async () => {
  const { privateMailboxFetch } = await import('../lib/hubspot-mailbox.mjs');
  const { readInboxPage } = await import('../lib/hubspot-inbox.mjs');
  const original = provider();
  const fetchImpl = async (url, init) => new URL(url).pathname.endsWith('/threads') ? Response.json({ results: [privateThread], paging: { next: { after: 'same-cursor' } } }) : original.fetchImpl(url, init);
  const guarded = privateMailboxFetch({ viewerEmail: 'other@example.invalid', accessToken: 'synthetic', fetchImpl });
  const context = { userId: 'other', accessToken: 'synthetic', hmacSecret: 'synthetic-test-secret-over-thirty-two-characters', fetchImpl: guarded };
  const first = await readInboxPage({ archive: 'active' }, context);
  const second = await readInboxPage({ archive: 'active', continuation: first.continuation }, context);
  assert.equal(second.complete, false);
  assert.equal(second.paginationWarning.code, 'CURSOR_REPEATED');
});
test('authorized public conversation status updates reach HubSpot rather than returning cached metadata', async () => {
  const { privateMailboxFetch } = await import('../lib/hubspot-mailbox.mjs');
  const original = provider(); let patches = 0;
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).pathname.endsWith('/threads/22') && init.method === 'PATCH') { patches++; return Response.json({ ...publicThread, status: 'CLOSED' }); }
    return original.fetchImpl(url, init);
  };
  const guarded = privateMailboxFetch({ viewerEmail: 'other@example.invalid', accessToken: 'synthetic', fetchImpl });
  const response = await guarded('https://api.hubapi.com/conversations/v3/conversations/threads/22', { method: 'PATCH', body: JSON.stringify({ status: 'CLOSED' }) });
  assert.equal((await response.json()).status, 'CLOSED');
  assert.equal(patches, 1);
  assert.equal((await guarded('https://api.hubapi.com/conversations/v3/conversations/threads/11', { method: 'PATCH', body: '{}' })).status, 403);
  assert.equal(patches, 1);
});
