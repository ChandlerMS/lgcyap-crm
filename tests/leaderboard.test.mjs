import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLeaderboardDeals, handleLeaderboardRequest, LEADERBOARD_DEAL_SCHEMA, readLeaderboard, validateLeaderboardInput } from '../lib/leaderboard.mjs';
import { leaderboardPeriod } from '../lib/leaderboard-period.mjs';

const NOW = Date.parse('2026-10-30T16:00:00.000Z');
const input = { board: 'sp', period: 'day' };
const options = { accessToken: 'test-server-only-token', now: () => NOW, pause: async () => {} };
const tokenInfo = { hubId: 50894788, appId: 59264745, scopes: ['crm.objects.deals.read'] };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
function deal(id, agent = 'Synthetic Agent', amount = '1200', overrides = {}) {
  return { id, archived: false, properties: { writing_agent_name: agent, annual_premium_amount: amount, closedate: '2026-10-30T12:00:00.000Z', pipeline: 'default', dealstage: 'closedwon', hs_is_closed_won: 'true', deal_currency_code: 'USD', customer_name: 'Never expose this', ...overrides } };
}
function provider(pages, info = tokenInfo) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return url.includes('access-token-info') ? json(info) : typeof pages === 'function' ? pages(calls.length - 2) : json(pages.shift()); };
  return { calls, fetchImpl };
}

test('leaderboard calendar periods use Eastern dates and Monday starts across UTC/year boundaries', () => {
  let period = leaderboardPeriod('day', '2026-10-30T03:59:59Z');
  assert.equal(period.startDate, '2026-10-29'); assert.equal(period.endDate, '2026-10-29');
  assert.equal(new Date(period.startMs).toISOString(), '2026-10-29T04:00:00.000Z');
  period = leaderboardPeriod('week', '2027-01-03T20:00:00Z');
  assert.equal(period.startDate, '2026-12-28'); assert.equal(period.endDate, '2027-01-03');
  assert.equal(leaderboardPeriod('month', '2028-02-29T20:00:00Z').startDate, '2028-02-01');
  assert.throws(() => leaderboardPeriod('year', NOW), /valid/);
  assert.throws(() => leaderboardPeriod('day', 'invalid'), /valid/);
});
test('Eastern full-day bounds include all 23/25-hour daylight saving days', () => {
  const spring = leaderboardPeriod('day', '2026-03-08T16:00:00Z'), fall = leaderboardPeriod('day', '2026-11-01T16:00:00Z');
  assert.equal(spring.endMs - spring.startMs, 23 * 3600000);
  assert.equal(fall.endMs - fall.startMs, 25 * 3600000);
});
test('aggregation counts Sold deals and adds decimal premiums exactly without exposing customer fields', () => {
  const result = aggregateLeaderboardDeals([deal('1', 'Synthetic A', '0.1'), deal('2', 'Synthetic A', '0.2'), deal('3', 'Synthetic B', '2.675'), deal('4', 'Synthetic C', '-2.675')], leaderboardPeriod('day', NOW));
  assert.deepEqual(result.rows, [{ name: 'Synthetic A', attributed: true, sales: 2, annualPremium: .3 }, { name: 'Synthetic B', attributed: true, sales: 1, annualPremium: 2.68 }, { name: 'Synthetic C', attributed: true, sales: 1, annualPremium: -2.68 }]);
  assert.doesNotMatch(JSON.stringify(result), /Never expose|customer_name|closedate|"id"/);
});
test('missing attribution and missing/foreign-currency premiums are explicit rather than fabricated zero', () => {
  const result = aggregateLeaderboardDeals([deal('1', '', null), deal('2', 'Synthetic A', '200'), deal('3', 'Synthetic A', 'bad'), deal('4', 'Synthetic B', '200', { deal_currency_code: 'EUR' })], leaderboardPeriod('day', NOW));
  assert.equal(result.missingAgentCount, 1); assert.equal(result.missingPremiumCount, 3);
  assert.equal(result.rows.find(row => row.name === 'Synthetic A').annualPremium, null);
  assert.equal(result.rows.find(row => row.name === 'Writing agent not recorded').sales, 1);
  assert.equal(result.rows.find(row => row.name === 'Writing agent not recorded').attributed, false);
});
test('invalid stage, currency-independent filter mismatch, or out-of-window records fail closed', () => {
  for (const override of [{ pipeline: 'other' }, { dealstage: 'closedlost' }, { hs_is_closed_won: 'false' }, { closedate: '2026-10-31T04:00:00Z' }, { closedate: 'invalid' }]) assert.throws(() => aggregateLeaderboardDeals([deal('1', 'Synthetic', '1', override)], leaderboardPeriod('day', NOW)));
});
test('PolicyTek boards stay disconnected and missing HubSpot token never calls a provider', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw Error('must not call'); };
  for (const board of ['shopper', 'source', 'sp']) {
    const result = await readLeaderboard({ board, period: 'day' }, { fetchImpl, now: () => NOW });
    assert.equal(result.status, 'connection-required'); assert.deepEqual(result.rows, []);
    if (board !== 'sp') assert.equal(result.notice, 'PolicyTek data is not connected to this app.');
  }
  assert.equal(calls, 0);
});
test('deal reads require exact portal, internal app, and read scope before any deal request', async () => {
  for (const info of [{ ...tokenInfo, hubId: 123 }, { ...tokenInfo, appId: 123 }, { ...tokenInfo, scopes: [] }]) {
    const p = provider([], info), result = await readLeaderboard(input, { ...options, fetchImpl: p.fetchImpl });
    assert.equal(result.status, 'connection-required'); assert.equal(p.calls.length, 1); assert.deepEqual(result.rows, []);
  }
  assert.equal(LEADERBOARD_DEAL_SCHEMA.scope, 'crm.objects.deals.read');
});
test('bounded pagination sends only verified properties/filters and deduplicates deal IDs', async () => {
  const p = provider([{ total: 2, results: [deal('1')], paging: { next: { after: '1' } } }, { total: 2, results: [deal('1'), deal('2')] }]);
  const result = await readLeaderboard(input, { ...options, fetchImpl: p.fetchImpl });
  assert.equal(result.status, 'available'); assert.equal(result.rows[0].sales, 2); assert.equal(result.rows[0].annualPremium, 2400); assert.equal(result.partial, true);
  assert.equal(p.calls.length, 3);
  for (const call of p.calls) assert.equal(call.init.redirect, 'error');
  assert.ok(p.calls.every(call => !call.url.includes(options.accessToken)));
  const query = JSON.parse(p.calls[1].init.body);
  assert.equal(query.limit, 200); assert.ok(query.properties.includes('deal_currency_code')); assert.equal(query.properties.includes('dealname'), false);
  assert.deepEqual(query.filterGroups[0].filters.slice(0, 3).map(filter => filter.value), ['default', 'closedwon', 'true']);
  assert.equal(JSON.parse(p.calls[2].init.body).after, '1');
  assert.doesNotMatch(JSON.stringify(result), /test-server-only-token|Never expose/);
});
test('a complete empty result is available while repeated cursors and malformed pages are unavailable', async () => {
  const empty = provider([{ total: 0, results: [] }]);
  const result = await readLeaderboard(input, { ...options, fetchImpl: empty.fetchImpl }); assert.equal(result.status, 'available'); assert.equal(result.partial, false); assert.deepEqual(result.rows, []);
  const repeated = provider([{ total: 3, results: [deal('1')], paging: { next: { after: '1' } } }, { total: 3, results: [deal('2')], paging: { next: { after: '1' } } }]);
  const failure = await readLeaderboard(input, { ...options, fetchImpl: repeated.fetchImpl }); assert.equal(failure.status, 'unavailable'); assert.deepEqual(failure.rows, []);
});
test('rate limits propagate a bounded cooldown without automatically retrying', async () => {
  const p = provider(() => json({ message: 'provider details must not leak' }, 429, { 'Retry-After': '17' }));
  const result = await readLeaderboard(input, { ...options, fetchImpl: p.fetchImpl });
  assert.equal(result.status, 'unavailable'); assert.equal(result.retryAfterSeconds, 17); assert.equal(p.calls.length, 2); assert.deepEqual(result.rows, []);
  assert.doesNotMatch(JSON.stringify(result), /provider details/);
});
test('a nearly exhausted read budget returns an explicitly partial loaded ranking without another request', async () => {
  let clock = NOW, calls = 0;
  const fetchImpl = async url => {
    calls++;
    if (url.includes('access-token-info')) return json(tokenInfo);
    clock = NOW + 600;
    return json({ total: 2, results: [deal('1')], paging: { next: { after: '1' } } });
  };
  const result = await readLeaderboard(input, { ...options, now: () => clock, fetchImpl, budgetMs: 1000, pause: async () => { clock += 300; } });
  assert.equal(calls, 2); assert.equal(result.status, 'available'); assert.equal(result.partial, true); assert.equal(result.rows[0].sales, 1); assert.match(result.notice, /limited set/);
});
test('input and HTTP boundary require exact JSON shape, sign-in, allowlist and same origin', async () => {
  for (const bad of [{}, { board: 'sp', period: 'year' }, { ...input, token: 'x' }, [], null]) assert.throws(() => validateLeaderboardInput(bad));
  let reads = 0; const boundary = { getUser: async () => ({ email: 'test@example.invalid' }), authorizeUser: () => true, allowedOrigin: 'https://lgcyap-crm.vercel.app', readData: async selected => { reads++; return { ...selected, status: 'available', rows: [] }; } };
  const request = (overrides = {}) => new Request('https://lgcyap-crm.vercel.app/api/leaderboard', { method: 'POST', headers: { Origin: 'https://lgcyap-crm.vercel.app', 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...overrides });
  assert.equal((await handleLeaderboardRequest(request(), { ...boundary, getUser: async () => null })).status, 401);
  assert.equal((await handleLeaderboardRequest(request(), { ...boundary, authorizeUser: () => false })).status, 403);
  assert.equal((await handleLeaderboardRequest(request({ headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } }), boundary)).status, 403);
  assert.equal((await handleLeaderboardRequest(request({ body: 'x'.repeat(513) }), boundary)).status, 413);
  assert.equal((await handleLeaderboardRequest(request({ body: '{' }), boundary)).status, 400);
  const response = await handleLeaderboardRequest(request(), boundary); assert.equal(response.status, 200); assert.equal(reads, 1); assert.match(response.headers.get('Cache-Control'), /private.*no-store/); assert.equal(response.headers.get('Vary'), 'Cookie');
});
