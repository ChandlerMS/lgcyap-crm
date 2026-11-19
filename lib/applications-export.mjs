import { randomUUID } from 'node:crypto';
import { applicationWorkbook, ApplicationExportError } from './application-download.mjs';
export { applicationWorkbook, ApplicationExportError } from './application-download.mjs';
export { filterApplications } from './application-filters.mjs';
export const DRIVE_EXPORT_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export function exportFilters(input) {
  if (!input || typeof input.query !== 'string' || input.query.length > 200 || !['all', 'orlando', 'miami', 'tampa', 'other'].includes(input.office) || !['all', 'not-met', 'flagged', 'waiting'].includes(input.status)) throw new ApplicationExportError('Choose valid application filters before exporting.');
  return { query: input.query, office: input.office, status: input.status };
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
