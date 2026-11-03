import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { parsePolicytekCapture, policytekReportUrl, savePolicytekSnapshot, readPolicytekLeaderboard, policytekSyncPlan } from '../lib/policytek.mjs';
import { handlePolicytekSync } from '../lib/policytek-sync-handler.mjs';
import { rankLeaderboardRows } from '../app/leaderboard-data.mjs';

const now = Date.parse('2026-11-03T12:00:00Z'), secret = 'a'.repeat(64);
const schema = await readFile(new URL('../migrations/0005_policytek_snapshots.sql', import.meta.url), 'utf8');
const capture = (board = 'shopper') => ({ board, startDate: '2026-11-03', endDate: '2026-11-03', capturedAt: new Date(now).toISOString(), agency: 'Legacy Agency Ffl', url: policytekReportUrl(board, '2026-11-03', '2026-11-03'), filters: ['Edit Created Date 11/03/2026 – 11/03/2026', board === 'shopper' ? 'Edit Date Type Submit Date' : 'Edit Group By Seller Sources'], table: [[board === 'shopper' ? 'Agent' : 'Source', 'Total', 'Quoted', 'Submitted', 'Submitted Premium', 'Total Spend'], [board === 'shopper' ? 'Agency' : '', '10', '3', '2', '$1,200.10', '$100'], ['Synthetic Alpha', '10', '3', '2', '$1,200.10', '$100']] });
const request = (body, extra = {}) => new Request('https://example.com/api/policytek-sync', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });

test('captures validate exact report scope and strip unrelated fields', () => {
  const c = capture(); c.customer = 'must never persist';
  const parsed = parsePolicytekCapture(c, now);
  assert.equal(parsed.reportTotals.premium, 1200.1); assert.equal(parsed.partial, false);
  assert.doesNotMatch(JSON.stringify(parsed), /customer|must never|url|filters/);
  for (const bad of [{ agency: 'Other tenant' }, { capturedAt: 'invalid' }, { capturedAt: new Date(now - 1200001).toISOString() }, { filters: [...c.filters, 'Edit Agent someone'] }, { url: c.url + '&agent=123' }, { url: c.url.replace('policytek.com', 'evil.example') }]) assert.throws(() => parsePolicytekCapture({ ...c, ...bad }, now));
});
test('missing, malformed and incomplete tables never masquerade as a successful zero report', () => {
  for (const mutate of [c => c.table.pop() && c.table.pop(), c => c.table[2][3] = '-', c => c.table[2][3] = '-2', c => c.table.push(c.table[2]), c => c.table[0][3] = 'New Name']) { const c = capture(); mutate(c); assert.throws(() => parsePolicytekCapture(c, now)); }
  const c = capture('source'); c.table.pop(); c.table[1] = ['', '0', '0', '0', '$0', '$0'];
  assert.equal(parsePolicytekCapture(c, now).partial, false);
  c.table[1][3] = '1'; assert.throws(() => parsePolicytekCapture(c, now));
});
test('source summary and named rows remain separate when totals do not reconcile', () => {
  const c = capture('source'); c.table[1][3] = '3';
  const p = parsePolicytekCapture(c, now); assert.equal(p.partial, true); assert.equal(p.reportTotals.submitted, 3); assert.equal(p.rows[0].submitted, 2);
  assert.equal(rankLeaderboardRows([{ name: 'No submits', submitted: 0, premium: 20 }, { name: 'Submitted', submitted: 1, premium: 1 }], 'shopper', 'ap').length, 1);
});
test('report URLs use Eastern DST bounds, exact submit mode and seller grouping', () => {
  const url = new URL(policytekReportUrl('source', '2026-11-01', '2026-11-01'));
  assert.equal(url.searchParams.get('createdAt_start'), '2026-11-01T04:00:00.000Z');
  assert.equal(url.searchParams.get('createdAt_end'), '2026-11-02T04:59:59.999Z');
  assert.equal(url.searchParams.get('sourceGroupBy'), 'seller_source');
  assert.throws(() => policytekReportUrl('sp', '2026-11-01', '2026-11-01'));
});
test('publisher rejects auth, browser origin, bad JSON and oversized payload before database access', async () => {
  let dbCalls = 0; const getDb = () => { dbCalls++; throw Error('Should not access'); };
  assert.equal((await handlePolicytekSync(request(capture(), { Authorization: 'bad' }), { secret, getDb, now })).status, 401);
  assert.equal((await handlePolicytekSync(request(capture(), { Origin: 'https://example.com' }), { secret, getDb, now })).status, 403);
  assert.equal((await handlePolicytekSync(request({}), { secret, getDb, now })).status, 400);
  assert.equal((await handlePolicytekSync(request({ blob: 'x'.repeat(3 * 1024 * 1024) }), { secret, getDb, now })).status, 413);
  assert.equal(dbCalls, 0);
});
test('durable snapshots resist replay, retain good data, label staleness and queue unknown ranges', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema); await db.exec(schema);
    const c = capture(), parsed = parsePolicytekCapture(c, now);
    assert.equal(await savePolicytekSnapshot(db, parsed), true);
    assert.equal(await savePolicytekSnapshot(db, { ...parsed, rows: [], capturedAt: new Date(now - 1000).toISOString() }), false);
    let read = await readPolicytekLeaderboard({ board: 'shopper', period: 'day' }, { db, now });
    assert.equal(read.status, 'available'); assert.equal(read.rows.length, 1); assert.equal(read.stale, false);
    read = await readPolicytekLeaderboard({ board: 'shopper', period: 'day' }, { db, now: now + 900001 });
    assert.equal(read.stale, true); assert.equal(read.fetchedAt, parsed.capturedAt);
    read = await readPolicytekLeaderboard({ board: 'source', period: 'custom', from: '2026-10-01', to: '2026-10-02' }, { db, now });
    assert.equal(read.status, 'unavailable'); assert.equal(read.error.code, 'POLICYTEK_PENDING'); assert.equal(read.reportTotals, undefined);
    const jobs = await policytekSyncPlan(db, now);
    assert.equal(jobs.length, 7); assert.ok(jobs.some(job => job.startDate === '2026-10-01'));
    const response = await handlePolicytekSync(request(capture('source')), { secret, getDb: async () => db, now });
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal((await response.json()).saved, true);
  } finally { await db.close(); }
});
