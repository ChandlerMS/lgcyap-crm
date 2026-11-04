import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readLeadData, syncLeadData } from '../lib/lead-data.mjs';
import { importLeadDataWorkbooks, LeadDataImportError, leadDataWorkbookDays, parseLeadDataWorkbook } from '../lib/lead-data-workbooks.mjs';

const NOON = Date.parse('2026-11-03T17:00:00Z');
const INSTANT = 'Instant Hangups', SHORT = 'Short Duration Calls', CALLER = '+15551234567', NOTE = 'called back about a policy';
const day = text => new Date(`${text}T00:00:00.000Z`);

/** Mirrors the real files: month sheets with the header on row 4 and a closing Total, and Call Data with caller details beside the columns the import reads. */
const sheets = (title, calls, total = calls.length) => [
  { sheet: 'October 2026', data: [[`${title} - October 2026`], [], [], ['Date', 'Day', title], [day('2026-10-01'), day('2026-10-01'), total], ['Total', null, total]] },
  { sheet: 'Call Data', data: [['Date', 'Agent', 'Number', 'Disposition', 'Interaction Seconds', 'Source Row'], ...calls.map(([date, agent, seconds], index) => [day(date), agent, CALLER, NOTE, seconds, index + 2])] },
  { sheet: 'Notes', data: [['About this workbook']] },
];
const parse = (title, calls, total) => parseLeadDataWorkbook({ fileName: `${title} - Daily Totals.xlsx`, sheets: sheets(title, calls, total) });

async function database() {
  const client = new PGlite();
  for (const file of ['0011_lead_data.sql', '0012_lead_data_workbooks.sql']) {
    const sql = readFileSync(`migrations/${file}`, 'utf8');
    await client.exec(sql); await client.exec(sql);
  }
  return client;
}

const call = (date, name, id, seconds) => ({ date, name, call: id, seconds });
const reports = ({ version = 'v1', short = [], instant = [] }) => async () => ({
  version,
  readShort: async (from, to) => short.filter(row => row.date >= from && row.date <= to),
  readInstant: async (from, to) => instant.filter(row => row.date >= from && row.date <= to),
  dataLoadedAt: async () => '2026-11-03 12:00:00',
});
const agentDay = (date, name, instantDisconnects, shortDuration) => ({ date, key: name.toLowerCase(), name, instantDisconnects, shortDuration });
const stored = async db => (await db.query(`SELECT to_char(call_date, 'YYYY-MM-DD') AS date, agent_key, instant_disconnects AS instant, short_duration AS short FROM lead_data_workbook_daily ORDER BY call_date, agent_key`)).rows;

test('a workbook keeps only each call\'s date, agent and seconds, never caller details', () => {
  const parsed = parse(INSTANT, [['2026-10-01', 'Ana Lee', 2]], 1);
  const kept = JSON.stringify(parsed);
  assert.ok(!kept.includes(CALLER), 'caller number was kept');
  assert.ok(!kept.includes(NOTE), 'disposition was kept');
  assert.match(kept, /Ana Lee/);
});

test('workbook counts follow the live rules: 2 seconds or less for instant, every call for short, blank agents as N/A', () => {
  const days = leadDataWorkbookDays([
    parse(INSTANT, [['2026-10-01', 'Ana Lee', 2], ['2026-10-01', 'Ana Lee', 3], ['2026-10-02', '', 0]], 2),
    parse(SHORT, [['2026-10-01', 'Ana Lee', 5], ['2026-10-01', 'Ana Lee', 400], ['2026-10-01', 'Bo Ray', 1]]),
  ]);
  const sorted = [...days].sort((a, b) => `${a.date}${a.key}`.localeCompare(`${b.date}${b.key}`));
  assert.deepEqual(sorted, [agentDay('2026-10-01', 'Ana Lee', 1, 2), agentDay('2026-10-01', 'Bo Ray', 0, 1), agentDay('2026-10-02', 'N/A', 1, 0)]);
});

test('the two workbooks can be named in either order', () => {
  const instant = parse(INSTANT, [['2026-10-01', 'Ana Lee', 1]]), short = parse(SHORT, [['2026-10-01', 'Ana Lee', 5]]);
  assert.deepEqual(leadDataWorkbookDays([short, instant]), leadDataWorkbookDays([instant, short]));
});

test('a workbook that is not one of these, or is damaged, stops the import and names only the file and row', () => {
  const refused = [
    ['no month sheets', [{ sheet: 'Call Data', data: [['Date', 'Agent', 'Interaction Seconds'], [day('2026-10-01'), 'Ana Lee', 1]] }]],
    ['no Call Data', sheets(SHORT, [['2026-10-01', 'Ana Lee', 1]]).filter(({ sheet }) => sheet !== 'Call Data')],
    ['no Interaction Seconds column', sheets(SHORT, [['2026-10-01', 'Ana Lee', 1]]).map(sheet => sheet.sheet === 'Call Data' ? { ...sheet, data: sheet.data.map(row => row.slice(0, 4)) } : sheet)],
    ['a date that is not a date', sheets(SHORT, [['2026-10-01', 'Ana Lee', 1]]).map(sheet => sheet.sheet === 'Call Data' ? { ...sheet, data: [sheet.data[0], ['soon', ...sheet.data[1].slice(1)]] } : sheet)],
    ['seconds that are not a number', sheets(SHORT, [['2026-10-01', 'Ana Lee', '02.0s']])],
    ['negative seconds', sheets(SHORT, [['2026-10-01', 'Ana Lee', -1]])],
    ['a month sheet with no Total', sheets(SHORT, [['2026-10-01', 'Ana Lee', 1]]).map(sheet => sheet.sheet === 'October 2026' ? { ...sheet, data: sheet.data.slice(0, -1) } : sheet)],
  ];
  for (const [why, data] of refused) {
    assert.throws(() => parseLeadDataWorkbook({ fileName: 'file.xlsx', sheets: data }), error => {
      assert.ok(error instanceof LeadDataImportError, why);
      assert.match(error.message, /file\.xlsx/, why);
      assert.doesNotMatch(error.message, /Ana Lee|555/, why);
      return true;
    }, why);
  }
});

test('both workbooks are required, once each', () => {
  const instant = parse(INSTANT, [['2026-10-01', 'Ana Lee', 1]]), short = parse(SHORT, [['2026-10-01', 'Ana Lee', 5]]);
  for (const workbooks of [[instant], [short], [short, short], [instant, instant]]) assert.throws(() => leadDataWorkbookDays(workbooks), LeadDataImportError);
});

test('Call Data that disagrees with the month sheets stops the import', () => {
  const short = parse(SHORT, [['2026-10-01', 'Ana Lee', 5]]);
  assert.throws(() => leadDataWorkbookDays([parse(INSTANT, [['2026-10-01', 'Ana Lee', 3]], 1), short]), LeadDataImportError, 'the month sheets count an instant call the 2-second rule does not');
  assert.throws(() => leadDataWorkbookDays([parse(INSTANT, [['2026-10-01', 'Ana Lee', 1]]), parse(SHORT, [['2026-10-01', 'Ana Lee', 5]], 2)]), LeadDataImportError, 'a call is missing from Call Data');
});

test('workbooks with no calls stop the import', () => {
  assert.throws(() => leadDataWorkbookDays([parse(INSTANT, []), parse(SHORT, [])]), LeadDataImportError);
});

test('a workbook day counts only when the reports have nothing for that day, so no call counts twice', async () => {
  const db = await database();
  await syncLeadData(db, reports({ short: [call('2026-11-02', 'Ana Lee', 's1', 5), call('2026-11-03', 'Ana Lee', 's2', 5)], instant: [call('2026-11-02', 'Ana Lee', 'i1', 1)] }), NOON);
  await importLeadDataWorkbooks(db, [agentDay('2026-10-01', 'Ana Lee', 1, 4), agentDay('2026-10-01', 'N/A', 2, 3), agentDay('2026-11-02', 'Ana Lee', 1, 9), agentDay('2026-11-02', 'Bo Ray', 0, 7)], NOON);

  const whole = await readLeadData({ period: 'custom', from: '2026-10-01', to: '2026-11-03' }, { db, now: NOON + 60000 });
  assert.deepEqual(whole.ringcentral.totals, { instantDisconnects: 4, shortDuration: 9 });
  assert.deepEqual(whole.ringcentral.rows, [{ name: 'Ana Lee', instantDisconnects: 2, shortDuration: 6 }]);
  assert.deepEqual(whole.ringcentral.noAgent, { instantDisconnects: 2, shortDuration: 3 });
  assert.match(whole.ringcentral.notice, /workbooks/);

  const covered = await readLeadData({ period: 'custom', from: '2026-11-02', to: '2026-11-02' }, { db, now: NOON + 60000 });
  assert.deepEqual(covered.ringcentral.totals, { instantDisconnects: 1, shortDuration: 1 });
  assert.doesNotMatch(covered.ringcentral.notice, /workbooks/, 'a range the reports cover needs no workbook note');
  await db.close();
});

test('saving a report that drops a day keeps the workbook history and shows it for that day', async () => {
  const db = await database();
  await syncLeadData(db, reports({ short: [call('2026-11-02', 'Ana Lee', 's1', 5), call('2026-11-03', 'Ana Lee', 's2', 5)] }), NOON);
  await importLeadDataWorkbooks(db, [agentDay('2026-11-02', 'Ana Lee', 1, 9), agentDay('2026-11-02', 'Bo Ray', 0, 7)], NOON);
  const run = await syncLeadData(db, reports({ version: 'v2', short: [call('2026-11-03', 'Ana Lee', 's2', 5)] }), NOON + 600000);
  assert.equal(run.rebuild, true);
  assert.equal((await stored(db)).length, 2, 'the rebuild removed workbook rows');
  const { ringcentral } = await readLeadData({ period: 'custom', from: '2026-11-02', to: '2026-11-02' }, { db, now: NOON + 660000 });
  assert.deepEqual(ringcentral.totals, { instantDisconnects: 1, shortDuration: 16 });
  assert.match(ringcentral.notice, /workbooks/);
  await db.close();
});

test('importing again replaces the dates it covers and leaves earlier dates alone', async () => {
  const db = await database();
  await importLeadDataWorkbooks(db, [agentDay('2026-10-01', 'Ana Lee', 1, 4), agentDay('2026-10-02', 'Ana Lee', 1, 1), agentDay('2026-10-02', 'Bo Ray', 0, 2)], NOON);
  await importLeadDataWorkbooks(db, [agentDay('2026-10-02', 'Ana Lee', 0, 8)], NOON + 1000);
  assert.deepEqual(await stored(db), [
    { date: '2026-10-01', agent_key: 'ana lee', instant: 1, short: 4 },
    { date: '2026-10-02', agent_key: 'ana lee', instant: 0, short: 8 },
  ]);
  await db.close();
});

test('an import that fails partway leaves the earlier rows in place', async () => {
  const db = await database();
  await importLeadDataWorkbooks(db, [agentDay('2026-10-01', 'Ana Lee', 1, 4)], NOON);
  await assert.rejects(importLeadDataWorkbooks(db, [agentDay('2026-10-01', 'Ana Lee', -1, 4)], NOON + 1000));
  assert.deepEqual(await stored(db), [{ date: '2026-10-01', agent_key: 'ana lee', instant: 1, short: 4 }]);
  await db.close();
});

test('the import reports how the workbooks compare with the reports over the same dates', async () => {
  const db = await database();
  await syncLeadData(db, reports({ short: [call('2026-10-30', 'Ana Lee', 's0', 5), call('2026-11-02', 'Ana Lee', 's1', 5), call('2026-11-02', 'Bo Ray', 's2', 5), call('2026-11-03', 'Ana Lee', 's3', 5)], instant: [call('2026-11-03', 'Ana Lee', 'i1', 1)] }), NOON);
  const result = await importLeadDataWorkbooks(db, [agentDay('2026-11-02', 'Ana Lee', 0, 2), agentDay('2026-11-03', 'Ana Lee', 1, 1)], NOON);
  assert.deepEqual(result, {
    rows: 2, firstDate: '2026-11-02', lastDate: '2026-11-03', instantDisconnects: 1, shortDuration: 3,
    reports: { instantDisconnects: 1, shortDuration: 3 },
    differingAgentDays: 2,
  });
  await db.close();
});
