import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardCustomPeriod, leaderboardQuickRange, leaderboardMonthOptions, leaderboardMonthWeeks, leaderboardMonthRange } from '../lib/leaderboard-period.mjs';
import { readLeaderboardCalls, attachLeaderboardCalls } from '../lib/leaderboard-calls.mjs';
import { readLeaderboard, validateLeaderboardInput, handleLeaderboardRequest } from '../lib/leaderboard.mjs';

test('custom dates validate real calendar days, inclusive bounds, leap years and 366 day maximum', () => {
  assert.equal(leaderboardCustomPeriod('2026-03-08').endMs - leaderboardCustomPeriod('2026-03-08').startMs, 23 * 3600000);
  assert.equal(leaderboardCustomPeriod('2026-11-01').endMs - leaderboardCustomPeriod('2026-11-01').startMs, 25 * 3600000);
  assert.equal(leaderboardCustomPeriod('2028-01-01', '2028-12-31').endDate, '2028-12-31');
  for (const dates of [['2026-02-29'], ['2026-02-30'], ['2026-13-01'], ['2026-01-02', '2026-01-01'], ['2028-01-01', '2029-01-01'], ['', '']]) assert.throws(() => leaderboardCustomPeriod(...dates));
});
test('quick ranges use prior Eastern calendar periods across year boundaries', () => {
  assert.deepEqual(leaderboardQuickRange('yesterday', Date.parse('2027-01-01T02:00:00Z')), { from: '2026-12-30', to: '2026-12-30' });
  assert.deepEqual(leaderboardQuickRange('lastweek', Date.parse('2026-11-03T15:00:00Z')), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(leaderboardQuickRange('lastmonth', Date.parse('2027-01-03T15:00:00Z')), { from: '2026-12-01', to: '2026-12-31' });
});
test('month picker offers the last 12 Eastern months, oldest first, across the year boundary', () => {
  const months = leaderboardMonthOptions(Date.parse('2027-01-01T03:00:00Z'));
  assert.equal(months.length, 12);
  assert.deepEqual([months[0], months.at(-1)], [{ key: '2026-01', label: 'January 2026' }, { key: '2026-12', label: 'December 2026' }]);
  assert.equal(leaderboardMonthOptions(Date.parse('2027-03-15T15:00:00Z')).at(-1).key, '2027-03');
});
test('month weeks are Monday–Sunday, clipped to the month and to today', () => {
  const past = leaderboardMonthWeeks('2027-02', Date.parse('2027-06-01T15:00:00Z'));
  assert.deepEqual(past.map(({ from, to }) => [from, to]), [['2027-02-01', '2027-02-07'], ['2027-02-08', '2027-02-14'], ['2027-02-15', '2027-02-21'], ['2027-02-22', '2027-02-28']]);
  const current = leaderboardMonthWeeks('2026-11', Date.parse('2026-11-03T15:00:00Z'));
  assert.deepEqual(current.map(({ week, from, to, available, label }) => [week, from, to, available, label]), [
    [1, '2026-11-01', '2026-11-01', true, 'Nov 1'], [2, '2026-11-02', '2026-11-03', true, 'Nov 2 – Nov 8'], [3, '2026-11-09', '2026-11-15', false, 'Nov 9 – Nov 15'],
    [4, '2026-11-16', '2026-11-22', false, 'Nov 16 – Nov 22'], [5, '2026-11-23', '2026-11-29', false, 'Nov 23 – Nov 29'], [6, '2026-11-30', '2026-11-30', false, 'Nov 30'],
  ]);
  assert.deepEqual(leaderboardMonthRange('2026-11', Date.parse('2026-11-03T15:00:00Z')), { from: '2026-11-01', to: '2026-11-03' });
  assert.deepEqual(leaderboardMonthRange('2026-10', Date.parse('2026-11-03T15:00:00Z')), { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(leaderboardMonthRange('2026-12', Date.parse('2026-11-03T15:00:00Z')), null);
  for (const invalid of ['2026-13', '2026-1', '', null]) assert.throws(() => leaderboardMonthWeeks(invalid));
});
test('custom API contract rejects missing or extra dates and preserves validated range', () => {
  const input = { board: 'sp', period: 'custom', from: '2026-10-01', to: '2026-10-31' };
  assert.deepEqual(validateLeaderboardInput(input), input);
  for (const invalid of [{ ...input, to: undefined }, { board: 'sp', period: 'custom' }, { board: 'sp', period: 'day', from: input.from, to: input.to }, { ...input, token: 'no' }]) assert.throws(() => validateLeaderboardInput(invalid));
});
const bounds = leaderboardCustomPeriod('2026-11-02');
const call = (id, owner = '10') => ({ id, properties: { hs_timestamp: '2026-11-02T12:00:00Z', hs_call_direction: 'INBOUND', hubspot_owner_id: owner } });
test('call pages aggregate only in-range inbound logs and request no customer fields', async () => {
  const requests = [], pages = [{ total: 3, results: [call('1'), call('2')], paging: { next: { after: '2' } } }, { total: 3, results: [call('3', null)] }];
  const result = await readLeaderboardCalls(bounds, { request: async body => { requests.push(body); return pages.shift(); }, remaining: () => 8000, pause: async () => {} });
  assert.equal(result.total, 3); assert.equal(result.byOwner.get('10'), 2); assert.equal(result.partial, false);
  assert.equal(requests[1].after, '2'); assert.deepEqual(requests[0].properties, ['hs_timestamp', 'hs_call_direction', 'hubspot_owner_id']);
});
test('call reads flag duplicate ids and incomplete totals and reject bad or repeated cursors', async () => {
  const run = pages => readLeaderboardCalls(bounds, { request: async () => pages.shift(), remaining: () => 8000, pause: async () => {} });
  assert.equal((await run([{ total: 2, results: [call('1'), call('1')] }])).partial, true);
  assert.equal((await run([{ total: 10001, results: [call('1')], paging: { next: { after: '10000' } } }])).partial, true);
  await assert.rejects(run([{ total: 4, results: [call('1')], paging: { next: { after: '1' } } }, { total: 4, results: [call('2')], paging: { next: { after: '1' } } }]));
  await assert.rejects(run([{ total: 1, results: [{ ...call('1'), properties: { ...call('1').properties, hs_call_direction: 'OUTBOUND' } }] }]));
});
test('exhausted call budget returns unavailable, never a fake zero', async () => {
  let requests = 0;
  const result = await readLeaderboardCalls(bounds, { request: async () => { requests++; }, remaining: () => 0, pause: async () => {} });
  assert.equal(requests, 0); assert.equal(result.total, null); assert.equal(result.status, 'unavailable');
});
test('owner log attribution withholds ambiguous, missing and incomplete data', () => {
  const rows = [{ name: 'Agent A', sales: 2 }, { name: 'Agent B', sales: 1 }], deals = (name, owner) => ({ properties: { writing_agent_name: name, hubspot_owner_id: owner } });
  const logs = { status: 'available', partial: false, byOwner: new Map([['10', 4], ['20', 8]]) };
  assert.equal(attachLeaderboardCalls(rows, [deals('Agent A', '10')], logs, false)[0].soldPerInboundLog, .5);
  for (const input of [[deals('Agent A', '10'), deals('Agent B', '10')], [deals('Agent A', '10'), deals('Agent A', '20')], [deals('Agent A', null)]]) assert.equal(attachLeaderboardCalls(rows, input, logs, false)[0].inboundCalls, null);
  assert.equal(attachLeaderboardCalls(rows, [deals('Agent A', '10')], logs, true)[0].inboundCalls, null);
  assert.equal(attachLeaderboardCalls(rows, [deals('Agent A', '10')], { ...logs, partial: true }, false)[0].soldPerInboundLog, null);
});
test('optional call provider failure preserves sold-policy data and exposes no provider detail', async () => {
  const fetchImpl = async url => new Response(JSON.stringify(url.includes('access-token-info') ? { hubId: 50894788, appId: 59264745, scopes: ['crm.objects.deals.read', 'crm.objects.contacts.read'] } : url.includes('/deals/') ? { total: 0, results: [] } : { message: 'private detail' }), { status: url.includes('/calls/') ? 403 : 200 });
  const result = await readLeaderboard({ board: 'sp', period: 'custom', from: '2026-11-02', to: '2026-11-02' }, { accessToken: 'synthetic', fetchImpl, now: () => bounds.startMs, pause: async () => {} });
  assert.equal(result.status, 'available'); assert.equal(result.calls.total, null); assert.equal(result.calls.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(result), /private detail|synthetic/);
});
test('custom request preserves server authentication and rejects malformed dates before provider access', async () => {
  let reads = 0;
  const opts = { allowedOrigin: 'https://lgcyap-crm.vercel.app', getUser: async () => ({}), authorizeUser: () => true, readData: async () => { reads++; } };
  const request = () => new Request('https://lgcyap-crm.vercel.app/api/leaderboard', { method: 'POST', headers: { Origin: opts.allowedOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'sp', period: 'custom', from: '2026-02-30', to: '2026-03-01' }) });
  assert.equal((await handleLeaderboardRequest(request(), { ...opts, getUser: async () => null })).status, 401);
  assert.equal((await handleLeaderboardRequest(request(), opts)).status, 400); assert.equal(reads, 0);
});
