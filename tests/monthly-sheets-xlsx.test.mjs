import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { workbookTabs } from './xlsx-tabs.mjs';
import { monthlyWorkbook } from '../lib/monthly-sheets-xlsx.mjs';
import { createSheetsGoogle } from '../lib/application-sheets-google.mjs';

test('monthly workbook has a tab per week, a styled frozen header, a filter and literal text cells', () => {
  const book = { title: '11-26 Recruits', tabs: [{ title: 'Week 1 (01-01)', values: [['ID', 'Name'], ['1', '=IMPORTXML("x")'], ['2', 'A & <B>']] }, { title: 'Week 2 (02-08)', values: [['ID', 'Name']] }] };
  const bytes = monthlyWorkbook(book);
  assert.deepEqual(workbookTabs(bytes), [{ name: 'Week 1 (01-01)', rows: [['ID', 'Name'], ['1', '=IMPORTXML("x")'], ['2', 'A & <B>']] }, { name: 'Week 2 (02-08)', rows: [['ID', 'Name']] }]);
  const files = unzipSync(bytes), sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(sheet, /<f>/, 'no formulas are written');
  assert.ok(sheet.includes('t="inlineStr"') && !sheet.includes('t="n"'), 'every cell is a string');
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/, 'the header row uses the header style');
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A1:B3"\/>/);
  assert.match(strFromU8(files['xl/styles.xml']), /<b\/>.*FF1F293B/s);
  assert.match(strFromU8(files['[Content_Types].xml']), /sheet2\.xml/);
  assert.throws(() => monthlyWorkbook({ tabs: [{ title: 'Bad/name', values: [['A']] }] }), /Invalid/);
  assert.throws(() => monthlyWorkbook({ tabs: [{ title: 'Week 1', values: [['A']] }, { title: 'week 1', values: [['A']] }] }), /Duplicate/);
});

test('the writer updates the same Drive file with the .xlsx and needs no Sheets API', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access' });
    return Response.json({ id: 'sheet-1', mimeType: 'application/vnd.google-apps.spreadsheet' });
  };
  const google = await createSheetsGoogle({ env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' }, refreshToken: 'r', fetchImpl });
  await google.writeWorkbook('sheet-1', { month: '2026-11', title: '11-26 Applications', tabs: [{ title: 'Week 1 (01-01)', values: [['ID'], ['7']] }] });
  const write = calls.at(-1);
  assert.equal(write.method, 'PATCH');
  assert.equal(write.url, 'https://www.googleapis.com/upload/drive/v3/files/sheet-1?uploadType=multipart&fields=id,mimeType');
  assert.match(write.headers['Content-Type'], /^multipart\/related; boundary=crm_sheets_/);
  assert.match(write.body.toString('latin1'), /\r\n\r\n\{"name":"11-26 Applications"\}\r\n/);
  assert.deepEqual(workbookTabs(write.body), [{ name: 'Week 1 (01-01)', rows: [['ID'], ['7']] }]);
  assert.ok(calls.every(call => !call.url.includes('sheets.googleapis.com')));
  const wrongType = await createSheetsGoogle({ env: {}, refreshToken: 'r', fetchImpl: async url => Response.json(String(url).includes('token') ? { access_token: 'a' } : { id: 'sheet-1', mimeType: 'application/vnd.ms-excel' }) });
  await assert.rejects(wrongType.writeWorkbook('sheet-1', { title: 'x', tabs: [{ title: 'Week 1', values: [['A']] }] }), /did not confirm/);
});
