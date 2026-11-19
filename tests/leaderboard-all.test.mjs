import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { aggregateLeaderboardDeals, handleLeaderboardRequest, validateLeaderboardInput } from '../lib/leaderboard.mjs';
import { applySvpCalls } from '../lib/svp-calls.mjs';

const NOW = Date.parse('2026-11-02T04:59:59.999Z'); // Just before Eastern midnight after the DST change.
const selection = { board: 'all', period: 'day' };
const bounds = { startDate: '2026-11-01', endDate: '2026-11-01' };
function shopper(overrides = {}) {
  return { board: 'shopper', period: 'day', status: 'available', source: 'PolicyTek · browser sync', ...bounds,
    rows: [{ name: 'Synthetic Agent', leads: 10, quoted: 8, submitted: 2, premium: .1, spend: 0 }],
    reportTotals: { leads: 15, quoted: 10, submitted: 3, premium: .2, spend: 0 }, partial: false, stale: false,
    fetchedAt: '2026-11-02T04:45:00.000Z', notice: 'PolicyTek report totals include all activity.', ...overrides };
}
function standardPreferred(overrides = {}) {
  return { board: 'sp', period: 'day', status: 'available', source: 'HubSpot · RingCX', ...bounds,
    rows: [{ name: 'Synthetic Agent', attributed: true, sales: 4, annualPremium: .2, inboundCalls: 20, soldPerInboundLog: .1 }],
    calls: { status: 'available', total: 30, partial: false, soldPerInboundLog: .1, basis: 'ringcx', connected: 35, abandoned: 5 },
    partial: false, stale: false, fetchedAt: '2026-11-02T04:59:59.999Z', notice: 'HubSpot sales totals.', callNotice: 'RingCX effective calls.', ...overrides };
}
async function read(input = selection, first = shopper(), second = standardPreferred(), extra = {}) {
  const { readAllLeaderboard } = await import('../lib/leaderboard-all.mjs');
  return readAllLeaderboard(input, { readShopper: async () => first, readStandardPreferred: async () => second, now: () => NOW, ...extra });
}

test('All is admitted by the same strict JSON and authenticated HTTP boundary', async () => {
  assert.deepEqual(validateLeaderboardInput(selection), selection);
  assert.deepEqual(validateLeaderboardInput({ board: 'all', period: 'custom', from: '2026-10-01', to: '2026-10-03' }), { board: 'all', period: 'custom', from: '2026-10-01', to: '2026-10-03' });
  for (const input of [{ ...selection, extra: true }, { ...selection, from: '2026-10-01', to: '2026-10-03' }, { board: 'all', period: 'custom', from: '2026-10-03', to: '2026-10-01' }]) assert.throws(() => validateLeaderboardInput(input));
  let reads = 0;
  const request = origin => new Request('https://app.example/api/leaderboard', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
  const options = { getUser: async () => ({}), authorizeUser: () => true, allowedOrigin: 'https://app.example', readData: async input => { reads++; return { ...input, status: 'available', rows: [] }; } };
  assert.equal((await handleLeaderboardRequest(request('https://app.example'), { ...options, getUser: async () => null })).status, 401);
  assert.equal((await handleLeaderboardRequest(request('https://app.example'), { ...options, authorizeUser: () => false })).status, 403);
  assert.equal((await handleLeaderboardRequest(request('https://other.example'), options)).status, 403);
  const response = await handleLeaderboardRequest(request('https://app.example'), options);
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
});

test('All adds each board while top totals retain activity outside named ranking rows', async () => {
  const result = await read();
  assert.equal(result.board, 'all'); assert.equal(result.period, 'day'); assert.equal(result.source, 'PolicyTek + HubSpot');
  assert.equal(result.status, 'available'); assert.equal(result.partial, false); assert.equal(result.stale, false);
  assert.deepEqual(result.rows, [{ name: 'Synthetic Agent', attributed: true, sales: 6, annualPremium: .3, inboundCalls: 30, soldPerInboundLog: .2 }]);
  assert.deepEqual(result.combinedTotals, { sales: 7, annualPremium: .4, calls: 45, closeRate: 7 / 45 });
  assert.deepEqual(result.calls, { status: 'available', total: 45, partial: false, soldPerInboundLog: 7 / 45 });
  assert.equal(result.fetchedAt, '2026-11-02T04:45:00.000Z');
  assert.equal(result.startDate, '2026-11-01'); assert.equal(result.endDate, '2026-11-01');
  assert.match(result.notice, /leads.*calls|calls.*leads/i);
  assert.match(result.notice, /PolicyTek report totals/); assert.match(result.notice, /HubSpot sales totals/); assert.match(result.notice, /RingCX effective calls/);
  assert.doesNotMatch(JSON.stringify(result), /connected|abandoned|distinct|unique|quoted|spend/);
});

test('names match only by NFC, surrounding/repeated whitespace and lowercase', async () => {
  const first = shopper({ rows: [
    { name: '  JOSÉ \t Agent ', leads: 3, submitted: 2, premium: 1.11 },
    { name: 'Jose Agent', leads: 4, submitted: 1, premium: 2.22 },
    { name: 'Joseph Agent', leads: 1, submitted: 1, premium: 3.33 },
    { name: '', attributed: false, leads: 2, submitted: 1, premium: 4.44 },
  ] });
  const second = standardPreferred({ rows: [
    { name: 'jose\u0301 agent', attributed: true, sales: 3, annualPremium: .09, inboundCalls: 7 },
    { name: 'Joe Agent', attributed: true, sales: 1, annualPremium: -.22, inboundCalls: 2 },
    { name: 'Writing agent not recorded', attributed: false, sales: 1, annualPremium: 5.55, inboundCalls: null },
  ] });
  const result = await read(selection, first, second);
  assert.equal(result.rows.length, 6);
  assert.deepEqual(result.rows[0], { name: 'JOSÉ Agent', attributed: true, sales: 5, annualPremium: 1.2, inboundCalls: 10, soldPerInboundLog: .5 });
  assert.equal(result.rows.find(row => row.name === 'Jose Agent').sales, 1);
  assert.equal(result.rows.find(row => row.name === 'Joseph Agent').sales, 1);
  assert.equal(result.rows.find(row => row.name === 'Joe Agent').annualPremium, -.22);
  const missing = result.rows.filter(row => row.attributed === false);
  assert.equal(missing.length, 2);
  assert.notEqual(missing[0].name, missing[1].name);
  assert.equal(missing.find(row => /PolicyTek/.test(row.name)).sales, 1);
  assert.equal(missing.find(row => /HubSpot/.test(row.name)).sales, 1);
});

test('a listed spelling pair puts one agent in one row across PolicyTek and HubSpot', async () => {
  const { AGENT_NAME_ALIASES } = await import('../lib/agent-names.mjs');
  const [alias, canonical] = [...AGENT_NAME_ALIASES].at(-1);
  const result = await read(selection, shopper({ rows: [{ name: canonical, leads: 10, submitted: 2, premium: 100 }] }),
    standardPreferred({ rows: [{ name: alias, attributed: true, sales: 1, annualPremium: 50, inboundCalls: 5 }] }));
  assert.deepEqual(result.rows, [{ name: canonical, attributed: true, sales: 3, annualPremium: 150, inboundCalls: 15, soldPerInboundLog: .2 }]);
});

test('All counts each imported SP agent call total once across spelling variants', async () => {
  const deals = ['Synthetic Agent', 'SYNTHETIC  AGENT'].map(name => ({ properties: {
    writing_agent_name: name, annual_premium_amount: '10.25', deal_currency_code: 'USD',
    pipeline: 'default', dealstage: 'closedwon', hs_is_closed_won: 'true', closedate: String(NOW),
  } }));
  const aggregate = aggregateLeaderboardDeals(deals, { startMs: NOW - 1, endMs: NOW + 1 });
  const first = shopper({ rows: [], reportTotals: { submitted: 0, premium: 0, leads: 0 } });
  for (const report of [undefined, { sold: 2, soldByAgent: new Map([['synthetic agent', 2]]), connected: 25, abandoned: 5,
    connectedByAgent: new Map([['synthetic agent', 25]]), abandonedByAgent: new Map([['synthetic agent', 5]]) }]) {
    const second = applySvpCalls(standardPreferred({ rows: aggregate.rows }), { status: 'available', total: 20,
      partial: false, byAgent: new Map([['synthetic agent', 20]]), ...(report ? { report } : {}) });
    const result = await read(selection, first, second);
    assert.equal(result.status, 'available');
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], { name: 'Synthetic Agent', attributed: true, sales: 2, annualPremium: 20.5, inboundCalls: 20, soldPerInboundLog: .1 });
    assert.equal(result.combinedTotals.calls, 20);
  }
  const fallback = standardPreferred({ rows: aggregate.rows.map((row, index) => ({ ...row, inboundCalls: index ? 12 : 5 })),
    calls: { status: 'available', total: 17, partial: false } });
  const fallbackResult = await read(selection, first, fallback);
  assert.equal(fallbackResult.rows[0].inboundCalls, 17, 'distinct owner-log counts remain additive');
  const conflicting = standardPreferred({ ...fallback, calls: { ...fallback.calls, basis: 'ringcx' } });
  assert.equal((await read(selection, first, conflicting)).status, 'unavailable', 'one report agent cannot supply inconsistent repeated call totals');
});

test('missing premiums and call attribution remain null, with negative premiums summed in cents', async () => {
  const first = shopper({ rows: [{ name: 'Synthetic Agent', leads: 0, submitted: 2, premium: -.29 }], reportTotals: { submitted: 2, premium: -.29, leads: 0 } });
  let result = await read(selection, first, standardPreferred({ rows: [{ name: 'Synthetic Agent', attributed: true, sales: 1, annualPremium: -.01, inboundCalls: 0 }], calls: { status: 'available', total: 0, partial: false } }));
  assert.equal(result.rows[0].annualPremium, -.3); assert.equal(result.rows[0].soldPerInboundLog, null);
  assert.deepEqual(result.combinedTotals, { sales: 3, annualPremium: -.3, calls: 0, closeRate: null });
  result = await read(selection, shopper({ rows: [{ name: 'Synthetic Agent', submitted: 1, premium: null, leads: 3 }], reportTotals: { submitted: 1, premium: null, leads: 3 } }), standardPreferred({ rows: [{ name: 'Synthetic Agent', attributed: true, sales: 1, annualPremium: 4, inboundCalls: null }] }));
  assert.equal(result.rows[0].annualPremium, null); assert.equal(result.rows[0].inboundCalls, null); assert.equal(result.rows[0].soldPerInboundLog, null);
  assert.equal(result.combinedTotals.annualPremium, null);
});

test('partial and stale sources remain explicit, and incomplete call data is not a complete combined count', async () => {
  const result = await read(selection, shopper({ partial: true, stale: true }), standardPreferred({ calls: { status: 'available', total: 30, partial: true } }));
  assert.equal(result.partial, true); assert.equal(result.stale, true); assert.equal(result.calls.partial, true);
  assert.equal(result.combinedTotals.calls, 45);
  assert.match(result.notice, /incomplete|partial/i);
  const missingCalls = await read(selection, shopper(), standardPreferred({ rows: [{ name: 'Synthetic Agent', attributed: true, sales: 4, annualPremium: .2, inboundCalls: null }], calls: { status: 'unavailable', total: null, partial: false } }));
  assert.equal(missingCalls.status, 'available'); assert.equal(missingCalls.partial, true);
  assert.equal(missingCalls.calls.status, 'unavailable'); assert.equal(missingCalls.combinedTotals.calls, null); assert.equal(missingCalls.combinedTotals.closeRate, null);
  assert.match(missingCalls.notice, /call.*unavailable/i);
});

test('a failed or missing source never produces a successful one-board All result', async () => {
  for (const [first, second, missing] of [
    [shopper({ status: 'unavailable', rows: [], error: { code: 'POLICYTEK_PENDING', message: 'Waiting.' } }), standardPreferred(), /PolicyTek/],
    [shopper(), standardPreferred({ status: 'connection-required', rows: [], retryAfterSeconds: 17 }), /HubSpot/],
  ]) {
    const result = await read(selection, first, second);
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.rows, []); assert.equal(result.partial, true);
    assert.deepEqual(result.combinedTotals, { sales: null, annualPremium: null, calls: null, closeRate: null });
    assert.match(result.error.message, missing); assert.match(result.notice, missing);
    if (second.retryAfterSeconds) assert.equal(result.retryAfterSeconds, 17);
  }
  const thrown = await read(selection, shopper(), standardPreferred(), { readShopper: async () => { throw Error('secret provider payload'); } });
  assert.equal(thrown.status, 'unavailable'); assert.deepEqual(thrown.rows, []); assert.match(thrown.error.message, /PolicyTek/);
  assert.doesNotMatch(JSON.stringify(thrown), /secret provider payload/);
});

test('both reads start concurrently with the same captured Eastern date, including Custom', { timeout: 2000 }, async () => {
  const { readAllLeaderboard } = await import('../lib/leaderboard-all.mjs');
  for (const [period, startDate, endDate] of [['day', '2026-11-01', '2026-11-01'], ['week', '2026-10-26', '2026-11-01'], ['month', '2026-11-01', '2026-11-01'], ['custom', '2026-03-08', '2026-03-09']]) {
    const input = { board: 'all', period, ...(period === 'custom' ? { from: startDate, to: endDate } : {}) };
    let clockReads = 0, started = 0, release;
    const wait = new Promise(resolve => { release = resolve; });
    const readSource = source => async (sourceInput, { now }) => {
      assert.equal(now, NOW); assert.deepEqual(sourceInput, { ...input, board: source });
      started++; if (started === 2) release();
      await wait;
      return source === 'shopper' ? shopper({ period, startDate, endDate }) : standardPreferred({ period, startDate, endDate });
    };
    const result = await readAllLeaderboard(input, { now: () => { clockReads++; return NOW + (clockReads - 1) * 2; }, readShopper: readSource('shopper'), readStandardPreferred: readSource('sp') });
    assert.equal(clockReads, 1); assert.equal(result.period, period); assert.equal(result.startDate, startDate); assert.equal(result.endDate, endDate);
    assert.equal(result.status, 'available');
  }
});

test('source date-range or board mismatch fails closed, even if both return the same wrong range', async () => {
  for (const [first, second, label] of [
    [shopper({ startDate: '2026-10-31' }), standardPreferred(), /PolicyTek/],
    [shopper(), standardPreferred({ endDate: '2026-11-02' }), /HubSpot/],
    [shopper({ startDate: '2026-10-31', endDate: '2026-10-31' }), standardPreferred({ startDate: '2026-10-31', endDate: '2026-10-31' }), /PolicyTek.*HubSpot/],
    [shopper({ board: 'source' }), standardPreferred(), /PolicyTek/],
  ]) {
    const result = await read(selection, first, second);
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.rows, []); assert.match(result.error.message, label);
  }
});

test('canonical output excludes source private fields and bounds source notices', async () => {
  const first = shopper({ rows: [{ name: 'Synthetic Agent', leads: 10, submitted: 2, premium: .1, email: 'secret@example.invalid' }], notice: 'x'.repeat(10000), internal: { token: 'secret-token' } });
  const result = await read(selection, first);
  assert.ok(result.notice.length < 4000);
  assert.doesNotMatch(JSON.stringify(result), /secret|email|internal|token/);
  const malformed = await read(selection, shopper({ rows: [{ name: 'Synthetic Agent', submitted: -1, premium: .1, leads: 2 }] }));
  assert.equal(malformed.status, 'unavailable'); assert.deepEqual(malformed.rows, []);
});

test('API All dispatch shares the initial clock, keeps the provider budget advancing and applies effective SP calls', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const shims = {
    '@/app/app-auth': 'export const getAppUser = async () => ({ email: "synthetic@example.invalid" });',
    '@/lib/hubspot-write.mjs': 'export const editorAllowed = () => true;',
    '@/lib/leaderboard-host.mjs': 'export const leaderboardReadOrigin = () => "https://app.example";',
    '@/lib/leaderboard.mjs': `export { handleLeaderboardRequest } from ${JSON.stringify(`${root}lib/leaderboard.mjs`)}; export const readLeaderboard = (...args) => globalThis.routeFixture.readLeaderboard(...args);`,
    '@/lib/policytek.mjs': 'export const readPolicytekLeaderboard = (...args) => globalThis.routeFixture.readPolicytek(...args);',
    '@/db/policytek.mjs': 'export const getPolicytekDb = async () => ({});',
    '@/lib/svp-calls.mjs': 'export const readSvpCalls = (...args) => globalThis.routeFixture.readSvpCalls(...args); export const applySvpCalls = (...args) => globalThis.routeFixture.applySvpCalls(...args);',
    '@/db/svp-calls.mjs': 'export const getSvpCallsDb = async () => ({});',
    '@/lib/whatsapp-sales.mjs': 'export const readWhatsappLeaderboard = () => { throw Error("Wrong board"); }; export const readPendingWhatsappStandardPreferred = readWhatsappLeaderboard;',
    '@/db/whatsapp.mjs': 'export const getWhatsappDb = async () => { throw Error("Wrong database"); };',
  };
  const bundle = await build({ entryPoints: [`${root}app/api/leaderboard/route.ts`], bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'synthetic-route-sources', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => shims[args.path] ? { path: args.path, namespace: 'route-source' } : { path: `${root}${args.path.slice(2)}` });
      builder.onLoad({ filter: /.*/, namespace: 'route-source' }, args => ({ contents: shims[args.path], loader: 'js', resolveDir: root }));
    } }] });
  let clockReads = 0, providerClock, sourceClock, callClock, applied = 0;
  class ClockDate extends Date { static now() { return NOW + clockReads++ * 2; } }
  const routeFixture = {
    readPolicytek: async (input, options) => { assert.equal(input.board, 'shopper'); sourceClock = options.now; return shopper(); },
    readLeaderboard: async (input, options) => {
      assert.equal(input.board, 'sp'); providerClock = options.now();
      assert.ok(options.now() > providerClock, 'provider budget clock must advance after its captured initial read');
      return standardPreferred({ calls: { status: 'unavailable', total: null }, rows: [{ name: 'Synthetic Agent', attributed: true, sales: 4, annualPremium: .2, inboundCalls: null }] });
    },
    readSvpCalls: async (_db, range, now) => { assert.equal(range.startDate, '2026-11-01'); callClock = now; return { status: 'available', total: 30, partial: false }; },
    applySvpCalls: (result, calls) => { applied++; return { ...result, calls, rows: result.rows.map(row => ({ ...row, inboundCalls: 20 })) }; },
  };
  const routeModule = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, { module: routeModule, exports: routeModule.exports, require: createRequire(import.meta.url), process: { env: {} }, routeFixture, Date: ClockDate, Request, Response, URL, TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout });
  const response = await routeModule.exports.POST(new Request('https://app.example/api/leaderboard', { method: 'POST', headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' }, body: JSON.stringify(selection) }));
  const result = await response.json();
  assert.equal(result.status, 'available'); assert.equal(applied, 1);
  assert.equal(sourceClock, NOW); assert.equal(providerClock, NOW); assert.equal(callClock, NOW);
  assert.deepEqual(result.combinedTotals, { sales: 7, annualPremium: .4, calls: 45, closeRate: 7 / 45 });
  assert.equal(result.rows[0].inboundCalls, 30);
});
