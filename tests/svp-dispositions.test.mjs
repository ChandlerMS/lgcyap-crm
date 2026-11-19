import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sealSnapshot, openSnapshot, parseDuration, validateDispositionQuery, queryDispositions, dispositionCsv, handleDispositionRequest } from '../lib/svp-dispositions.mjs';

const rows = [
  ['2026-11-01', 'Ana', '+15550000001', 'FL', 'Sold', '=private note', 'https://example.test/record', 'N/A', 'Connected', '10:30:00 US/Eastern', '01m 02.5s', '60s', '65s', '5s', '0'],
  ['2026-11-02', 'N/A', '+15550000002', 'NJ', '[No-Agent-Disp]', '', '', 'N/A', 'Inbound Abandoned', '11:00:00 US/Eastern', '01.0s', '1s', '1s', '0', '0'],
  ['2026-11-02', 'Bo', '+15550000003', 'FL', 'Not Interested', '', '', 'N/A', 'Connected', '12:00:00 US/Eastern', '02m 00.0s', '120s', '130s', '10s', '0'],
];
const snapshot = { version: 1, source: 'Call History All Time.xlsx', importedAt: '2026-11-19T18:00:00Z', appliedFilters: ['Final IN (Yes)'], rows };
test('private snapshot requires the right key and rejects tampering', () => {
  const key = randomBytes(32).toString('base64');
  const sealed = sealSnapshot(snapshot, key);
  assert.ok(!sealed.includes(Buffer.from('private note')));
  assert.deepEqual(openSnapshot(sealed, key), snapshot);
  assert.throws(() => openSnapshot(sealed, randomBytes(32).toString('base64')));
  sealed[sealed.length - 1] ^= 1;
  assert.throws(() => openSnapshot(sealed, key));
});
test('duration units preserve fractions, including hours and bare zero', () => {
  assert.equal(parseDuration('01m 02.5s'), 62.5);
  assert.equal(parseDuration('1h 02m 03s'), 3723);
  assert.equal(parseDuration('0'), 0);
  assert.equal(parseDuration('bad'), null);
});
test('filters combine across dates, attributes, text, time and duration before totals and pagination', () => {
  const result = queryDispositions(snapshot, validateDispositionQuery({ from: '2026-11-01', to: '2026-11-02', state: 'FL', result: 'Connected', duration: { interaction: { min: 60, max: 90 } }, query: 'private', startTime: '10:30', page: 1 }));
  assert.equal(result.total, 1);
  assert.equal(result.rows[0][4], 'Sold');
  assert.deepEqual(result.dispositions, [{ name: 'Sold', count: 1 }]);
  assert.equal(result.facets.agent.length, 3);
  assert.equal(queryDispositions(snapshot, validateDispositionQuery({ from: '2026-11-02' })).total, 2);
  assert.equal(queryDispositions(snapshot, validateDispositionQuery({ disposition: 'Sold', agent: 'Bo' })).total, 0);
});
test('invalid input cannot cause unbounded pages, incorrect dates, reversed ranges or unsupported filters', () => {
  for (const input of [{ from: '2026-02-30' }, { page: -1 }, { page: 1.2 }, { sort: 'bad' }, { to: '2026-01-01', from: '2026-02-01' }, { duration: { interaction: { min: 10, max: 1 } } }, { state: [] }, { duration: { unknown: { min: 1 } } }]) assert.throws(() => validateDispositionQuery(input));
});
test('all columns survive CSV export and spreadsheet formulas are neutralized', () => {
  const csv = dispositionCsv(rows);
  assert.match(csv, /Disposition Notes/);
  assert.match(csv, /'\=private note/);
  assert.match(csv, /'\+15550000001/);
});
test('anonymous, unapproved and cross-origin requests cannot read the snapshot; failures never expose data', async () => {
  let reads = 0;
  const request = (origin = 'https://crm.test', body = '{}') => new Request('https://crm.test/api/svp-dispositions', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body });
  const deps = { getUser: async () => null, authorize: () => true, allowedOrigin: 'https://crm.test', readSnapshot: async () => { reads++; return snapshot; } };
  assert.equal((await handleDispositionRequest(request(), deps)).status, 401);
  assert.equal((await handleDispositionRequest(request(), { ...deps, getUser: async () => ({}), authorize: () => false })).status, 403);
  assert.equal((await handleDispositionRequest(request('https://evil.test'), { ...deps, getUser: async () => ({}) })).status, 403);
  assert.equal(reads, 0);
  const good = await handleDispositionRequest(request(), { ...deps, getUser: async () => ({}) });
  assert.equal(good.status, 200);
  assert.match(good.headers.get('cache-control'), /no-store/);
  assert.equal((await good.json()).total, 3);
  assert.equal((await handleDispositionRequest(request('https://crm.test', '{'), { ...deps, getUser: async () => ({}) })).status, 400);
});

test('empty duration bounds retain blank durations; pagination never changes filtered totals', () => {
  const many = { ...snapshot, rows: Array.from({ length: 120 }, (_, index) => [...rows[index % rows.length]]) };
  many.rows[0][14] = '';
  const first = queryDispositions(many, validateDispositionQuery({ duration: { hold: {} } }));
  const last = queryDispositions(many, validateDispositionQuery({ page: 99 }));
  assert.equal(first.total, 120);
  assert.equal(first.rows.length, 50);
  assert.equal(last.total, 120);
  assert.equal(last.page, 3);
  assert.equal(last.rows.length, 20);
  assert.equal(last.dispositions.reduce((sum, item) => sum + item.count, 0), 120);
});

test('filtered CSV streams all matches while snapshot failures return a private generic error', async () => {
  const request = body => new Request('https://crm.test/api/svp-dispositions', { method: 'POST', headers: { origin: 'https://crm.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const deps = { getUser: async () => ({}), authorize: () => true, allowedOrigin: 'https://crm.test', readSnapshot: async () => snapshot };
  const exported = await handleDispositionRequest(request({ disposition: 'Sold', export: true }), deps);
  const csv = await exported.text();
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /text\/csv/);
  assert.match(csv, /Ana/);
  assert.doesNotMatch(csv, /Inbound Abandoned/);
  assert.match(csv, /'\=private note/);
  const failed = await handleDispositionRequest(request({}), { ...deps, readSnapshot: async () => { throw new Error('secret caller private note'); } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /secret caller|private note/);
});
