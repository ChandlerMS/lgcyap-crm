import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { readSheet } from 'read-excel-file/node';
import { inspectRecruitWorkbook, parseRecruitCsv, parseRecruitImport, recruitRowsFromCells, recruitRowIssues } from '../app/recruit-intake-import.mjs';

const header = ['First Name', 'Last Name', 'Phone Number', 'Email'];
const draft = { firstName: 'Avery', lastName: 'Example', phone: '(407) 555-0123', email: 'avery@example.invalid' };
function file(name, bytes) { return new File([bytes], name); }
const readWorkbook = (input, sheet, options) => readSheet(Buffer.from(input), sheet, options);
function workbook(extra = {}, formula = '') {
  const xml = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Recruits" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${header.map((value, index) => `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row><row r="2"><c r="A2" t="inlineStr"><is><t>Avery</t></is></c><c r="B2" t="inlineStr"><is><t>Example</t></is></c><c r="C2">${formula}<v>4075550123</v></c><c r="D2" t="inlineStr"><is><t>avery@example.invalid</t></is></c></row></sheetData></worksheet>`,
    ...extra,
  };
  return zipSync(Object.fromEntries(Object.entries(xml).map(([key, value]) => [key, strToU8(value)])), { level: 6 });
}

test('CSV parses BOM, quoted commas, escaped quotes and CRLF without splitting a quoted value', async () => {
  const csv = '\uFEFFFirst Name,Last Name,Phone Number,Email\r\n"Avery, Jr", "Example",4075550123,"avery@example.invalid"\r\n';
  // A quote may begin a field only at its beginning; ordinary export files omit leading spaces.
  assert.throws(() => parseRecruitCsv(csv), /unexpected quote/);
  const standard = csv.replace(', "Example"', ',"Example"');
  const rows = await parseRecruitImport(file('recruits.csv', standard));
  assert.deepEqual(rows, [{ ...draft, firstName: 'Avery, Jr', phone: '4075550123' }]);
  assert.deepEqual(parseRecruitCsv('a,b\n"one\ntwo","three ""four"""\n'), [['a', 'b'], ['one\ntwo', 'three "four"']]);
  assert.throws(() => parseRecruitCsv('a,b\n"unclosed'), /unclosed/);
  assert.throws(() => parseRecruitCsv('a,b\n"one"x,two'), /closing quote/);
});

test('import maps explicit headers, preserves editable invalid rows and rejects ambiguous columns', () => {
  assert.deepEqual(recruitRowsFromCells([['given name', 'surname', 'mobile phone'], ['Avery', 'Example', '4075550123']]), [{ ...draft, phone: '4075550123', email: '' }]);
  const invalid = recruitRowsFromCells([header, ['Avery', '', 'bad', 'bad']]);
  const errors = recruitRowIssues(invalid)[0];
  assert.ok(errors.lastName && errors.phone && errors.email);
  assert.throws(() => recruitRowsFromCells([['First Name', 'First', 'Last Name', 'Phone'], ['a', 'b', 'c', '4075550123']]), /more than one/);
  assert.throws(() => recruitRowsFromCells([['Full Name', 'Phone'], ['Avery Example', '4075550123']]), /First Name/);
  assert.throws(() => recruitRowsFromCells([header, ['Avery', 'Example', new Date(), '']]), /plain text/);
  assert.throws(() => recruitRowsFromCells([header, ['=IMPORTXML("https://example.invalid")', 'Example', '4075550123', '']]), /Formula/);
});

test('duplicate detection uses canonical phone and lowercased email and marks both rows', () => {
  const rows = [{ ...draft }, { ...draft, firstName: 'Another', phone: '+14075550123', email: 'AVERY@EXAMPLE.INVALID' }];
  const errors = recruitRowIssues(rows);
  assert.ok(errors[0].phone && errors[1].phone && errors[0].email && errors[1].email);
  assert.deepEqual(recruitRowIssues([{ firstName: '', lastName: '', phone: '', email: '' }]), [{}]);
});

test('an actual synthetic XLSX workbook reads its first worksheet and retains numeric phone digits', async () => {
  const bytes = workbook();
  assert.equal(inspectRecruitWorkbook(bytes).size, 5);
  const rows = await parseRecruitImport(file('recruits.xlsx', bytes), { readWorkbook });
  assert.deepEqual(rows, [{ ...draft, phone: '4075550123' }]);
  const browserRows = await parseRecruitImport(file('recruits.xlsx', bytes));
  assert.deepEqual(browserRows, rows);
});

test('Excel formulas, external relationships and macro content fail before the reader runs', async () => {
  const shouldNotRead = () => { assert.fail('unsafe workbook reached reader'); };
  await assert.rejects(parseRecruitImport(file('formula.xlsx', workbook({}, '<f>1+1</f>')), { readWorkbook: shouldNotRead }), /Formulas/);
  await assert.rejects(parseRecruitImport(file('external.xlsx', workbook({ 'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>' })), { readWorkbook: shouldNotRead }), /External links/);
  await assert.rejects(parseRecruitImport(file('macros.xlsx', workbook({ 'xl/vbaProject.bin': 'synthetic' })), { readWorkbook: shouldNotRead }), /Macro/);
});

test('archive preflight rejects expansion bombs, encrypted archives, truncation and path traversal', () => {
  const valid = workbook();
  const position = valid.findIndex((value, index) => value === 0x50 && valid[index + 1] === 0x4b && valid[index + 2] === 1 && valid[index + 3] === 2);
  const bomb = valid.slice(); new DataView(bomb.buffer).setUint32(position + 24, 11 * 1024 * 1024, true);
  assert.throws(() => inspectRecruitWorkbook(bomb), /expands/);
  const encrypted = valid.slice(); new DataView(encrypted.buffer).setUint16(position + 8, 1, true);
  assert.throws(() => inspectRecruitWorkbook(encrypted), /unsupported or damaged/);
  assert.throws(() => inspectRecruitWorkbook(valid.slice(0, -3)), /unsupported or damaged/);
  assert.throws(() => inspectRecruitWorkbook(workbook({ '../escape.xml': '<x/>' })), /unsupported or damaged/);
});

test('worksheet coordinates are decoded and bounded before any sparse expansion by the reader', async () => {
  let calls = 0;
  const shouldNotRead = () => { calls++; assert.fail('sparse workbook reached reader'); };
  const sheet = rows => `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
  for (const rows of [
    '<x:row r="1000000000"><x:c r="A1000000000"><x:v>1</x:v></x:c></x:row>',
    '<x:row r="&#49;000000000"><x:c r="A&#49;000000000"><x:v>1</x:v></x:c></x:row>',
    '<x:row r="1"><x:c r="ZZZZ1"><x:v>1</x:v></x:c></x:row>',
    '<x:row r="1"><x:c r="XFD1"><x:v>1</x:v></x:c></x:row>',
    '<x:row r="1"><x:c r="A502"><x:v>1</x:v></x:c></x:row>',
  ]) {
    await assert.rejects(parseRecruitImport(file('sparse.xlsx', workbook({ 'xl/worksheets/sheet1.xml': sheet(rows) })), { readWorkbook: shouldNotRead }), /first 501 rows/);
  }
  // A workbook can point to a worksheet outside the usual folder; local names
  // and decoded coordinates must still be checked in that document.
  await assert.rejects(parseRecruitImport(file('other-path.xlsx', workbook({ 'other.xml': sheet('<x:row r="1000000000"/>') })), { readWorkbook: shouldNotRead }), /first 501 rows/);
  assert.equal(calls, 0);
});

test('actual streaming expansion rejects forged ZIP sizes instead of silently accepting truncated output', async () => {
  const bytes = workbook({ 'xl/sharedStrings.xml': 'A'.repeat(1024 * 1024) });
  let offset = bytes.length - 22;
  const view = new DataView(bytes.buffer);
  const start = view.getUint32(offset + 16, true), count = view.getUint16(offset + 10, true);
  offset = start;
  for (let index = 0; index < count; index++) {
    const length = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length));
    if (name === 'xl/sharedStrings.xml') view.setUint32(offset + 24, 1, true);
    offset += 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  let calls = 0;
  await assert.rejects(parseRecruitImport(file('forged-size.xlsx', bytes), { readWorkbook: () => { calls++; assert.fail('forged size reached reader'); } }), /expansion sizes/);
  assert.equal(calls, 0);
});

test('reserved ZIP member paths and encoded external targets are rejected before rebuild or reading', async () => {
  const reserved = workbook({ reservedx: 'x' });
  const original = strToU8('reservedx'), poisoned = strToU8('__proto__');
  for (let index = 0; index <= reserved.length - original.length; index++) {
    if (original.every((value, part) => reserved[index + part] === value)) reserved.set(poisoned, index);
  }
  assert.throws(() => inspectRecruitWorkbook(reserved), /unsupported or damaged/);
  await assert.rejects(parseRecruitImport(file('external-encoded.xlsx', workbook({ 'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship TargetMode="&#69;xternal" Target="https://example.invalid"/></Relationships>' })), { readWorkbook: () => assert.fail('external target reached reader') }), /External links/);
});

test('imports enforce file, row, empty-data and unsupported-format limits', async () => {
  const csv = `${header.join(',')}\n${Array.from({ length: 501 }, (_, index) => `Avery,Example,407555${String(index).padStart(4, '0')},`).join('\n')}`;
  await assert.rejects(parseRecruitImport(file('many.csv', csv)), /at most 500/);
  await assert.rejects(parseRecruitImport(file('large.csv', new Uint8Array(2 * 1024 * 1024 + 1))), /2 MB/);
  await assert.rejects(parseRecruitImport(file('old.xls', 'data')), /Save As .xlsx/);
  await assert.rejects(parseRecruitImport(file('empty.csv', '')), /empty/);
  await assert.rejects(parseRecruitImport(file('invalid.csv', new Uint8Array([0xff]))), /UTF-8/);
});
