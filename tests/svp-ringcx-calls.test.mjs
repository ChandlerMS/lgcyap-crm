import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { RingCxError } from '../lib/ringcx.mjs';
import { applySvpCalls, importSvpCallsReports, parseSvpCallsReport, readSvpCalls } from '../lib/svp-calls.mjs';
import { readSvpRingcxStatus, svpWindowCounts, svpWindowsDue, syncSvpRingcxCalls } from '../lib/svp-ringcx-calls.mjs';

const schemas = await Promise.all(['0007_svp_calls.sql', '0008_svp_ringcx_calls.sql'].map(file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')));
const at = value => Date.parse(value);
const FIVE_MINUTES = 300000;
const database = async () => { const db = new PGlite(); for (const schema of schemas) { await db.exec(schema); await db.exec(schema); } return db; };

const window = (date, slot, end) => ({ date, slot, start: slot * 120, end: end ?? (slot + 1) * 120 });
const settledDays = (dates, except = []) => {
  const windows = new Map();
  for (const date of dates) for (let slot = 0; slot < 12; slot++) if (!except.includes(`${date}|${slot}`)) windows.set(`${date}|${slot}`, { readThrough: (slot + 1) * 120, settled: true, readAt: 0 });
  return windows;
};

test('due windows put the newest unread data first, then the oldest gap, and never ask for data under five minutes old', () => {
  // 2:23 PM Eastern: 2:18 floors to 2:15, inside the 2–4 PM window.
  assert.deepEqual(svpWindowsDue(new Map(), at('2026-11-03T19:23:00Z')), [window('2026-11-03', 7, 855), window('2026-11-02', 0)]);
  // 12:05 AM: nothing of the new day is readable yet, so the last window of yesterday is newest.
  assert.deepEqual(svpWindowsDue(new Map(), at('2026-11-04T05:05:00Z'))[0], window('2026-11-03', 11));
});

test('settled windows are never read again; a finished window is rechecked only after 15 minutes', () => {
  const now = at('2026-11-03T19:23:00Z');
  const windows = settledDays(['2026-11-02', '2026-11-03'], ['2026-11-03|6', '2026-11-03|7', '2026-11-03|8', '2026-11-03|9', '2026-11-03|10', '2026-11-03|11']);
  windows.set('2026-11-03|6', { readThrough: 840, settled: false, readAt: now - 600000 });
  windows.set('2026-11-03|7', { readThrough: 855, settled: false, readAt: now - 60000 });
  assert.deepEqual(svpWindowsDue(windows, now), [], 'nothing new and the recheck is not due');
  windows.set('2026-11-03|6', { readThrough: 840, settled: false, readAt: now - 900000 });
  assert.deepEqual(svpWindowsDue(windows, now), [window('2026-11-03', 6)]);
  windows.set('2026-11-03|6', { readThrough: 825, settled: false, readAt: now - 60000 });
  assert.deepEqual(svpWindowsDue(windows, now), [window('2026-11-03', 6)], 'a partly read finished window is read at once');
});

test('window counts keep only the group queues and this window, fold names, and accept RingCX timestamp styles', () => {
  const queues = new Set(['100', '101']), target = window('2026-11-03', 5);
  const row = (agentName, queue, dateTimeFrom, answIxnCnt) => ({ agentName, queue, dateTimeFrom, answIxnCnt });
  const result = svpWindowCounts([
    row('Agent One', 100, '2026-11-03 10:00:00', 2),
    row(' agent  one ', 101, '2026-11-03T15:15:00.000Z', 3),
    row('AGENT ONE', 100, String(at('2026-11-03T15:30:00Z')), 1),
    row('Agent Two', 100, '2026-11-03T10:45:00-05:00', 4),
    row('Agent Two', 100, '2026-11-03 11:45:00', 0),
    row('Other Queue', 999, '2026-11-03 10:00:00', 50),
    row('Inclusive End', 100, '2026-11-03 12:00:00', 7),
    row('Before Window', 100, '2026-11-03 09:45:00', 7),
    row('', 100, '2026-11-03 10:00:00', 9),
  ], queues, target);
  assert.deepEqual(result.counts, { 'agent one': 6, 'agent two': 4 });
  assert.deepEqual([result.rows, result.inScope, result.calls], [9, 6, 10]);
  assert.throws(() => svpWindowCounts({ error: 'nope' }, queues, target), error => error.code === 'INVALID_AGENT_REPORT' && /error/.test(error.detail));
  assert.throws(() => svpWindowCounts([row('Private Person', 100, '2026-11-03 10:00:00', null)], queues, target), error => error.code === 'INVALID_AGENT_REPORT' && !/Private/.test(error.detail));
  assert.throws(() => svpWindowCounts([row('Private Person', 100, '11/03/2026 10:00', 1)], queues, target), error => error.detail === 'dateTimeFrom 99/99/9999 99:99');
});

const fakeRingCx = (handler = range => [
  { agentName: 'Agent One', queue: 100, dateTimeFrom: range.startDate, answIxnCnt: 2 },
  { agentName: 'Agent Two', queue: 100, dateTimeFrom: range.startDate, answIxnCnt: 1 },
  { agentName: 'Other Queue', queue: 999, dateTimeFrom: range.startDate, answIxnCnt: 50 },
]) => {
  const client = { ranges: [], svpQueueIds: async () => new Set(['100']), agentQueueReport: async range => { client.ranges.push(range); return handler(range); } };
  return client;
};
const SHA = 'a'.repeat(64);
const sheet = (date, rows) => ({ sheet: date, data: [[`Daily Connected Calls Report — ${date}`], ['Source: synthetic'], [], ['Date', 'Agent Full Name', 'Total Calls Connected'], ...rows.map(([name, calls]) => [date, name, calls]), ['Total', `${rows.length} Active Agents`, null]] });
const november = parseSvpCallsReport({ fileName: 'Agent_Daily_Calls_2026-11_November_2026.xlsx', sha256: SHA, sheets: [sheet('2026-11-02', [['Agent One', 24], ['Agent Two', 10]]), sheet('2026-11-03', [['Agent One', 3]])] });
const board = extra => ({ status: 'available', board: 'sp', salesComplete: true, source: 'HubSpot', rows: [{ name: 'Agent One', attributed: true, sales: 4 }], ...extra });
const syncUntilCaughtUp = async (db, client, from) => {
  let now = from, runs = 0;
  while (runs < 60) {
    const result = await syncSvpRingcxCalls(db, client, now);
    assert.equal(result.status, 'ok');
    runs++;
    if (!(await db.query("SELECT 1 FROM svp_ringcx_days WHERE call_date = '2026-11-03'")).rows.length) { now += FIVE_MINUTES; continue; }
    return { now, runs };
  }
  throw new Error('never caught up');
};

test('the sync catches up within its read budget, then the board uses RingCX from the first full day while earlier days keep the workbook', async () => {
  const db = await database();
  try {
    await importSvpCallsReports(db, [november], at('2026-11-03T17:00:00Z'));
    const client = fakeRingCx(), start = at('2026-11-03T19:23:00Z');
    const first = await syncSvpRingcxCalls(db, client, start);
    assert.deepEqual(first.reads.map(read => [read.date, read.slot, read.through, read.inScope, read.calls]), [['2026-11-03', 7, 855, 2, 3], ['2026-11-02', 0, 120, 2, 3]]);
    assert.deepEqual(client.ranges, [{ startDate: '2026-11-03 14:00:00', endDate: '2026-11-03 14:15:00' }, { startDate: '2026-11-02 00:00:00', endDate: '2026-11-02 02:00:00' }]);

    const before = await readSvpCalls(db, { startDate: '2026-11-03', endDate: '2026-11-03' }, start);
    assert.deepEqual([before.total, before.ringcx], [3, null], 'an unfinished day keeps its workbook numbers');
    assert.equal(applySvpCalls(board(), before).calls.basis, 'spreadsheet');

    assert.equal((await syncSvpRingcxCalls(db, client, start + 60000)).status, 'skipped', 'a duplicated cron run spends nothing');
    assert.equal(client.ranges.length, 2);

    const { now, runs } = await syncUntilCaughtUp(db, client, start + FIVE_MINUTES);
    assert.ok(client.ranges.length <= (runs + 1) * 2, 'never more than two reads a run');

    const today = await readSvpCalls(db, { startDate: '2026-11-03', endDate: '2026-11-03' }, now);
    assert.deepEqual(Object.fromEntries(today.byAgent), { 'agent one': 16, 'agent two': 8 }, 'eight windows; the other queue is excluded');
    const shown = applySvpCalls(board(), today);
    assert.deepEqual([shown.source, shown.calls.basis, shown.calls.total, shown.rows[0].inboundCalls, shown.rows[0].soldPerInboundLog], ['HubSpot · RingCX', 'ringcx', 24, 16, .25]);
    assert.match(shown.callNotice, /from RingCX, checked every five minutes/); assert.match(shown.callNotice, /Last read \d/);
    assert.match(applySvpCalls(board(), await readSvpCalls(db, { startDate: '2026-11-03', endDate: '2026-11-03' }, now + 1500000)).callNotice, /has not updated since/);

    const both = await readSvpCalls(db, { startDate: '2026-11-02', endDate: '2026-11-03' }, now);
    assert.deepEqual(Object.fromEntries(both.byAgent), { 'agent one': 40, 'agent two': 18 }, 'the 2nd is read only to compare, so the workbook still shows');
    const mixed = applySvpCalls(board(), both);
    assert.equal(mixed.calls.basis, 'mixed'); assert.match(mixed.callNotice, /Days before 2026-11-03 use the Agent Daily Calls reports/);
    assert.equal((await readSvpCalls(db, { startDate: '2026-11-02', endDate: '2026-11-02' }, now)).ringcx, null);

    const past = await readSvpCalls(db, { startDate: '2026-11-03', endDate: '2026-11-03' }, at('2026-11-05T15:00:00Z'));
    assert.doesNotMatch(applySvpCalls(board(), past).callNotice, /Last read|not updated/, 'a finished day has no freshness note');

    const reimport = parseSvpCallsReport({ fileName: 'Agent_Daily_Calls_2026-11_November_2026.xlsx', sha256: 'b'.repeat(64), sheets: [sheet('2026-11-03', [['Agent One', 1]])] });
    await importSvpCallsReports(db, [reimport]);
    assert.equal((await readSvpCalls(db, { startDate: '2026-11-03', endDate: '2026-11-03' }, now)).total, 24, 'a workbook import cannot erase synced days');

    const later = await readSvpCalls(db, { startDate: '2026-11-03', endDate: '2026-11-04' }, now);
    assert.equal(later.partial, true); assert.match(applySvpCalls(board(), later).callNotice, /has no call data/);
    assert.equal((await readSvpCalls(db, { startDate: '2026-11-20', endDate: '2026-11-20' }, now)).status, 'not-covered');
  } finally { await db.close(); }
});

test('a new day joins the board as soon as it begins, at zero, rather than falling back to HubSpot logs', async () => {
  const db = await database();
  try {
    await db.query(`INSERT INTO svp_ringcx_windows (call_date, slot, counts, read_through, settled, read_at)
      SELECT d::date, s, '{"agent one": 1}'::jsonb, (s + 1) * 120, true, now() FROM generate_series('2026-11-02'::date, '2026-11-03'::date, interval '1 day') d, generate_series(0, 11) s`);
    const now = at('2026-11-04T05:05:00Z');
    assert.equal((await syncSvpRingcxCalls(db, fakeRingCx(), now)).status, 'ok');
    const calls = await readSvpCalls(db, { startDate: '2026-11-04', endDate: '2026-11-04' }, now);
    assert.deepEqual([calls.status, calls.total, calls.ringcx.from], ['available', 0, '2026-11-04']);
  } finally { await db.close(); }
});

test('failures keep earlier counts, record why for the status view, and clear after the next success', async () => {
  const db = await database();
  try {
    const start = at('2026-11-03T19:23:00Z'), good = fakeRingCx();
    await syncSvpRingcxCalls(db, good, start);

    const denied = await syncSvpRingcxCalls(db, fakeRingCx(() => { throw new RingCxError('RINGCX_ACCESS_DENIED', 503, 'HTTP 403 WEM Access required'); }), start + FIVE_MINUTES);
    assert.deepEqual([denied.status, denied.code, denied.detail], ['failed', 'RINGCX_ACCESS_DENIED', 'HTTP 403 WEM Access required']);
    let status = await readSvpRingcxStatus(db);
    assert.equal(status.errorCode, 'RINGCX_ACCESS_DENIED'); assert.equal(status.errorDetail, 'HTTP 403 WEM Access required');
    assert.equal(new Date(status.succeededAt).getTime(), start);
    assert.equal((await db.query("SELECT counts->>'agent one' AS calls FROM svp_ringcx_windows WHERE call_date = '2026-11-03' AND slot = 7")).rows[0].calls, '2');

    const empty = await syncSvpRingcxCalls(db, fakeRingCx(() => []), start + 2 * FIVE_MINUTES);
    assert.deepEqual([empty.status, empty.code], ['failed', 'EMPTY_AGENT_REPORT'], 'an empty report must not wipe counts already read');
    assert.equal((await db.query("SELECT counts->>'agent one' AS calls, read_through FROM svp_ringcx_windows WHERE call_date = '2026-11-03' AND slot = 7")).rows[0].read_through, 855);

    const unexpected = await syncSvpRingcxCalls(db, { svpQueueIds: async () => { throw new Error('postgres://secret'); } }, start + 3 * FIVE_MINUTES);
    assert.deepEqual([unexpected.code, unexpected.detail], ['SYNC_FAILED', null]);

    assert.equal((await syncSvpRingcxCalls(db, good, start + 4 * FIVE_MINUTES)).status, 'ok');
    status = await readSvpRingcxStatus(db);
    assert.deepEqual([status.errorCode, status.errorDetail], [null, null]);
  } finally { await db.close(); }
});

test('windows settle an hour after they end, and the status view compares fully read days with the workbook by agent', async () => {
  const db = await database();
  try {
    await importSvpCallsReports(db, [november]);
    const client = fakeRingCx(), now = at('2026-11-03T19:23:00Z');
    await syncSvpRingcxCalls(db, client, now);
    const { rows } = await db.query("SELECT to_char(call_date, 'YYYY-MM-DD') AS date, slot, settled FROM svp_ringcx_windows ORDER BY date, slot");
    assert.deepEqual(rows, [{ date: '2026-11-02', slot: 0, settled: true }, { date: '2026-11-03', slot: 7, settled: false }]);

    let clock = now + FIVE_MINUTES;
    await syncUntilCaughtUp(db, client, clock);
    for (let i = 0; i < 40; i++) { clock += FIVE_MINUTES * 3; if ((await readSvpRingcxStatus(db)).reconciliation.length) break; await syncSvpRingcxCalls(db, client, clock); }
    const status = await readSvpRingcxStatus(db);
    const second = status.reconciliation.find(day => day.date === '2026-11-02');
    assert.deepEqual([second.ringcx, second.workbook, second.agents, second.matching], [36, 34, 2, 1]);
    assert.deepEqual(second.differences, [{ agent: 'agent two', ringcx: 12, workbook: 10 }]);
    assert.equal(status.days.find(day => day.date === '2026-11-02').settled, 12);
    assert.equal(status.days.find(day => day.date === '2026-11-02').calls, 36);
  } finally { await db.close(); }
});
