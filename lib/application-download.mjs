import { zipSync, strToU8 } from 'fflate';
export class ApplicationExportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const column = index => { let result = ''; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result; return result; };
/** XLSX inline strings prevent Google import from treating applicant answers as formulas or changing phone numbers. */
export function applicationExportRows(applications, reviews = {}, reviewComplete = false) {
  const fixed = ['Application ID', 'Submitted at', 'Event day', 'Name', 'Preferred name', 'Email', 'Phone', 'Office', 'City', 'State', 'ZIP', 'License status', 'Start date', 'Heard about', 'Referred by', 'Required items met', 'Missed requirements', 'Private conversation flags', 'Recruiting stage', 'Review status', 'Photo ID attached', 'HubSpot contact', 'HubSpot ticket', 'HubSpot outcome', 'Existing HubSpot contact', 'Reviewed at'];
  const answers = new Map();
  for (const item of applications) for (const section of item.sections ?? []) for (const row of section.rows) answers.set(`${section.title}\0${row.label}`, `${section.title} · ${row.label}`);
  const data = [[...fixed, ...answers.values()], ...applications.map(item => {
    const response = new Map((item.sections ?? []).flatMap(section => section.rows.map(row => [`${section.title}\0${row.label}`, row.value])));
    const review = reviews[item.ticket?.id];
    return [item.id, item.at, item.day, item.name, item.preferredName, item.email, item.phone, item.office, item.city, item.state, item.zip, item.license, item.startDate, item.heardAbout, item.referredBy,
      item.requirementsMet === true ? 'Yes' : item.requirementsMet === false ? 'No' : 'Unknown', (item.missed ?? []).join('; '), (item.flags ?? []).join('; '), item.ticket?.stage,
      review?.status === 'approved' ? 'Approved' : review?.status === 'denied' ? 'Denied' : reviewComplete ? 'Not reviewed' : 'Unavailable', item.photoId ? 'Yes' : 'No', item.contact?.url, item.ticket?.url, item.outcomeText ?? item.outcome, item.existingContact ? 'Yes' : 'No', review?.reviewedAt, ...[...answers.keys()].map(key => response.get(key) ?? '')];
  })];
  if (data.length > 10001 || data[0].length > 1000) throw new ApplicationExportError('This export is too large. Narrow the application filters.');
  return data;
}
export function applicationWorkbook(applications, reviews = {}, reviewComplete = false) {
  const data = applicationExportRows(applications, reviews, reviewComplete);
  const sheet = data.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheet}</sheetData></worksheet>`,
  };
  const workbook = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`)])), { level: 3 });
  if (workbook.length > 25 * 1024 * 1024) throw new ApplicationExportError('This export is too large. Narrow the application filters.');
  return workbook;
}

// CSV consumers may evaluate formula prefixes even inside quoted fields.
export function applicationCsv(applications, reviews = {}, reviewComplete = false) {
  const cell = value => {
    const text = String(value ?? '');
    const literal = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
    return '"' + literal.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + applicationExportRows(applications, reviews, reviewComplete).map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
