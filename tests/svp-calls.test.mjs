import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applySvpCalls, importSvpCallsReports, parseSvpCallsReport, readSvpCalls, SvpCallsImportError } from '../lib/svp-calls.mjs';

const schema = await readFile(new URL('../migrations/0007_svp_calls.sql', import.meta.url), 'utf8');
const SHA = 'a'.repeat(64);
const file = month => `Agent_Daily_Calls_${month}_Synthetic_2026.xlsx`;
const day = (date, rows, total = true) => ({ sheet: date, data: [[`Daily Connected Calls Report — ${date}`], ['Source: synthetic'], [], ['Date', 'Agent Full Name', 'Total Calls Connected'], ...rows.map(([name, calls]) => [date, name, calls]), ...(total ? [['Total', `${rows.length} Active Agents`, null]] : [])] });
const summary = { sheet: 'Monthly_Summary', data: [['ignored'], [], [], ['Date', 'Active Agents', 'Total Calls Connected', 'Total Calls Dialed']] };

test('parsing reads daily sheets, folds name case and spacing, skips unassigned rows and validates without echoing names', () => {
  const report = parseSvpCallsReport({ fileName: file('2026-10'), sha256: SHA, sheets: [summary, day('2026-10-01', [['Agent One', 5], [' agent  one ', 2], ['Agent Two', 0]]), day('2026-10-03', [['Unassigned (No Agent)', 0]])] });
  assert.deepEqual([report.month, report.firstDate, report.lastDate, report.days, report.unassigned], ['2026-10', '2026-10-01', '2026-10-03', 2, 0]);
  assert.deepEqual(report.calls.map(({ date, key, connected }) => [date, key, connected]), [['2026-10-01', 'agent one', 7], ['2026-10-01', 'agent two', 0]]);
  const bad = [
    [day('2026-10-01', [['Private Person', 1.5]])],
    [day('2026-10-01', [['Private Person', 1]], false)],
    [day('2026-11-01', [['Private Person', 1]])],
    [{ ...day('2026-10-01', [['Private Person', 1]]), data: [[], [], [], ['Date', 'Agent', 'Total Calls Connected']] }],
    [summary],
  ];
  for (const sheets of bad) assert.throws(() => parseSvpCallsReport({ fileName: file('2026-10'), sha256: SHA, sheets }), error => error instanceof SvpCallsImportError && !/Private/.test(error.message));
  assert.throws(() => parseSvpCallsReport({ fileName: 'calls.xlsx', sha256: SHA, sheets: [] }), SvpCallsImportError);
});

const october = parseSvpCallsReport({ fileName: file('2026-10'), sha256: SHA, sheets: [day('2026-10-01', [['Agent One', 10], ['Agent Two', 4], ['Agent Three', 6]]), day('2026-10-02', [['Agent One', 10]])] });
const spResult = (rows, extra = {}) => ({ status: 'available', board: 'sp', startDate: '2026-10-01', endDate: '2026-10-02', partial: false, salesComplete: true, rows, calls: { status: 'available', total: 99 }, callNotice: 'HubSpot logs', ...extra });

test('imported calls replace HubSpot call logs on covered ranges, with close = sold ÷ calls', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema); await db.exec(schema);
    assert.equal((await readSvpCalls(db, { startDate: '2026-10-01', endDate: '2026-10-02' })).status, 'not-covered');
    await importSvpCallsReports(db, [october], Date.parse('2026-11-03T15:00:00Z'));
    const calls = await readSvpCalls(db, { startDate: '2026-10-01', endDate: '2026-10-02' });
    assert.deepEqual([calls.status, calls.partial, calls.total], ['available', false, 30]);
    const result = applySvpCalls(spResult([{ name: 'AGENT ONE', attributed: true, sales: 5 }, { name: 'Agent Two', attributed: true, sales: 2 }, { name: 'Agent Four', attributed: true, sales: 1 }, { name: 'Writing agent not recorded', attributed: false, sales: 2 }]), calls);
    assert.deepEqual(result.rows.map(row => [row.inboundCalls, row.soldPerInboundLog]), [[20, .25], [4, .5], [0, null], [null, null]]);
    assert.deepEqual(result.calls, { status: 'available', basis: 'spreadsheet', total: 30, partial: false, soldPerInboundLog: 10 / 30 });
    assert.match(result.callNotice, /answered/); assert.match(result.callNotice, /One agent with calls but no Sold deals/);
    assert.equal(applySvpCalls(spResult([], { salesComplete: false }), calls).calls.soldPerInboundLog, null);
    const straddle = await readSvpCalls(db, { startDate: '2026-09-25', endDate: '2026-10-01' });
    assert.equal(straddle.partial, true); assert.match(applySvpCalls(spResult([]), straddle).callNotice, /outside the imported call reports/);
    const outside = await readSvpCalls(db, { startDate: '2026-11-05', endDate: '2026-11-05' });
    assert.equal(outside.status, 'not-covered'); assert.equal(applySvpCalls(spResult([]), outside).callNotice, 'HubSpot logs');
    const smaller = parseSvpCallsReport({ fileName: file('2026-10'), sha256: 'b'.repeat(64), sheets: [day('2026-10-02', [['Agent Two', 3]])] });
    await importSvpCallsReports(db, [smaller]);
    assert.equal((await readSvpCalls(db, { startDate: '2026-10-01', endDate: '2026-10-31' })).total, 3);
    await assert.rejects(importSvpCallsReports(db, [smaller, smaller]), SvpCallsImportError);
  } finally { await db.close(); }
});
