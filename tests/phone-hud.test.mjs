import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneHud, handleQueueRequest } from '../lib/phone-hud.mjs';

const epoch = Date.parse('2026-11-03T15:00:00Z');
const iso = minutes => new Date(epoch - minutes * 60000).toISOString();
function fixture({ fail = '', retry401 = false, dayCalls } = {}) {
  let now = epoch;
  const requests = [];
  let denied = false;
  const reader = createPhoneHud({ refreshToken: 'test-only-refresh', workspaceId: 'test-workspace', clock: () => now, log: () => {}, fetch: async (url, options) => {
    const path = new URL(url).pathname;
    const day = path.endsWith('/calls') && !new URL(url).searchParams.has('status');
    requests.push({ path, day, query: new URL(url).searchParams, options });
    if (fail === 'signin' && path.includes('get-access-token')) return new Response('', { status: 400 });
    if (fail === 'network') throw new Error('private upstream details test-only-refresh');
    if (path.includes('get-access-token')) return Response.json({ data: { accessToken: 'test-only-access' } });
    if (path.endsWith('/calls') && retry401 && !denied) { denied = true; return new Response('', { status: 401 }); }
    if (day && fail === 'day') return new Response('', { status: 500 });
    if (day && dayCalls) return Response.json({ items: dayCalls });
    if (path.includes('get-by-keys')) return Response.json({ data: { sales_agents: ['a', 'b', 'c', 'd', 'e'] } });
    if (path.endsWith('/calls')) return Response.json(fail === 'shape' ? {} : { items: [
      { _id: 'c1', createdAt: iso(4), direction: 'inbound', agent: { _id: 'a', firstName: 'Avery' }, leadSource: { alias: 'Campaign' }, phone: 'private-phone' },
      { _id: 'c2', createdAt: iso(20), agent: { _id: 'b', firstName: 'Blair' } },
      { _id: 'c3', createdAt: iso(10), agent: { _id: 'excluded', firstName: 'Excluded' } },
    ] });
    return Response.json({ items: [
      { userID: 'a', callingStatus: 'available' },
      { userID: 'b', callingStatus: 'available' },
      { userID: 'c', callingStatus: 'available', availableSince: iso(5), employeeInfo: { firstName: 'Casey' }, email: 'private-email' },
      { userID: 'd', callingStatus: 'do_not_disturb' },
      { userID: 'e', callingStatus: 'offline' },
      { userID: 'excluded', callingStatus: 'available' },
    ] });
  } });
  return { reader, requests, advance: ms => { now += ms; } };
}

test('Queue filters statuses, talking and non-sales agents, sorts calls, and strips private fields', async () => {
  const { reader, requests } = fixture();
  const board = await reader.board();
  assert.equal(board.ok, true);
  assert.deepEqual(board.calls.map(c => c.id), ['c2', 'c1']);
  assert.deepEqual(board.available.map(a => a.id), ['c']);
  assert.equal(board.calls[1].source, 'Campaign');
  assert.doesNotMatch(JSON.stringify(board), /private-phone|private-email|test-only/);
  assert.equal(requests.length, 5);
});

test('concurrent screens share one read and the snapshot expires', async () => {
  const { reader, requests, advance } = fixture();
  const [a, b] = await Promise.all([reader.board(), reader.board()]);
  assert.deepEqual(a, b);
  assert.equal(requests.length, 5);
  await reader.board();
  assert.equal(requests.length, 5);
  advance(5000);
  await reader.board();
  assert.equal(requests.length, 7);
});

test('calls today counts calls of any status by sales agents since midnight Eastern, read once a minute', async () => {
  const { reader, requests, advance } = fixture();
  const board = await reader.board();
  assert.deepEqual(board.callsToday, { count: 2, capped: false });
  const query = requests.find(r => r.day).query;
  assert.equal(query.get('createdAt_start'), '2026-11-03T05:00:00.000Z');
  assert.equal(query.get('limit'), '999');
  advance(30000); await reader.board();
  assert.equal(requests.filter(r => r.day).length, 1);
  advance(31000); await reader.board();
  assert.equal(requests.filter(r => r.day).length, 2);
  const full = Array.from({ length: 999 }, (_, i) => ({ _id: `d${i}`, agent: { _id: i % 2 ? 'a' : 'excluded' } }));
  assert.deepEqual((await fixture({ dayCalls: full }).reader.board()).callsToday, { count: 499, capped: true });
});

test('a failed day read leaves the live board working without a call count', async () => {
  const { reader, requests, advance } = fixture({ fail: 'day' });
  const board = await reader.board();
  assert.equal(board.ok, true);
  assert.deepEqual(board.calls.map(c => c.id), ['c2', 'c1']);
  assert.equal(board.callsToday, null);
  advance(5000); await reader.board();
  assert.equal(requests.filter(r => r.day).length, 1);
});

test('one unauthorized upstream read refreshes the token and retries', async () => {
  const { reader, requests } = fixture({ retry401: true });
  assert.equal((await reader.board()).ok, true);
  assert.equal(requests.filter(r => r.path.includes('get-access-token')).length, 2);
});

test('missing setup, expired sign-in, invalid responses and outages yield safe errors', async () => {
  assert.equal((await createPhoneHud().board()).error, 'not_configured');
  for (const [fail, expected] of [['signin', 'policytek_sign_in'], ['shape', 'policytek_down'], ['network', 'policytek_down']]) {
    const result = await fixture({ fail }).reader.board();
    assert.equal(result.error, expected);
    assert.doesNotMatch(JSON.stringify(result), /test-only|private upstream/);
  }
});

test('Queue endpoint denies signed-out, forbidden and cross-origin requests before reading PolicyTek', async () => {
  let reads = 0;
  const options = { getUser: async () => ({ userId: 'test-user' }), allowedOrigin: 'https://crm.example', readBoard: async () => { reads++; return { ok: true, now: epoch, calls: [], available: [] }; }, clock: () => epoch };
  const req = (origin = 'https://crm.example', method = 'POST') => new Request('https://crm.example/api/queue', { method, headers: { Origin: origin } });
  assert.equal((await handleQueueRequest(req(), { ...options, getUser: async () => null })).status, 401);
  assert.equal((await handleQueueRequest(req(), { ...options, authorizeUser: () => false })).status, 403);
  assert.equal((await handleQueueRequest(req('https://outside.example'), options)).status, 403);
  assert.equal((await handleQueueRequest(req(undefined, 'GET'), options)).status, 405);
  assert.equal(reads, 0);
  const response = await handleQueueRequest(req(), options);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(response.headers.get('Vary'), 'Cookie');
  assert.equal((await response.json()).served, epoch);
  assert.equal(reads, 1);
});
