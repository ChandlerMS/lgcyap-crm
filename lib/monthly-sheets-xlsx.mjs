import { strToU8, zipSync } from 'fflate';

// One monthly book as an .xlsx file: a tab per week, every cell a literal inline string (never a formula), a bold
// header row on a dark fill, frozen, with a filter. Drive converts it into the month's Google Sheet, so only the
// Google Drive API is needed.
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const column = index => { let result = ''; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result; return result; };
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 25 * 1024 * 1024;

const STYLES = `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F293B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function worksheet(tab, first) {
  const width = tab.values[0].length;
  const rows = tab.values.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('');
  return `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${width}" width="26" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${column(width - 1)}${tab.values.length}"/></worksheet>`;
}

export function monthlyWorkbook(book) {
  const tabs = book?.tabs;
  if (!Array.isArray(tabs) || !tabs.length || tabs.some(tab => !Array.isArray(tab.values?.[0]) || !tab.values[0].length || !/^[^[\]:*?/\\]{1,31}$/.test(tab.title ?? ''))) throw new Error('Invalid monthly workbook.');
  if (new Set(tabs.map(tab => tab.title.toLowerCase())).size !== tabs.length) throw new Error('Duplicate monthly workbook tab.');
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${tabs.map((tab, i) => `<sheet name="${xml(tab.title)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PKG}">${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tabs.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
    ...Object.fromEntries(tabs.map((tab, i) => [`xl/worksheets/sheet${i + 1}.xml`, worksheet(tab, i === 0)])),
  };
  const workbook = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`)])), { level: 6 });
  if (workbook.length > MAX_BYTES) throw new Error('Monthly workbook is too large for one Google Sheet upload.');
  return workbook;
}
