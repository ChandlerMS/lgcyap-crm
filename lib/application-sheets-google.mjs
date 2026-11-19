import { googleJson } from './application-sheets-oauth.mjs';
const MARKER = 'lgcyap-applications-v1';
export async function createSheetsGoogle({ env, refreshToken, fetchImpl = fetch, signal = AbortSignal.timeout(50000) }) {
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
    async writeWorkbook(id, book, previousColumns = 0) {
      if (!/^[\w-]+$/.test(id)) throw new Error('Invalid Google Sheets file ID.');
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
      const meta = await api(`${base}?fields=sheets.properties`);
      if (!Array.isArray(meta.sheets)) throw new Error('Invalid Google Sheets metadata.');
      const sheets = meta.sheets.map(sheet => sheet.properties);
      const requests = [{ updateSpreadsheetProperties: { properties: { title: book.title, timeZone: 'America/New_York' }, fields: 'title,timeZone' } }];
      let nextId = Math.max(0, ...sheets.map(sheet => sheet.sheetId)) + 1;
      for (const [index, tab] of book.tabs.entries()) {
        const width = tab.values[0].length;
        let sheet = sheets.find(sheet => sheet.title === tab.title);
        if (!sheet && index === 0 && sheets.length === 1 && sheets[0].title === 'Sheet1') {
          sheet = sheets[0];
          requests.push({ updateSheetProperties: { properties: { sheetId: sheet.sheetId, title: tab.title }, fields: 'title' } });
        }
        const rowCount = Math.max(sheet?.gridProperties?.rowCount ?? 1000, tab.values.length), columnCount = Math.max(sheet?.gridProperties?.columnCount ?? 26, width, previousColumns);
        if (!sheet) {
          sheet = { sheetId: nextId++ };
          requests.push({ addSheet: { properties: { sheetId: sheet.sheetId, title: tab.title, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } } } });
        } else requests.push({ updateSheetProperties: { properties: { sheetId: sheet.sheetId, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } }, fields: 'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount' } });
        const sheetId = sheet.sheetId, columns = Math.max(width, previousColumns);
        requests.push({ updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columns }, rows: tab.values.map(row => ({ values: row.map(value => ({ userEnteredValue: { stringValue: value } })) })), fields: 'userEnteredValue' } });
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.16, blue: 0.23 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat' } });
        requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: width }, properties: { pixelSize: 180 }, fields: 'pixelSize' } });
        requests.push({ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, endRowIndex: tab.values.length, startColumnIndex: 0, endColumnIndex: width } } } });
      }
      // Atomic content replacement makes repeated notifications safe and neutralizes formula injection.
      await api(`${base}:batchUpdate`, { requests });
    },
  };
}
