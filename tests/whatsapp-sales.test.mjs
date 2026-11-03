import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { importWhatsappReports, parseWhatsappReport, readWhatsappLeaderboard, WhatsappImportError } from '../lib/whatsapp-sales.mjs';
import { validateLeaderboardInput } from '../lib/leaderboard.mjs';
import { leaderboardMetrics, leaderboardTotals, rankLeaderboardRows } from '../app/leaderboard-data.mjs';

const schema = await readFile(new URL('../migrations/0006_whatsapp_sales.sql', import.meta.url), 'utf8');
const SHA = 'a'.repeat(64);
const day = value => new Date(`${value}T00:00:00.000Z`);
const top = ['Legacy Agency Partners'], sub = ['synthetic'], blank = [];
const salesSheet = rows => [top, sub, blank, ['Date', 'Agent Name', 'Total Production', 'Number of Sales'], ...rows];
const queueSheet = rows => [top, sub, blank, ['Date', 'Dialer Agent Name', 'Production Agent Name', 'Sold', 'Calls', 'Connected (Answered)'], ...rows];
const file = month => `LAP Daily Agent Report - ${month} Synthetic.xlsx`;
const NOW = Date.parse('2026-07-20T16:00:00Z');

async function database(reports) {
  const db = new PGlite();
  await db.exec(schema); await db.exec(schema);
  if (reports) await importWhatsappReports(db, reports, NOW);
  return db;
}

test('parsing groups case-variant names per day, keeps cents exact and validates headers, months and counts without echoing names', () => {
  const report = parseWhatsappReport({ fileName: file('2026-07'), sha256: SHA,
    agentDetail: salesSheet([[day('2026-07-01'), 'Agent One', 100.1, 1], [day('2026-07-01'), ' agent one ', 0.2, 2], [day('2026-07-02'), 'Agent Two', -50, 0], [null, null, null, null]]),
    queueCallData: queueSheet([[day('2026-07-01'), 'Seat 1', 'Agent One', 1, 9, 4], [day('2026-07-01'), 'Seat 9', null, 0, 3, 2]]) });
  assert.equal(report.month, '2026-07'); assert.equal(report.lastActivityDate, '2026-07-02');
  assert.deepEqual(report.sales.map(({ date, key, sales, cents }) => [date, key, sales, cents]), [['2026-07-01', 'agent one', 3, 10030], ['2026-07-02', 'agent two', 0, -5000]]);
  assert.deepEqual(report.queue.map(({ dialerKey, key, connected }) => [dialerKey, key, connected]), [['seat 1', 'agent one', 4], ['seat 9', null, 2]]);
  const bad = [
    { agentDetail: salesSheet([[day('2026-08-01'), 'Private Person', 1, 1]]) },
    { agentDetail: salesSheet([[day('2026-07-01'), 'Private Person', 1, 1.5]]) },
    { agentDetail: salesSheet([[day('2026-07-01'), 'Private Person', '1', 1]]) },
    { agentDetail: [top, sub, blank, ['Date', 'Agent', 'Total Production', 'Number of Sales']] },
    { agentDetail: salesSheet([]), queueCallData: queueSheet([[day('2026-06-16'), 'Private Seat', null, 0, 1, 1]]), fileName: file('2026-06') },
  ];
  for (const input of bad) assert.throws(() => parseWhatsappReport({ fileName: file('2026-07'), sha256: SHA, ...input }), error => error instanceof WhatsappImportError && !/Private/.test(error.message));
  assert.throws(() => parseWhatsappReport({ fileName: 'report.xlsx', sha256: SHA, agentDetail: salesSheet([]) }), WhatsappImportError);
});

const june = parseWhatsappReport({ fileName: file('2026-06'), sha256: SHA, agentDetail: salesSheet([[day('2026-06-10'), 'Agent One', 500, 2], [day('2026-06-18'), 'Agent Two', 300, 1]]),
  queueCallData: queueSheet([[day('2026-06-18'), 'Seat 2', 'Agent Two', 1, 5, 4]]) });
const july = parseWhatsappReport({ fileName: file('2026-07'), sha256: SHA, agentDetail: salesSheet([[day('2026-07-01'), 'Agent One', 1000, 3], [day('2026-07-01'), 'Agent Two', 250.5, 1], [day('2026-07-03'), 'Agent One', 99.99, 1]]),
  queueCallData: queueSheet([[day('2026-07-01'), 'Seat 1', 'Agent One', 2, 10, 8], [day('2026-07-01'), 'Seat 3', 'Agent Three', 0, 6, 5], [day('2026-07-02'), 'Seat 9', null, 1, 4, 2]]) });

test('a covered range ranks agents by sales and production, with queue calls and unmapped seats only in totals', async () => {
  const db = await database([june, july]);
  try {
    const result = await readWhatsappLeaderboard({ board: 'whatsapp', period: 'custom', from: '2026-07-01', to: '2026-07-03' }, { db, now: NOW });
    assert.equal(result.status, 'available'); assert.equal(result.partial, false); assert.equal(result.dataThrough, '2026-07-03');
    const byName = Object.fromEntries(result.rows.map(row => [row.name, row]));
    assert.deepEqual([byName['Agent One'].sales, byName['Agent One'].production, byName['Agent One'].queueConnected, byName['Agent One'].closeRate], [4, 1099.99, 8, .25]);
    assert.deepEqual([byName['Agent Three'].sales, byName['Agent Three'].queueConnected], [0, 5]);
    assert.deepEqual(result.calls, { status: 'available', coverageStart: '2026-06-17', connected: 15, sold: 3, closeRate: .2, unmappedConnected: 2, unmappedSold: 1 });
    assert.match(result.notice, /not mapped to an agent/);
    const ranked = rankLeaderboardRows(result.rows, 'whatsapp', 'ap');
    assert.deepEqual(ranked.map(row => row.name), ['Agent One', 'Agent Two']);
    assert.deepEqual(leaderboardTotals(result.rows, 'whatsapp', 'ap'), { ...leaderboardTotals(result.rows, 'whatsapp', 'ap'), first: 5, second: 1350.49 });
    assert.deepEqual(leaderboardMetrics('whatsapp'), { first: 'sales', second: 'production', firstLabel: 'Sales', secondLabel: 'Total production' });
  } finally { await db.close(); }
});

test('ranges before dialer coverage, straddling it, missing months or past imported activity are flagged honestly', async () => {
  const db = await database([june, july]);
  try {
    const before = await readWhatsappLeaderboard({ board: 'whatsapp', period: 'custom', from: '2026-06-01', to: '2026-06-16' }, { db, now: NOW });
    assert.equal(before.calls.status, 'not-covered'); assert.equal(before.rows[0].queueConnected, null); assert.match(before.notice, /not available for this range/);
    const straddle = await readWhatsappLeaderboard({ board: 'whatsapp', period: 'custom', from: '2026-06-01', to: '2026-06-30' }, { db, now: NOW });
    assert.equal(straddle.calls.status, 'partial'); assert.equal(straddle.partial, false);
    const missing = await readWhatsappLeaderboard({ board: 'whatsapp', period: 'custom', from: '2026-05-01', to: '2026-06-30' }, { db, now: NOW });
    assert.equal(missing.partial, true); assert.match(missing.notice, /One month in this range has not been imported/);
    const month = await readWhatsappLeaderboard({ board: 'whatsapp', period: 'month' }, { db, now: NOW });
    assert.equal(month.partial, true); assert.match(month.notice, /runs through Jul 3, 2026/);
  } finally { await db.close(); }
});

test('re-importing a month replaces only that month; a failed import rolls back completely', async () => {
  const db = await database([june, july]);
  try {
    const smaller = parseWhatsappReport({ fileName: file('2026-07'), sha256: 'b'.repeat(64), agentDetail: salesSheet([[day('2026-07-02'), 'Agent Two', 10, 1]]) });
    await importWhatsappReports(db, [smaller], NOW);
    const counts = async () => (await db.query("SELECT to_char(date_trunc('month', sale_date), 'YYYY-MM') AS month, count(*)::int AS n FROM whatsapp_sales_daily GROUP BY 1 ORDER BY 1")).rows;
    assert.deepEqual(await counts(), [{ month: '2026-06', n: 2 }, { month: '2026-07', n: 1 }]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM whatsapp_queue_daily WHERE call_date >= '2026-07-01'")).rows[0].n, 0);
    const broken = { ...june, sales: [{ ...june.sales[0], sales: -1 }] };
    await assert.rejects(importWhatsappReports(db, [smaller, broken], NOW));
    assert.deepEqual(await counts(), [{ month: '2026-06', n: 2 }, { month: '2026-07', n: 1 }]);
    await assert.rejects(importWhatsappReports(db, [smaller, smaller], NOW), WhatsappImportError);
  } finally { await db.close(); }
});

test('the API accepts the whatsapp board and reports a clear unavailable state before any import', async () => {
  assert.deepEqual(validateLeaderboardInput({ board: 'whatsapp', period: 'day' }), { board: 'whatsapp', period: 'day' });
  const db = await database();
  try {
    const result = await readWhatsappLeaderboard({ board: 'whatsapp', period: 'week' }, { db, now: NOW });
    assert.equal(result.status, 'unavailable'); assert.equal(result.error.code, 'WHATSAPP_NOT_IMPORTED'); assert.deepEqual(result.rows, []);
    await assert.rejects(readWhatsappLeaderboard({ board: 'sp', period: 'day' }, { db, now: NOW }), TypeError);
  } finally { await db.close(); }
});
