import test from 'node:test';
import assert from 'node:assert/strict';
const OWNER = 'chandler@lgcyap.com';
const options = { viewerEmail: OWNER, userId: 'owner', accessToken: 'synthetic', hmacSecret: 'synthetic-mailbox-hmac-over-thirty-two-characters', inboxId: '10', now: () => Date.parse('2026-11-19T15:00:00Z') };
function fake({ connected = true, authorized = true } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u.pathname);
    if (u.pathname.endsWith('/inboxes/10')) return Response.json({ id: '10', type: 'INBOX' });
    if (u.pathname.endsWith('/channel-accounts')) return Response.json({ results: connected ? [{ id: '1', inboxId: '10', channelId: '1002', active: true, authorized, archived: false, deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: OWNER } }] : [] });
    const thread = { id: '11', inboxId: '10', originalChannelAccountId: '1', originalChannelId: '1002', status: 'OPEN', latestMessageTimestamp: '2026-11-19T14:00:00Z', latestMessageReceivedTimestamp: '2026-11-19T14:00:00Z' };
    if (u.pathname.endsWith('/threads')) return Response.json({ results: [thread, { ...thread, id: '22', originalChannelAccountId: '2', inboxId: '20' }] });
    if (u.pathname.endsWith('/threads/11')) return Response.json(thread);
    if (u.pathname.endsWith('/threads/22')) return Response.json({ ...thread, id: '22', originalChannelAccountId: '2', inboxId: '20' });
    if (u.pathname.endsWith('/messages')) return Response.json({ results: [{ id: 'm1', subject: 'Synthetic incoming subject', text: 'Synthetic body', direction: 'INCOMING', type: 'MESSAGE', channelAccountId: '1', channelId: '1002', createdAt: '2026-11-19T14:00:00Z', senders: [{ name: 'Synthetic sender', deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: 'test@example.invalid' } }] }] });
    throw new Error('Unexpected synthetic path');
  };
  return { fetchImpl, calls };
}
test('Email is owner-only and an unconnected mailbox is never reported as an empty connected inbox', async () => {
  const { readEmailInboxPage } = await import('../lib/hubspot-email-inbox.mjs');
  let reads = 0;
  await assert.rejects(readEmailInboxPage({}, { ...options, viewerEmail: 'other@example.invalid', fetchImpl: () => { reads++; } }), /Chandler/);
  assert.equal(reads, 0);
  for (const setup of [{ connected: false }, { authorized: false }]) {
    const source = fake(setup);
    const result = await readEmailInboxPage({}, { ...options, fetchImpl: source.fetchImpl });
    assert.equal(result.status, 'connection-required');
    assert.equal(result.complete, false);
    assert.match(result.error.message, /connect|authorize/i);
    assert.equal(source.calls.some(path => path.endsWith('/threads')), false);
  }
});
test('received email uses active and archived pagination, exact channel scope and real subjects', async () => {
  const { readEmailInboxPage } = await import('../lib/hubspot-email-inbox.mjs');
  const source = fake();
  const first = await readEmailInboxPage({ archive: 'all' }, { ...options, fetchImpl: source.fetchImpl });
  assert.equal(first.status, 'available');
  assert.deepEqual(first.records.map(row => row.id), ['11']);
  assert.equal(first.records[0].title, 'Synthetic incoming subject');
  assert.match(first.records[0].subtitle, /Synthetic sender/);
  assert.ok(first.continuation);
  const last = await readEmailInboxPage({ archive: 'all', continuation: first.continuation }, { ...options, fetchImpl: source.fetchImpl });
  assert.equal(last.complete, true);
  await assert.rejects(readEmailInboxPage({ archive: 'all', threadId: '22' }, { ...options, fetchImpl: source.fetchImpl }), /mailbox/i);
  assert.equal(source.calls.some(path => path.includes('/22/messages')), false);
});
test('API rejects other users before reading provider metadata or accepting a browser mailbox selector', async () => {
  const { handleEmailInbox } = await import('../lib/hubspot-email-inbox.mjs');
  const env = { BETTER_AUTH_URL: 'https://crm.example.invalid', RECRUITING_EDITOR_EMAILS: OWNER + ',other@example.invalid' };
  const request = body => new Request(`${env.BETTER_AUTH_URL}/api/email`, { method: 'POST', headers: { Origin: env.BETTER_AUTH_URL, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const read = () => { throw new Error('Must not read'); };
  assert.equal((await handleEmailInbox(request({}), { env, getUser: async () => ({ userId: 'other', email: 'other@example.invalid' }), read })).status, 403);
  assert.equal((await handleEmailInbox(request({ mailbox: 'other@example.invalid' }), { env, getUser: async () => ({ userId: 'owner', email: OWNER }), read })).status, 400);
});
test('archived conversations remain readable after active-thread lookup returns 404', async () => {
  const { readEmailInboxPage } = await import('../lib/hubspot-email-inbox.mjs');
  const original = fake();
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/threads/11') && u.searchParams.get('archived') !== 'true') return Response.json({}, { status: 404 });
    return original.fetchImpl(url, init);
  };
  const result = await readEmailInboxPage({ threadId: '11', archive: 'all' }, { ...options, fetchImpl });
  assert.equal(result.status, 'available');
  assert.equal(result.messages[0].text, 'Synthetic body');
});
test('source uses supported ID pagination and only one explicitly configured non-Help-Desk inbox', async () => {
  const { readEmailInboxPage } = await import('../lib/hubspot-email-inbox.mjs');
  const original = fake();
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/threads')) {
      assert.equal(u.searchParams.get('sort'), 'id');
      assert.deepEqual(u.searchParams.getAll('inboxId'), ['10']);
    }
    if (u.pathname.endsWith('/inboxes/10')) return Response.json({ id: '10', type: 'INBOX' });
    return original.fetchImpl(url, init);
  };
  assert.equal((await readEmailInboxPage({}, { ...options, inboxId: '10', fetchImpl })).status, 'available');
  assert.equal((await readEmailInboxPage({}, { ...options, inboxId: '', fetchImpl })).status, 'connection-required');
  const helpDesk = async (url, init) => new URL(url).pathname.endsWith('/inboxes/10') ? Response.json({ id: '10', type: 'HELP_DESK' }) : fetchImpl(url, init);
  assert.equal((await readEmailInboxPage({}, { ...options, inboxId: '10', fetchImpl: helpDesk })).status, 'connection-required');
});
test('received email preview uses incoming email, excludes outbound-only threads and ignores comment events', async () => {
  const { readEmailInboxPage } = await import('../lib/hubspot-email-inbox.mjs');
  const original = fake();
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/messages')) return Response.json({ results: [
      { id: 'outgoing', type: 'MESSAGE', direction: 'OUTGOING', channelAccountId: '1', channelId: '1002', subject: 'Chandler reply' },
      { id: 'comment', type: 'COMMENT', channelAccountId: '1', subject: 'Internal comment' },
      { id: 'incoming', type: 'MESSAGE', direction: 'INCOMING', channelAccountId: '1', channelId: '1002', subject: 'Original incoming subject', senders: [{ name: 'Actual sender' }] },
    ] });
    const response = await original.fetchImpl(url, init);
    if (u.pathname.endsWith('/threads')) {
      const data = await response.json();
      data.results.push({ ...data.results[0], id: '33', latestMessageReceivedTimestamp: null });
      return Response.json(data);
    }
    return response;
  };
  const result = await readEmailInboxPage({}, { ...options, fetchImpl });
  assert.deepEqual(result.records.map(row => row.id), ['11']);
  assert.equal(result.records[0].title, 'Original incoming subject');
  assert.equal(result.records[0].subtitle, 'Actual sender');
});

test('a mailbox moved to another inbox cannot activate a historical pinned channel', async () => {
  const { readEmailInboxPage } = await import('../lib/hubspot-email-inbox.mjs');
  const original = fake();
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname.endsWith('/channel-accounts')) return Response.json({ results: [
      { id: '1', inboxId: '10', channelId: '1002', active: false, authorized: true, archived: true, deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: 'chandler@lgcyap.com' } },
      { id: '2', inboxId: '20', channelId: '1002', active: true, authorized: true, archived: false, deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: 'chandler@lgcyap.com' } },
    ] });
    assert.ok(!new URL(url).pathname.endsWith('/threads'), 'must not fetch a falsely activated mailbox');
    return original.fetchImpl(url, init);
  };
  const result = await readEmailInboxPage({}, { ...options, inboxId: '10', fetchImpl });
  assert.equal(result.status, 'connection-required');
  assert.equal(result.error.code, 'PRIVATE_INBOX_SETUP_REQUIRED');
});
