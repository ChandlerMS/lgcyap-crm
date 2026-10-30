import { Inflate, zipSync } from 'fflate';
import { Parser } from 'saxen';
import { normalizeRecruitIntakeRow } from '../lib/recruit-intake-input.mjs';

export const MAX_INTAKE_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 10 * 1024 * 1024;
const MAX_WORKSHEET_ROW = MAX_INTAKE_ROWS + 1;
const MAX_WORKSHEET_COLUMN = 128;
const RESERVED_PATHS = new Set(['__proto__', 'constructor', 'prototype']);
const FIELDS = ['firstName', 'lastName', 'phone', 'email'];
const HEADERS = new Map([
  ['firstname', 'firstName'], ['first', 'firstName'], ['givenname', 'firstName'],
  ['lastname', 'lastName'], ['last', 'lastName'], ['surname', 'lastName'], ['familyname', 'lastName'],
  ['phone', 'phone'], ['phonenumber', 'phone'], ['mobile', 'phone'], ['mobilephone', 'phone'], ['mobilephonenumber', 'phone'],
  ['email', 'email'], ['emailaddress', 'email'],
]);

export class RecruitImportError extends Error {
  constructor(message) { super(message); this.name = 'RecruitImportError'; }
}
const invalidWorkbook = () => new RecruitImportError('This Excel file is unsupported or damaged. Save a plain .xlsx workbook and try again.');

export function emptyRecruitDraft() { return { firstName: '', lastName: '', phone: '', email: '' }; }
export function recruitDraftIsBlank(row) { return FIELDS.every(field => !String(row?.[field] ?? '').trim()); }

/** RFC 4180-style quoted fields; values are data, never formulas or instructions. */
export function parseRecruitCsv(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw new RecruitImportError('Choose a CSV file no larger than 2 MB.');
  const input = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ''; closed = false; if (row.length > 100) throw new RecruitImportError('The file has too many columns. Keep the recruit columns and try again.'); };
  const finishRow = () => { finishField(); rows.push(row); row = []; if (rows.length > 10000) throw new RecruitImportError('The file has too many rows. Import at most 500 recruits at a time.'); };
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += character;
    } else if (character === ',') finishField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index++;
      finishRow();
    } else if (character === '"') {
      if (field || closed) throw new RecruitImportError('The CSV has an unexpected quote. Export a standard comma-separated CSV and try again.');
      quoted = true;
    } else if (closed) {
      if (character !== ' ' && character !== '\t') throw new RecruitImportError('The CSV contains text after a closing quote. Check that row and try again.');
    } else field += character;
    if (field.length > 2000) throw new RecruitImportError('A cell is too long. Keep names, phone numbers and emails only.');
  }
  if (quoted) throw new RecruitImportError('The CSV has an unclosed quoted field. Check the file and try again.');
  if (field || row.length || closed) finishRow();
  return rows;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new RecruitImportError('Recruit fields must be plain text or numbers, not dates, checkboxes or formulas. Format phone cells as Text in Excel.');
  const text = String(value).trim();
  if (text.length > 2000) throw new RecruitImportError('A cell is too long. Keep names, phone numbers and emails only.');
  if (/^[=]/.test(text)) throw new RecruitImportError('Formula cells are not imported. Replace formulas with plain values and try again.');
  return text;
}

export function recruitRowsFromCells(cells) {
  if (!Array.isArray(cells)) throw new RecruitImportError('The file does not contain a readable table.');
  const headerIndex = cells.findIndex(row => Array.isArray(row) && row.some(value => value !== null && value !== undefined && String(value).trim()));
  if (headerIndex < 0) throw new RecruitImportError('The file is empty. Include column headers and at least one recruit.');
  const header = cells[headerIndex];
  if (header.length > 100) throw new RecruitImportError('The file has too many columns. Keep the recruit columns and try again.');
  const columns = new Map();
  header.forEach((value, index) => {
    const key = HEADERS.get(cellText(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!key) return;
    if (columns.has(key)) throw new RecruitImportError(`The file has more than one ${key === 'firstName' ? 'First Name' : key === 'lastName' ? 'Last Name' : key === 'phone' ? 'Phone Number' : 'Email'} column. Keep one and try again.`);
    columns.set(key, index);
  });
  if (['firstName', 'lastName', 'phone'].some(key => !columns.has(key))) throw new RecruitImportError('Include First Name, Last Name and Phone Number headers. Email is optional.');
  const drafts = [];
  for (let index = headerIndex + 1; index < cells.length; index++) {
    const cellsInRow = cells[index];
    if (!Array.isArray(cellsInRow)) throw new RecruitImportError('A row in the file could not be read.');
    const draft = Object.fromEntries(FIELDS.map(key => [key, columns.has(key) ? cellText(cellsInRow[columns.get(key)]) : '']));
    if (recruitDraftIsBlank(draft)) continue;
    drafts.push(draft);
    if (drafts.length > MAX_INTAKE_ROWS) throw new RecruitImportError('Import at most 500 recruits at a time. Split this file into smaller files.');
  }
  if (!drafts.length) throw new RecruitImportError('No recruit rows were found below the headers.');
  return drafts;
}

/** Validate ZIP sizes before any decompression; reject unsupported archive features. */
export function inspectRecruitWorkbook(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMPORT_BYTES || bytes.byteLength < 22) throw invalidWorkbook();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalidWorkbook();
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (count !== view.getUint16(end + 8, true) || !count || count > 1000 || count === 65535 || start + size !== end) throw invalidWorkbook();
  const entries = new Map(); let offset = start, expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalidWorkbook();
    const flags = view.getUint16(offset + 8, true), compression = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if ((flags & 0x41) || ![0, 8].includes(compression) || compressed === 0xffffffff || uncompressed === 0xffffffff || local === 0xffffffff || view.getUint16(offset + 34, true) || next > end) throw invalidWorkbook();
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { throw invalidWorkbook(); }
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || RESERVED_PATHS.has(part)) || entries.has(name)) throw invalidWorkbook();
    if (/vbaProject|^xl\/externalLinks\/|\.bin$/i.test(name)) throw new RecruitImportError('Macro-enabled or externally linked workbooks are not imported. Save a plain .xlsx file with values only.');
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES || uncompressed > 5 * 1024 * 1024) throw new RecruitImportError('This Excel file expands beyond the import limit. Save only the recruit sheet and try again.');
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50 || (view.getUint16(local + 6, true) & 0x41) || view.getUint16(local + 8, true) !== compression) throw invalidWorkbook();
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > start || localNameLength !== nameLength) throw invalidWorkbook();
    for (const [extraStart, extraSize] of [[offset + 46 + nameLength, extraLength], [local + 30 + localNameLength, localExtraLength]]) {
      let extraOffset = extraStart;
      while (extraOffset < extraStart + extraSize) {
        if (extraOffset + 4 > extraStart + extraSize || view.getUint16(extraOffset, true) === 1) throw invalidWorkbook();
        extraOffset += 4 + view.getUint16(extraOffset + 2, true);
        if (extraOffset > extraStart + extraSize) throw invalidWorkbook();
      }
    }
    for (let part = 0; part < nameLength; part++) if (bytes[local + 30 + part] !== bytes[offset + 46 + part]) throw invalidWorkbook();
    entries.set(name, { uncompressed, compressed, compression, dataStart }); offset = next;
  }
  if (offset !== end || !entries.has('[Content_Types].xml') || !entries.has('xl/workbook.xml')) throw invalidWorkbook();
  return entries;
}

/** Incremental output counters do not trust the ZIP's declared expansion sizes. */
function boundedWorkbookContents(bytes, entries) {
  const contents = Object.create(null); let total = 0;
  for (const [name, entry] of entries) {
    const chunks = []; let size = 0;
    const accept = chunk => {
      size += chunk.length; total += chunk.length;
      if (size > entry.uncompressed || size > 5 * 1024 * 1024 || total > MAX_EXPANDED_BYTES) throw new RecruitImportError('This Excel file has invalid or excessive expansion sizes. Save a plain workbook containing the recruit table only.');
      chunks.push(chunk);
    };
    if (entry.compression === 0) accept(bytes.slice(entry.dataStart, entry.dataStart + entry.compressed));
    else {
      const inflater = new Inflate(); inflater.ondata = accept;
      // A single compressed push can expand roughly a thousand-fold. Keep each
      // push small so output-limit checks run before a large allocation accumulates.
      if (!entry.compressed) inflater.push(new Uint8Array(), true);
      for (let offset = 0; offset < entry.compressed; offset += 256) {
        const end = Math.min(offset + 256, entry.compressed);
        inflater.push(bytes.subarray(entry.dataStart + offset, entry.dataStart + end), end === entry.compressed);
      }
    }
    if (size !== entry.uncompressed) throw invalidWorkbook();
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    contents[name] = output;
  }
  return contents;
}

function boundedPositiveInteger(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum;
}
function cellAddress(value) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,2})$/.exec(value ?? '');
  if (!match || !boundedPositiveInteger(match[2], MAX_WORKSHEET_ROW)) return null;
  const column = [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  return column <= MAX_WORKSHEET_COLUMN ? { row: Number(match[2]), column } : null;
}

/** Parse decoded XML attributes before the worksheet reader can fill sparse gaps. */
function inspectWorkbookXml(name, text, limits) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new RecruitImportError('Document types and custom entities are not imported. Save a plain .xlsx workbook.');
  let worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
  const parser = new Parser();
  parser.ns({ 'http://schemas.openxmlformats.org/spreadsheetml/2006/main': 'sheet', 'http://schemas.openxmlformats.org/package/2006/relationships': 'rel' });
  let depth = 0, roots = 0, rowCount = 0, cellCount = 0, currentRow = 0;
  const rowAddresses = new Set(), cells = new Set();
  const coordinateError = () => new RecruitImportError('Keep the Excel table within the first 501 rows and 128 columns. Remove distant cells or formatting, then save and try again.');
  parser.on('openTag', (elementName, getAttributes, decodeEntities) => {
    const localName = elementName.split(':').at(-1);
    if (!depth && ++roots > 1) throw invalidWorkbook();
    depth++; limits.elements++;
    if (depth > 128 || limits.elements > 200000) throw new RecruitImportError('This workbook is too complex. Save only the recruit table as plain values.');
    const attributes = Object.create(null);
    for (const [key, rawValue] of Object.entries(getAttributes())) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
      const localKey = key.split(':').at(-1);
      if (Object.hasOwn(attributes, localKey)) throw invalidWorkbook();
      attributes[localKey] = decodeEntities(rawValue);
    }
    if (localName === 'f') throw new RecruitImportError('Formulas are not imported. Replace formulas with plain values and try again.');
    if (localName === 'Relationship' && (attributes.TargetMode?.toLowerCase() === 'external' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(attributes.Target ?? ''))) throw new RecruitImportError('External links are not imported. Remove linked content and save a plain .xlsx file.');
    if (localName === 'worksheet') worksheet = true;
    if (!worksheet && !['row', 'c', 'col'].includes(localName)) return;
    if (localName === 'row') {
      rowCount++;
      if (rowCount > MAX_WORKSHEET_ROW || !boundedPositiveInteger(attributes.r, MAX_WORKSHEET_ROW) || rowAddresses.has(attributes.r)) throw coordinateError();
      currentRow = Number(attributes.r); rowAddresses.add(attributes.r);
      if (attributes.spans && !attributes.spans.split(/\s+/).every(span => span.split(':').length === 2 && span.split(':').every(value => boundedPositiveInteger(value, MAX_WORKSHEET_COLUMN)))) throw coordinateError();
    }
    if (localName === 'c') {
      cellCount++;
      const address = cellAddress(attributes.r);
      if (!address || address.row !== currentRow || cellCount > MAX_WORKSHEET_ROW * MAX_WORKSHEET_COLUMN || cells.has(attributes.r)) throw coordinateError();
      cells.add(attributes.r);
    }
    if (localName === 'col' && (!boundedPositiveInteger(attributes.min, MAX_WORKSHEET_COLUMN) || !boundedPositiveInteger(attributes.max, MAX_WORKSHEET_COLUMN))) throw coordinateError();
    for (const key of ['ref', 'sqref']) {
      if (attributes[key] && !attributes[key].split(/\s+/).every(range => range.split(':').length <= 2 && range.split(':').every(address => cellAddress(address)))) throw coordinateError();
    }
  });
  parser.on('closeTag', elementName => { if (elementName.split(':').at(-1) === 'row') currentRow = 0; depth--; });
  parser.on('text', value => { if (value.length > 2000) throw new RecruitImportError('An Excel value is too long. Keep names, phones and emails only.'); });
  parser.on('error', () => { throw invalidWorkbook(); });
  parser.on('warn', () => { throw invalidWorkbook(); });
  const result = parser.parse(text);
  if (result instanceof Error || depth !== 0) throw invalidWorkbook();
}

export async function parseRecruitImport(file, { readWorkbook } = {}) {
  if (!file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function' || file.size > MAX_IMPORT_BYTES) throw new RecruitImportError('Choose a CSV or .xlsx file no larger than 2 MB.');
  const extension = file.name.toLowerCase().split('.').at(-1);
  if (!['csv', 'xlsx'].includes(extension)) throw new RecruitImportError('Choose a .csv or .xlsx file. For older Excel files, use Save As .xlsx first.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_IMPORT_BYTES) throw new RecruitImportError('Choose a file no larger than 2 MB.');
  if (extension === 'csv') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new RecruitImportError('Save the CSV with UTF-8 encoding and try again.'); }
    return recruitRowsFromCells(parseRecruitCsv(text));
  }
  const entries = inspectRecruitWorkbook(bytes);
  let contents;
  try { contents = boundedWorkbookContents(bytes, entries); } catch (error) { if (error instanceof RecruitImportError) throw error; throw invalidWorkbook(); }
  const xmlLimits = { elements: 0 };
  for (const [name] of entries) {
    if (/\.(xml|rels)$/i.test(name)) {
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(contents[name]); } catch { throw invalidWorkbook(); }
      inspectWorkbookXml(name, text, xmlLimits);
    }
  }
  // Rebuild a size-verified, stored archive so the reader never expands untrusted sizes.
  const sanitized = zipSync(contents, { level: 0 });
  const reader = readWorkbook ?? (await import('read-excel-file/browser')).readSheet;
  let rows;
  try { rows = await reader(sanitized.buffer.slice(sanitized.byteOffset, sanitized.byteOffset + sanitized.byteLength), 1, { parseNumber: value => value }); } catch { throw invalidWorkbook(); }
  return recruitRowsFromCells(rows);
}

/** Validation is shared with the server; duplicate identities are marked on both rows. */
export function recruitRowIssues(rows) {
  const issues = rows.map(() => ({}));
  const phones = new Map(), emails = new Map();
  rows.forEach((row, index) => {
    if (recruitDraftIsBlank(row)) return;
    let normalized;
    try { normalized = normalizeRecruitIntakeRow(Object.fromEntries(FIELDS.map(key => [key, row[key]]))); }
    catch (error) { issues[index] = error.fieldErrors && typeof error.fieldErrors === 'object' ? error.fieldErrors : { firstName: error.message ?? 'Check this row.' }; return; }
    for (const [key, value, map] of [['phone', normalized.phone, phones], ['email', normalized.email, emails]]) {
      if (!value) continue;
      if (map.has(value)) {
        const prior = map.get(value);
        issues[prior][key] = 'This identity appears more than once in this submission.';
        issues[index][key] = 'This identity appears more than once in this submission.';
      } else map.set(value, index);
    }
  });
  return issues;
}
