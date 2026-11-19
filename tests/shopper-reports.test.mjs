import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { combineShopperReports, importShopperReports, parseShopperReport, readShopperReportsLeaderboard, shopperAgentKey, shopperReportFile, ShopperImportError } from '../lib/shopper-reports.mjs';
import { leaderboardTotals, rankLeaderboardRows } from '../app/leaderboard-data.mjs';
import { readAllLeaderboard } from '../lib/leaderboard-all.mjs';

const schema = await readFile(new URL('../migrations/0017_shopper_reports.sql', import.meta.url), 'utf8');
const sha = character => character.repeat(64);
const CALL_HEADER = ['Direction', 'Contact', 'From', 'Source', 'To', 'Duration', 'Agent', 'Date', 'Status', 'Provider'];
const APP_HEADER = ['Policy: Application Submit Date', 'Carrier: Carrier Name', 'Policy: Policy Number', 'Policy: Premium', 'Individual: First Name', 'Agent: First Name', 'Agent: Last Name', 'Agency: Agency Name'];
// All names and numbers are synthetic.
const call = (agent, date, from = '(555) 010-0000', direction = 'Inbound') => [direction, 'Caller', from, 'Queue', '+1555*****000', '01:04 Min', agent, date, 'Completed', 'policytek'];
const app = (first, last, date, premium, policy = 'AUTO-1') => [date, 'Carrier', policy, premium, 'Customer', first, last, 'Agency'];
const callsFile = (name, rows, checksum = 'a') => parseShopperReport({ fileName: name, sha256: sha(checksum), sheets: [{ sheet: 'report', data: [CALL_HEADER, ...rows] }] });
const appsFile = (name, rows, checksum = 'b') => parseShopperReport({ fileName: name, sha256: sha(checksum), sheets: [{ sheet: 'report', data: [APP_HEADER, ...rows] }] });

test('file names give the report kind and export day', () => {
  assert.deepEqual(shopperReportFile('calls-report_11-19-2026_1046 (3).xlsx'), { kind: 'calls', exportDate: '2026-11-19' });
  assert.deepEqual(shopperReportFile('applications-report_11-19-2026_1041.xlsx'), { kind: 'applications', exportDate: '2026-11-19' });
  for (const bad of ['calls-report.xlsx', 'Calls-Report_11-19-2026_1046.xlsx', 'calls-report_13-19-2026_1046.xlsx', 'leads-report_11-19-2026_1046.xlsx']) assert.throws(() => shopperReportFile(bad), ShopperImportError);
});

test('agent keys fold case and spaces and drop single-letter middle initials only', () => {
  assert.equal(shopperAgentKey('synthetic  ALPHA'), 'synthetic alpha');
  assert.equal(shopperAgentKey('Synthetic R Alpha'), 'synthetic alpha');
  assert.equal(shopperAgentKey('synthetic r. alpha'), 'synthetic alpha');
  assert.equal(shopperAgentKey('Synthetic Ray Alpha'), 'synthetic ray alpha');
  assert.equal(shopperAgentKey('A Alpha'), 'a alpha');
});

test('rows are validated; the export day, outbound calls and blank agents are skipped', () => {
  const calls = callsFile('calls-report_11-19-2026_1046.xlsx', [call('synthetic  alpha', '11/18/2026 09:02:41 pm'), call('synthetic alpha', '11/19/2026 09:02:41 am'), call('synthetic alpha', '11/18/2026 10:00:00 am', '(555) 010-0001', 'Outbound'), call('  ', '11/18/2026 10:00:00 am'), []]);
  assert.equal(calls.records.length, 1);
  assert.deepEqual(calls.skipped, { exportDay: 1, notInbound: 1, noAgent: 1 });
  assert.equal(calls.records[0].date, '2026-11-18');
  assert.doesNotMatch(JSON.stringify(calls.records), /555|Caller|Customer/);
  const apps = appsFile('applications-report_11-19-2026_1041.xlsx', [app('synthetic', 'alpha', '11/18/2026', 1016.4000000000001)]);
  assert.equal(apps.records[0].cents, 101640);
  assert.throws(() => callsFile('calls-report_11-19-2026_1046.xlsx', [call('a b', '2026-11-18 09:00')]), /row 2: Date/);
  assert.throws(() => callsFile('calls-report_11-19-2026_1046.xlsx', [call('a b', '02/30/2026 09:00:00 am')]), /row 2: Date/);
  assert.throws(() => appsFile('applications-report_11-19-2026_1041.xlsx', [app('a', 'b', '11/18/2026', '$10')]), /Policy: Premium/);
  assert.throws(() => parseShopperReport({ fileName: 'calls-report_11-19-2026_1046.xlsx', sha256: sha('a'), sheets: [{ sheet: 'report', data: [CALL_HEADER.filter(column => column !== 'Agent')] }] }), /missing the Agent column/);
  assert.throws(() => parseShopperReport({ fileName: 'calls-report_11-19-2026_1046.xlsx', sha256: 'x', sheets: [] }), /checksum/);
});

test('combining merges middle-initial spellings, counts agreeing overlaps once and refuses disagreeing or missing exports', () => {
  const first = callsFile('calls-report_11-19-2026_1044.xlsx', [call('synthetic r alpha', '11/02/2026 09:00:00 am'), call('synthetic r alpha', '11/02/2026 09:05:00 am')], 'a');
  const overlap = callsFile('calls-report_11-19-2026_1045.xlsx', [call('synthetic r alpha', '11/02/2026 09:05:00 am'), call('synthetic r alpha', '11/02/2026 09:00:00 am'), call('synthetic beta', '11/05/2026 09:00:00 am')], 'c');
  const apps = appsFile('applications-report_11-19-2026_1041.xlsx', [app('synthetic', 'alpha', '11/02/2026', 100), app('synthetic', 'alpha', '11/02/2026', 100), app('Synthetic', 'McGamma', '11/03/2026', 50.5)]);
  const combined = combineShopperReports([first, overlap, apps]);
  assert.equal(combined.skipped.duplicates, 2);
  // An older export whose rows changed since must not add them twice.
  const stale = callsFile('calls-report_11-03-2026_0529.xlsx', [call('synthetic r alpha', '11/02/2026 09:05:00 am', '(555) 010-0009'), call('synthetic r alpha', '11/02/2026 09:00:00 am')], 'f');
  assert.throws(() => combineShopperReports([first, stale]), /calls-report_11-19-2026_1044\.xlsx and calls-report_11-03-2026_0529\.xlsx both cover 2026-11-02 to 2026-11-02 but differ there/);
  // A row repeated a different number of times in two overlapping exports is a disagreement too, whatever the file order.
  const row = call('synthetic r alpha', '11/02/2026 09:00:00 am');
  const twice = callsFile('calls-report_11-19-2026_1044.xlsx', [row, row], '7'), once = callsFile('calls-report_11-19-2026_1045.xlsx', [row], '8');
  for (const order of [[twice, once], [once, twice]]) assert.throws(() => combineShopperReports(order), /both cover 2026-11-02 to 2026-11-02 but differ there/);
  const twiceAgain = callsFile('calls-report_11-19-2026_1046.xlsx', [row, row], '9');
  for (const order of [[twice, twiceAgain], [twiceAgain, twice]]) assert.deepEqual(combineShopperReports(order).kinds.calls.rows.map(({ count }) => count), [2]);
  assert.deepEqual(combined.kinds.calls.rows.map(({ date, key, name, count }) => [date, key, name, count]), [['2026-11-02', 'synthetic alpha', 'Synthetic Alpha', 2], ['2026-11-05', 'synthetic beta', 'Synthetic Beta', 1]]);
  // Identical rows within one file are the report's own and both count.
  assert.deepEqual(combined.kinds.applications.rows.map(({ key, name, count, cents }) => [key, name, count, cents]), [['synthetic alpha', 'Synthetic Alpha', 2, 20000], ['synthetic mcgamma', 'Synthetic McGamma', 1, 5050]]);
  assert.deepEqual([combined.kinds.calls.firstDate, combined.kinds.calls.lastDate], ['2026-11-02', '2026-11-05']);
  assert.throws(() => combineShopperReports([first, { ...first }]), /same file/);
  const later = callsFile('calls-report_11-19-2026_1046.xlsx', [call('synthetic beta', '11/09/2026 09:00:00 am')], 'd');
  assert.throws(() => combineShopperReports([first, later]), /No calls rows from 2026-11-02 to 2026-11-09/);
  assert.equal(Object.keys(combineShopperReports([callsFile('calls-report_11-02-2026_1046.xlsx', [call('a b', '11/02/2026 09:00:00 am')])]).kinds).length, 0);
});

test('agents who differ only by middle initial are kept apart', () => {
  const calls = callsFile('calls-report_11-19-2026_1044.xlsx', [call('synthetic a alpha', '11/02/2026 09:00:00 am'), call('synthetic b alpha', '11/02/2026 09:01:00 am')]);
  const combined = combineShopperReports([calls, appsFile('applications-report_11-19-2026_1041.xlsx', [app('synthetic', 'alpha', '11/02/2026', 10)])]);
  assert.equal(combined.ambiguousNames, 1);
  assert.deepEqual(combined.kinds.calls.rows.map(row => row.key), ['synthetic a alpha', 'synthetic b alpha']);
  assert.deepEqual(combined.kinds.applications.rows.map(row => row.key), ['synthetic alpha']);
});

test('imported days serve the Shopper board only when both reports cover the whole range', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema); await db.exec(schema);
    const now = Date.parse('2026-11-19T15:00:00Z');
    const read = (from, to, at = now) => readShopperReportsLeaderboard({ board: 'shopper', period: 'custom', from, to }, { db, now: at });
    assert.equal(await read('2026-11-02', '2026-11-03'), null);
    const combined = combineShopperReports([
      callsFile('calls-report_11-19-2026_1044.xlsx', [call('synthetic r alpha', '11/02/2026 09:00:00 am'), call('synthetic r alpha', '11/02/2026 10:00:00 am'), call('synthetic r alpha', '11/03/2026 10:00:00 am'), call('synthetic beta', '11/03/2026 11:00:00 am'), call('synthetic gamma', '11/06/2026 11:00:00 am')]),
      appsFile('applications-report_11-19-2026_1041.xlsx', [app('synthetic', 'alpha', '11/01/2026', 120.25), app('synthetic', 'alpha', '11/03/2026', 80), app('synthetic', 'delta', '11/06/2026', 10)]),
    ]);
    await importShopperReports(db, combined, now);
    // Calls start Nov 2 and applications Nov 1; Nov 4–5 have no rows but are covered days.
    let result = await read('2026-11-02', '2026-11-06');
    assert.equal(result.status, 'available'); assert.equal(result.basis, 'reports'); assert.equal(result.partial, false); assert.equal(result.dataThrough, '2026-11-06');
    const byName = Object.fromEntries(result.rows.map(row => [row.name, row]));
    assert.deepEqual(byName['Synthetic Alpha'], { name: 'Synthetic Alpha', attributed: true, leads: 3, submitted: 1, premium: 80 });
    assert.deepEqual(byName['Synthetic Beta'], { name: 'Synthetic Beta', attributed: true, leads: 1, submitted: 0, premium: 0 });
    assert.deepEqual(byName['Synthetic Delta'], { name: 'Synthetic Delta', attributed: true, leads: 0, submitted: 1, premium: 10 });
    assert.deepEqual(result.reportTotals, { leads: 5, submitted: 2, premium: 90 });
    assert.match(result.notice, /Close rate is submitted ÷ calls/);
    assert.match(result.notice, /2 agents with calls but no applications count in the totals only/);
    // Ranked rows keep only agents with applications, as the Shopper board always has.
    assert.deepEqual(rankLeaderboardRows(result.rows, 'shopper', 'ap').map(row => row.name), ['Synthetic Alpha', 'Synthetic Delta']);
    assert.equal(leaderboardTotals(result.rows, 'shopper').leads, 5);
    // The All board takes this imported result as its Shopper half.
    const all = await readAllLeaderboard({ board: 'all', period: 'custom', from: '2026-11-02', to: '2026-11-06' }, { now,
      readShopper: (selected, options) => readShopperReportsLeaderboard(selected, { db, ...options }),
      readStandardPreferred: async selected => ({ ...selected, status: 'available', source: 'Synthetic', startDate: '2026-11-02', endDate: '2026-11-06', rows: [], calls: { status: 'available', total: 0, partial: false }, partial: false, stale: false, fetchedAt: new Date(now).toISOString() }) });
    assert.equal(all.status, 'available');
    assert.deepEqual(all.combinedTotals, { sales: 2, annualPremium: 90, calls: 5, closeRate: 2 / 5 });
    assert.match(all.notice, /inbound calls from the imported PolicyTek Calls report/);
    // Days before a report's first imported row are unknown, so those ranges keep the browser sync rather than understate it.
    assert.equal(await read('2026-11-01', '2026-11-06'), null, 'calls start Nov 2');
    assert.equal(await read('2026-10-25', '2026-11-03'), null, 'both reports start after Oct 25');
    assert.equal(await read('2026-11-05', '2026-11-07'), null, 'a range past the imported days keeps the browser sync');
    assert.equal(await read('2026-10-01', '2026-10-31'), null, 'a range wholly before the imports keeps the browser sync');
    assert.equal(await readShopperReportsLeaderboard({ board: 'shopper', period: 'day' }, { db, now }), null);
    await assert.rejects(readShopperReportsLeaderboard({ board: 'source', period: 'day' }, { db, now }), TypeError);

    // A later import replaces only its own kind and days, and extends coverage.
    await importShopperReports(db, combineShopperReports([callsFile('calls-report_11-19-2026_1046.xlsx', [call('synthetic alpha', '11/03/2026 09:00:00 am'), call('synthetic alpha', '11/07/2026 09:00:00 am')], 'e')]), now + 1000);
    assert.equal(await read('2026-11-02', '2026-11-07'), null, 'applications do not cover Nov 7 yet');
    result = await read('2026-11-02', '2026-11-06');
    // Nov 3 and Nov 6 calls were replaced; Nov 2 was not part of the new import and stays.
    assert.deepEqual(result.reportTotals, { leads: 3, submitted: 2, premium: 90 });
    assert.equal(result.fetchedAt, new Date(now + 1000).toISOString());
    const { rows: [days] } = await db.query("SELECT count(*)::int AS days FROM shopper_report_days WHERE kind = 'calls'");
    assert.equal(days.days, 6);
    // A failed import changes nothing.
    await assert.rejects(importShopperReports(db, { kinds: { calls: { firstDate: '2026-11-02', lastDate: '2026-11-02', records: 1, files: [], rows: [{ date: '2026-11-02', key: 'Not Folded', name: 'x', count: 1, cents: 0 }] } } }, now));
    assert.deepEqual((await read('2026-11-02', '2026-11-06')).reportTotals, { leads: 3, submitted: 2, premium: 90 });
  } finally { await db.close(); }
});
