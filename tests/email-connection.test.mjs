import test from 'node:test';
import assert from 'node:assert/strict';
import { readEmailConnection } from '../lib/email-connection.mjs';
import { handleEmailInbox } from '../lib/hubspot-email-inbox.mjs';
const email = 'chandler@lgcyap.com';
function setup({ accounts = [], owners = [{ userId: 123, email, archived: false }], inboxType = 'INBOX', portal = 50894788, failed = '' } = {}) {
  const calls = [];
  return { calls, options: { viewerEmail: email, accessToken: 'test-token', inboxId: '10', fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; calls.push({ path, method: init.method });
    if (path.includes(failed) && failed) return Response.json({}, { status: 403 });
    if (path.endsWith('/access-token-info')) return Response.json({ hubId: portal, appId: 59264745 });
    if (path.endsWith('/owners/')) return Response.json({ results: owners });
    if (path.endsWith('/channel-accounts')) return Response.json({ results: accounts });
    if (path.endsWith('/inboxes/10')) return Response.json({ id: '10', type: inboxType });
    assert.fail('Unexpected endpoint');
  } } };
}
const account = { id: '1', inboxId: '10', channelId: '1002', active: true, authorized: true, archived: false, deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: email } };
test('verified app sign-in and HubSpot identity do not imply a connected mailbox', async () => {
  const s = setup(), result = await readEmailConnection(s.options);
  assert.equal(result.webAppEmail, email); assert.equal(result.hubspotIdentity, 'matched'); assert.equal(result.connection, 'connection-required');
  assert.ok(s.calls.every(call => !call.path.endsWith('/messages') && (call.method === 'GET' || call.path.endsWith('/access-token-info'))));
});
test('mail is connected only with one authorized account in the pinned Conversations Inbox', async () => {
  const s = setup({ accounts: [account] });
  assert.equal((await readEmailConnection(s.options)).connection, 'connected');
  assert.equal((await readEmailConnection({ ...s.options, inboxId: '' })).connection, 'private-inbox-required');
  assert.equal((await readEmailConnection(setup({ accounts: [account], inboxType: 'HELP_DESK' }).options)).connection, 'private-inbox-required');
  assert.equal((await readEmailConnection(setup({ accounts: [{ ...account, authorized: false }] }).options)).connection, 'authorization-required');
});
test('a historical channel in the pinned inbox cannot verify a newly reconnected mailbox elsewhere', async () => {
  const s = setup({ accounts: [{ ...account, archived: true, active: false }, { ...account, id: '2', inboxId: '20' }] });
  assert.equal((await readEmailConnection(s.options)).connection, 'private-inbox-required');
});

test('permission failures and wrong credentials never appear as a successful connection', async () => {
  const wrong = setup({ portal: 999, accounts: [account] });
  assert.equal((await readEmailConnection(wrong.options)).connection, 'unavailable'); assert.equal(wrong.calls.length, 1);
  const denied = setup({ accounts: [account], failed: '/channel-accounts' });
  const result = await readEmailConnection(denied.options);
  assert.equal(result.hubspotIdentity, 'matched'); assert.equal(result.connection, 'unavailable');
  assert.equal((await readEmailConnection(setup({ owners: [] }).options)).hubspotIdentity, 'missing');
  assert.equal((await readEmailConnection(setup({ accounts: [account], failed: '/inboxes/10' }).options)).connection, 'unavailable');
});
test('connection metadata is owner-only and other users cannot trigger provider requests', async () => {
  let reads = 0;
  const request = () => new Request('https://crm.test/api/email?connection=1');
  const env = { BETTER_AUTH_URL: 'https://crm.test', RECRUITING_EDITOR_EMAILS: `${email},other@example.test` };
  const deps = { env, readConnection: async () => { reads++; return { canRead: true }; } };
  assert.equal((await handleEmailInbox(request(), { ...deps, getUser: async () => null })).status, 401);
  const other = await handleEmailInbox(request(), { ...deps, getUser: async () => ({ userId: 'other', email: 'other@example.test' }) });
  assert.deepEqual(await other.json(), { canRead: false }); assert.equal(reads, 0);
  const owner = await handleEmailInbox(request(), { ...deps, getUser: async () => ({ userId: 'owner', email }) });
  assert.equal((await owner.json()).canRead, true); assert.equal(reads, 1);
});
