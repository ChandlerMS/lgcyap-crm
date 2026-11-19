import { randomUUID } from 'node:crypto';
import { googleJson } from './application-sheets-oauth.mjs';
import { XLSX_TYPE, monthlyWorkbook } from './monthly-sheets-xlsx.mjs';
const MARKERS = { applications: 'lgcyap-applications-v1', 'sign-ins': 'lgcyap-sign-ins-v1' };
export async function createSheetsGoogle({ env, refreshToken, fetchImpl = fetch, signal = AbortSignal.timeout(50000), reportKind = 'applications' }) {
  if (!Object.hasOwn(MARKERS, reportKind)) throw new Error('Unknown Google Sheets report.');
  const MARKER = MARKERS[reportKind];
  const token = await googleJson('https://oauth2.googleapis.com/token', { method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }) }, fetchImpl);
  if (!token.access_token) throw new Error('Google Sheets authorization is unavailable.');
  const api = (url, body) => googleJson(url, { signal, headers: { Authorization: `Bearer ${token.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }, fetchImpl);
  return {
    async ensureWorkbook(book) {
      const q = `trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='applicationSync' and value='${MARKER}' } and appProperties has { key='month' and value='${book.month}' }`;
      const search = new URL('https://www.googleapis.com/drive/v3/files');
      search.search = new URLSearchParams({ q, fields: 'files(id),nextPageToken', pageSize: '100' }).toString();
      const found = await api(search.href);
      if (!Array.isArray(found.files) || found.nextPageToken || found.files.length > 1) throw new Error('Google Sheets monthly destination is ambiguous.');
      const file = found.files[0] ?? await api('https://www.googleapis.com/drive/v3/files', { name: book.title, mimeType: 'application/vnd.google-apps.spreadsheet', appProperties: { applicationSync: MARKER, month: book.month } });
      if (!/^[\w-]+$/.test(file.id ?? '')) throw new Error('Invalid Google Sheets file ID.');
      return file.id;
    },
    async shareWorkbook(id, email) {
      if (!/^[\w-]+$/.test(id) || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Invalid Google Sheets share.');
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}/permissions`);
      url.search = new URLSearchParams({ sendNotificationEmail: 'true', fields: 'id' }).toString();
      // Google emails the person a link, which is how they first find each new month's Sheet.
      const permission = await api(url.href, { type: 'user', role: 'writer', emailAddress: email });
      if (typeof permission.id !== 'string' || !permission.id) throw new Error('Google did not confirm the share.');
    },
    // Drive converts the uploaded .xlsx into this same Google Sheet, so its ID, link and sharing stay and only the
    // Google Drive API is needed. Every tab is replaced, which makes repeated runs safe and keeps cells literal.
    async writeWorkbook(id, book) {
      if (!/^[\w-]+$/.test(id)) throw new Error('Invalid Google Sheets file ID.');
      const boundary = `crm_sheets_${randomUUID()}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: book.title })}\r\n--${boundary}\r\nContent-Type: ${XLSX_TYPE}\r\n\r\n`),
        Buffer.from(monthlyWorkbook(book)), Buffer.from(`\r\n--${boundary}--`),
      ]);
      const result = await googleJson(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id,mimeType`, { method: 'PATCH', signal, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, fetchImpl);
      if (result.id !== id || result.mimeType !== 'application/vnd.google-apps.spreadsheet') throw new Error('Google did not confirm the Sheet update.');
    },
  };
}
