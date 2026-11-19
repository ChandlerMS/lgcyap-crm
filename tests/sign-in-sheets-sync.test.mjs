import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sharingSchema } from '../db/application-sheets.mjs';
import { seal } from '../lib/application-sheets-oauth.mjs';
import { syncApplicationSheets } from '../lib/application-sheets-sync.mjs';
const env = { VERCEL_ENV: 'production', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', BETTER_AUTH_SECRET: 'synthetic-secret-for-both-reports-over-32-characters' };
const now = new Date('2026-11-19T13:00:00Z');
const visit = id => ({ noteId: id, ticketId: '99', at: '2026-11-19T12:00:00Z', name: 'Synthetic signed-in recruit', email: 'test@example.invalid', office: 'orlando' });
async function database() {
  const db = new PGlite();
  for (const name of ['0015_application_sheets.sql', '0016_sign_in_sheets.sql']) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  for (const table of ['application_sheets_months', 'sign_in_sheets_months']) await db.exec(sharingSchema(table));
  await db.query('INSERT INTO application_sheets_connection(id,email,refresh_token,connected_at) VALUES(1,$1,$2,$3)', ['chandler@lgcyap.com', seal('synthetic-refresh', env.BETTER_AUTH_SECRET), now]);
  return db;
}
function google() {
  const files = [], writes = [];
  const fetchImpl = async (url, init = {}) => {
    url = String(url);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access' });
    if (url.includes('/permissions?')) return Response.json({ id: 'synthetic-permission' });
    if (url.includes('/drive/v3/files?')) {
      const q = new URL(url).searchParams.get('q');
      return Response.json({ files: files.filter(file => q.includes(file.appProperties.applicationSync)) });
    }
    if (url === 'https://www.googleapis.com/drive/v3/files') { const file = { id: `synthetic-sheet-${files.length + 1}`, ...JSON.parse(init.body) }; files.push(file); return Response.json(file); }
    if (url.endsWith(':batchUpdate')) { writes.push({ url, body: JSON.parse(init.body) }); return Response.json({}); }
    return Response.json({ sheets: [{ properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 1000, columnCount: 26 } } }] });
  };
  return { fetchImpl, files, writes };
}
test('Sign-Ins reuses Chandler OAuth but keeps files and job leases independent from Applications', async () => {
  const { syncSignInSheets, signInSheetsStatus } = await import('../lib/sign-in-sheets-sync.mjs');
  const db = await database(), provider = google();
  try {
    const deps = { db, env, now, fetchImpl: provider.fetchImpl };
    await syncApplicationSheets({ ...deps, readReport: async () => ({ partial: false, applications: [{ id: '101', at: visit('1').at, sections: [] }] }) });
    await db.query("UPDATE application_sheets_connection SET lease_owner = 'application-busy', lease_until = $1", [new Date(now.getTime() + 120000)]);
    const result = await syncSignInSheets({ ...deps, readReport: async () => ({ partial: false, visits: [visit('1')], attendees: [] }) });
    assert.equal(result.status, 'synced');
    assert.deepEqual(provider.files.map(file => file.name), ['11-26 Applications', '11-26 Recruits']);
    assert.notEqual(provider.files[0].appProperties.applicationSync, provider.files[1].appProperties.applicationSync);
    assert.equal((await db.query('SELECT spreadsheet_id FROM sign_in_sheets_months')).rows[0].spreadsheet_id, provider.files[1].id);
    const status = await signInSheetsStatus({ db, now, user: { email: 'chandler@lgcyap.com' } });
    assert.equal(status.connected, true);
    assert.equal(status.current.title, '11-26 Recruits');
    assert.equal(JSON.stringify(status).includes('synthetic-refresh'), false);
  } finally { await db.close(); }
});
test('new sign-ins replace rows once, daily repair is Eastern, and partial data cannot overwrite', async () => {
  const { syncSignInSheets } = await import('../lib/sign-in-sheets-sync.mjs');
  const db = await database(), provider = google(); let visits = [visit('1')];
  try {
    const deps = { db, env, now, fetchImpl: provider.fetchImpl, readReport: async () => ({ partial: false, visits, attendees: [] }) };
    await syncSignInSheets(deps);
    await syncSignInSheets(deps);
    assert.equal(provider.writes.length, 1);
    visits = [...visits, visit('2')];
    await syncSignInSheets(deps);
    assert.equal(provider.files.length, 1);
    assert.equal(provider.writes.length, 2);
    const cells = provider.writes[1].body.requests.flatMap(request => request.updateCells?.rows ?? []);
    assert.equal(cells.filter(row => row.values[0]?.userEnteredValue?.stringValue === '2').length, 1);
    await syncSignInSheets({ ...deps, now: new Date('2026-11-19T14:00:00Z') });
    await syncSignInSheets({ ...deps, now: new Date('2026-11-19T14:01:00Z') });
    assert.equal(provider.writes.length, 3);
    await assert.rejects(syncSignInSheets({ ...deps, readReport: async () => ({ partial: true, visits: [] }) }), /partial/i);
    assert.equal(provider.writes.length, 3);
    assert.equal((await db.query('SELECT last_error FROM sign_in_sheets_state')).rows[0].last_error, 'LAYOUT:PARTIAL');
  } finally { await db.close(); }
});
