import { randomUUID } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
export { filterApplications } from './application-filters.mjs';
export const DRIVE_EXPORT_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export class ApplicationExportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function exportFilters(input) {
  if (!input || typeof input.query !== 'string' || input.query.length > 200 || !['all', 'orlando', 'miami', 'tampa', 'other'].includes(input.office) || !['all', 'not-met', 'flagged', 'waiting'].includes(input.status)) throw new ApplicationExportError('Choose valid application filters before exporting.');
  return { query: input.query, office: input.office, status: input.status };
}
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const column = index => { let result = ''; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result; return result; };
/** XLSX inline strings prevent Google import from treating applicant answers as formulas or changing phone numbers. */
export function applicationWorkbook(applications, reviews = {}, reviewComplete = false) {
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
export async function exportGoogleSheet({ accessToken, applications, reviews, reviewComplete, now = new Date(), fetcher = fetch }) {
  if (!applications.length) throw new ApplicationExportError('No applications match these filters.');
  const workbook = applicationWorkbook(applications, reviews, reviewComplete);
  const name = `Applications · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(now)}`;
  const boundary = `crm_${randomUUID()}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'application/vnd.google-apps.spreadsheet' })}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`), Buffer.from(workbook), Buffer.from(`\r\n--${boundary}--`)]);
  let response;
  try { response = await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
  catch { throw new ApplicationExportError('Google did not confirm the export. Check your Drive before starting another export.', 502); }
  if (!response.ok) throw new ApplicationExportError(response.status === 403 ? 'Google denied the export. Allow file creation and ensure the Google Drive API is enabled for this app.' : 'Google did not confirm the export. Check your Drive before trying again.', 502);
  const result = await response.json().catch(() => null);
  if (!result || !/^[A-Za-z0-9_-]{5,200}$/.test(result.id ?? '')) throw new ApplicationExportError('Google did not confirm the saved Sheet. Check your Drive before trying again.', 502);
  return { url: `https://docs.google.com/spreadsheets/d/${result.id}/edit`, count: applications.length, name };
}
