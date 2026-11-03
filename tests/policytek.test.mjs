import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { parsePolicytekCapture, policytekReportUrl, savePolicytekSnapshot, readPolicytekLeaderboard, policytekSyncPlan } from '../lib/policytek.mjs';
import { handlePolicytekSync } from '../lib/policytek-sync-handler.mjs';
import { rankLeaderboardRows } from '../app/leaderboard-data.mjs';
import { policytekRefreshActive, policytekSnapshotStale, policytekNextRefreshDelay } from '../lib/policytek-schedule.mjs';

const now = Date.parse('2026-11-03T15:00:00Z'), secret = 'a'.repeat(64);
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
    assert.equal(jobs.length, 8); assert.ok(jobs.some(job => job.startDate === '2026-10-01'));
    const response = await handlePolicytekSync(request(capture('source')), { secret, getDb: async () => db, now });
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal((await response.json()).saved, true);
  } finally { await db.close(); }
});

test('refresh hours follow Eastern local time across winter, summer and both DST changes', () => {
  for (const [day, offset] of [['2026-11-03', '-05:00'], ['2026-07-15', '-04:00'], ['2026-03-08', '-04:00'], ['2026-11-01', '-05:00']]) {
    for (const [time, active] of [['08:59:59', false], ['09:00:00', true], ['20:59:59', true], ['21:00:00', false], ['23:59:59', false]]) {
      assert.equal(policytekRefreshActive(Date.parse(`${day}T${time}${offset}`)), active, `${day} ${time}`);
    }
  }
  assert.equal(policytekNextRefreshDelay(Date.parse('2026-11-03T14:01:15Z')), 225000);
  assert.equal(policytekNextRefreshDelay(Date.parse('2026-11-03T14:05:00Z')), 300000);
  const oldCapture = '2026-11-02T20:55:00-05:00';
  assert.equal(policytekSnapshotStale(oldCapture, Date.parse('2026-11-03T08:30:00-05:00')), false);
  assert.equal(policytekSnapshotStale(oldCapture, Date.parse('2026-11-03T09:14:59-05:00')), false);
  assert.equal(policytekSnapshotStale(oldCapture, Date.parse('2026-11-03T09:15:01-05:00')), true);
});

test('off-hours plans and publications cannot reach the database', async () => {
  const closed = Date.parse('2026-11-03T21:00:00-05:00');
  let calls = 0;
  const getDb = () => { calls++; throw Error('Database must not be reached'); };
  const planRequest = new Request('https://example.com/api/policytek-sync', { headers: { Authorization: `Bearer ${secret}` } });
  const plan = await handlePolicytekSync(planRequest, { secret, getDb, now: closed });
  assert.equal(plan.status, 200);
  assert.deepEqual((await plan.json()).jobs, []);
  const publish = await handlePolicytekSync(request(capture()), { secret, getDb, now: closed });
  assert.equal(publish.status, 409);
  assert.equal((await publish.json()).code, 'POLICYTEK_OUTSIDE_REFRESH_WINDOW');
  assert.deepEqual(await policytekSyncPlan({ query: getDb }, closed), []);
  assert.equal(calls, 0);
});

test('the latest Custom range queues both boards ahead of old failures and repeats next tick', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema);
    for (let day = 1; day <= 25; day++) {
      const key = `2026-09-${String(day).padStart(2, '0')}`;
      await readPolicytekLeaderboard({ board: 'shopper', period: 'custom', from: key, to: key }, { db, now: now - 3600000 });
    }
    await readPolicytekLeaderboard({ board: 'source', period: 'custom', from: '2026-10-01', to: '2026-10-31' }, { db, now });
    // Rapidly switching away and back must renew both members of the pair.
    await readPolicytekLeaderboard({ board: 'shopper', period: 'custom', from: '2026-10-15', to: '2026-10-16' }, { db, now: now + 1000 });
    await readPolicytekLeaderboard({ board: 'source', period: 'custom', from: '2026-10-01', to: '2026-10-31' }, { db, now: now + 2000 });
    const plan = await policytekSyncPlan(db, now + 2000);
    assert.equal(plan.length, 8);
    assert.deepEqual(plan.slice(0, 2).map(j => [j.board, j.startDate, j.endDate]), [['shopper', '2026-10-01', '2026-10-31'], ['source', '2026-10-01', '2026-10-31']]);
    // A capture completing three minutes into a run must still be refreshed on
    // the next five-minute tick, rather than being skipped for another cycle.
    for (const job of plan.slice(0, 2)) {
      await savePolicytekSnapshot(db, { ...job, capturedAt: new Date(now + 180000).toISOString(), rows: [], reportTotals: { leads: 0, quoted: 0, submitted: 0, premium: 0, spend: 0 }, partial: false });
    }
    const nextPlan = await policytekSyncPlan(db, now + 300000);
    assert.deepEqual(nextPlan.slice(0, 2), plan.slice(0, 2));
    assert.equal(new Set(nextPlan.map(j => `${j.board}:${j.startDate}:${j.endDate}`)).size, nextPlan.length);
  } finally { await db.close(); }
});

test('Custom reads isolate both board and dates, retain timestamps overnight and queue missing ranges', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema);
    for (const [board, startDate, endDate, submitted] of [['shopper', '2026-10-01', '2026-10-31', 12], ['source', '2026-10-01', '2026-10-31', 34], ['shopper', '2026-10-02', '2026-10-31', 56]]) {
      await savePolicytekSnapshot(db, { board, startDate, endDate, capturedAt: new Date(now).toISOString(), rows: [{ name: 'Synthetic', submitted }], reportTotals: { leads: 100, quoted: 0, submitted, premium: 0, spend: 0 }, partial: false });
    }
    const closed = Date.parse('2026-11-03T21:30:00-05:00');
    for (const [board, from, expected] of [['shopper', '2026-10-01', 12], ['source', '2026-10-01', 34], ['shopper', '2026-10-02', 56]]) {
      const result = await readPolicytekLeaderboard({ board, period: 'custom', from, to: '2026-10-31' }, { db, now: closed });
      assert.equal(result.reportTotals.submitted, expected);
      assert.equal(result.startDate, from); assert.equal(result.endDate, '2026-10-31');
      assert.equal(result.fetchedAt, new Date(now).toISOString());
      assert.equal(result.refreshActive, false); assert.equal(result.stale, false);
      assert.match(result.notice, /paused until 9 AM Eastern/);
    }
    const missing = await readPolicytekLeaderboard({ board: 'source', period: 'custom', from: '2026-10-02', to: '2026-10-31' }, { db, now: closed });
    assert.equal(missing.status, 'unavailable'); assert.equal(missing.reportTotals, undefined);
    assert.match(missing.error.message, /paused until 9 AM Eastern/);
    assert.deepEqual(await policytekSyncPlan(db, closed), []);
  } finally { await db.close(); }
});
