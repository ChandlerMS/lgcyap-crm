import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', BETTER_AUTH_SECRET: 'synthetic-encryption-secret-more-than-32-characters', BETTER_AUTH_URL: 'https://crm.example.invalid', VERCEL_ENV: 'production', HUBSPOT_ACCESS_TOKEN: 'synthetic-hubspot' };
const user = { userId: 'owner-1', email: 'chandler@lgcyap.com' };
const now = () => new Date('2026-11-19T14:00:00Z');
const report = { partial: false, applications: [{ id: '1', at: '2026-11-19T13:00:00Z', name: '=Synthetic', sections: [], missed: [], flags: [] }] };
async function database() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../migrations/0015_application_sheets.sql', import.meta.url), 'utf8'));
  return db;
}
function provider({ email = user.email, failWrite = false } = {}) {
  const calls = [], files = [];
  const fetchImpl = async (url, init = {}) => {
    url = String(url); calls.push({ url, ...init });
    let body;
    if (url === 'https://oauth2.googleapis.com/token') body = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: 'openid email https://www.googleapis.com/auth/drive.file' };
    else if (url === 'https://openidconnect.googleapis.com/v1/userinfo') body = { email, email_verified: true };
    else if (url.includes('/drive/v3/files?')) body = { files };
    else if (url === 'https://www.googleapis.com/drive/v3/files' && init.method === 'POST') { const file = { id: 'synthetic-file', ...JSON.parse(init.body) }; files.push(file); body = file; }
    else if (url.endsWith(':batchUpdate')) { if (failWrite) return Response.json({ error: { message: 'sensitive provider text' } }, { status: 403 }); body = {}; }
    else if (url.includes('/v4/spreadsheets/')) body = { sheets: [{ properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 1000, columnCount: 26 } } }] };
    else throw new Error('Unexpected synthetic URL: ' + url);
    return Response.json(body);
  };
  return { fetchImpl, calls, files };
}
async function connect(db, fetchImpl, account = user) {
  const { startSheetsConnection, finishSheetsConnection } = await import('../lib/application-sheets-oauth.mjs');
  const start = startSheetsConnection({ user: account, env, now: now() });
  const state = new URL(start.url).searchParams.get('state');
  const request = new Request(`https://crm.example.invalid/api/auth/callback/google?code=synthetic-code&state=${state}`, { headers: { cookie: start.cookie.split(';')[0] } });
  await finishSheetsConnection(request, { user: account, env, db, fetchImpl, now: now() });
  return start;
}
test('offline OAuth binds owner, browser and expiry, and encrypts saved refresh token', async () => {
  const { seal, unseal, startSheetsConnection, finishSheetsConnection } = await import('../lib/application-sheets-oauth.mjs');
  const encrypted = seal('synthetic-refresh', env.BETTER_AUTH_SECRET);
  assert.ok(!encrypted.includes('synthetic-refresh'));
  assert.equal(unseal(encrypted, env.BETTER_AUTH_SECRET), 'synthetic-refresh');
  assert.throws(() => unseal(encrypted, 'different-secret-with-at-least-thirty-two-characters'));
  assert.throws(() => startSheetsConnection({ user: { ...user, email: 'other@example.invalid' }, env, now: now() }), /owner/i);
  const db = await database();
  try {
    const { fetchImpl } = provider();
    const start = await connect(db, fetchImpl);
    const url = new URL(start.url);
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('login_hint'), user.email);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const saved = (await db.query('SELECT * FROM application_sheets_connection')).rows[0];
    assert.equal(saved.email, user.email);
    assert.notEqual(saved.refresh_token, 'synthetic-refresh');
    const request = new Request('https://crm.example.invalid/api/auth/callback/google?code=code&state=wrong', { headers: { cookie: start.cookie.split(';')[0] } });
    await assert.rejects(finishSheetsConnection(request, { user, env, db, fetchImpl, now: now() }), /state/i);
    const expired = new Request(`https://crm.example.invalid/api/auth/callback/google?code=code&state=${url.searchParams.get('state')}`, { headers: { cookie: start.cookie.split(';')[0] } });
    await assert.rejects(finishSheetsConnection(expired, { user, env, db, fetchImpl, now: new Date('2026-11-19T14:11:00Z') }), /state/i);
  } finally { await db.close(); }
});
test('rejects Google consent for a different account without saving any connection', async () => {
  const db = await database();
  try {
    await assert.rejects(connect(db, provider({ email: 'other@example.invalid' }).fetchImpl), /account/i);
    assert.equal((await db.query('SELECT * FROM application_sheets_connection')).rows.length, 0);
  } finally { await db.close(); }
});
test('sync creates one monthly file, writes literal cells, skips unchanged data and repairs once at 9 am Eastern', async () => {
  const { syncApplicationSheets, applicationSheetsStatus } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const options = { db, env, fetchImpl: google.fetchImpl, readReport: async () => report };
    const first = await syncApplicationSheets({ ...options, now: now() });
    assert.equal(first.status, 'synced');
    assert.equal(google.files.length, 1);
    const writes = () => google.calls.filter(call => call.url.endsWith(':batchUpdate'));
    assert.equal(writes().length, 1);
    const body = JSON.parse(writes()[0].body);
    assert.ok(body.requests.some(request => request.updateCells?.rows?.some(row => row.values.some(cell => cell.userEnteredValue?.stringValue === '=Synthetic'))));
    await syncApplicationSheets({ ...options, now: new Date('2026-11-19T14:01:00Z') });
    assert.equal(writes().length, 1);
    await syncApplicationSheets({ ...options, now: new Date('2026-11-20T14:00:00Z') });
    assert.equal(writes().length, 2);
    const status = await applicationSheetsStatus({ db, user, now: now() });
    assert.equal(status.current.url, 'https://docs.google.com/spreadsheets/d/synthetic-file/edit');
    assert.equal(status.connected, true);
    assert.equal(JSON.stringify(status).includes('synthetic-refresh'), false);
  } finally { await db.close(); }
});
test('partial data makes no external writes and failures preserve last success for a safe retry', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const options = { db, env, fetchImpl: google.fetchImpl, now: now(), readReport: async () => ({ ...report, partial: true }) };
    await assert.rejects(syncApplicationSheets(options), /partial/i);
    assert.equal(google.files.length, 0);
    const failed = provider({ failWrite: true });
    await assert.rejects(syncApplicationSheets({ ...options, fetchImpl: failed.fetchImpl, readReport: async () => report }), /Google/i);
    const connection = (await db.query('SELECT * FROM application_sheets_connection')).rows[0];
    assert.equal(connection.last_success_at, null);
    assert.equal(connection.last_error, 'SYNC_FAILED');
    assert.equal((await db.query('SELECT fingerprint FROM application_sheets_months')).rows[0].fingerprint, null);
    // Retry after a write failure reuses the persisted file ID rather than creating another file.
    const recovered = await syncApplicationSheets({ ...options, readReport: async () => report });
    assert.equal(recovered.status, 'synced');
    assert.equal(google.files.length, 0);
  } finally { await db.close(); }
});
test('overlapping jobs skip without calling the source and preview deployments cannot sync', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database();
  try {
    await connect(db, provider().fetchImpl);
    await db.query("UPDATE application_sheets_connection SET lease_until = $1, lease_owner = 'other'", [new Date('2026-11-19T14:02:00Z')]);
    const readReport = () => { throw new Error('Source must not be called'); };
    assert.equal((await syncApplicationSheets({ db, env, now: now(), readReport })).status, 'busy');
    assert.equal((await syncApplicationSheets({ db, env: { ...env, VERCEL_ENV: 'preview' }, now: now(), readReport })).status, 'disabled');
  } finally { await db.close(); }
});
test('failed daily repair stays pending on unchanged data and retries the same day', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const options = { db, env, fetchImpl: google.fetchImpl, readReport: async () => report };
    await syncApplicationSheets({ ...options, now: now() });
    await assert.rejects(syncApplicationSheets({ ...options, fetchImpl: provider({ failWrite: true }).fetchImpl, now: new Date('2026-11-20T14:00:00Z') }));
    await syncApplicationSheets({ ...options, now: new Date('2026-11-20T16:00:00Z') });
    assert.equal(google.calls.filter(call => call.url.endsWith(':batchUpdate')).length, 2, 'failed repairs retry after the 9 am hour');
    assert.equal((await db.query('SELECT repaired_day FROM application_sheets_months')).rows[0].repaired_day, '2026-11-20');
  } finally { await db.close(); }
});
test('failed forced repair retries unchanged files and unpublished workbooks have no status link', async () => {
  const { syncApplicationSheets, applicationSheetsStatus } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const options = { db, env, fetchImpl: google.fetchImpl, readReport: async () => report, now: new Date('2026-11-19T13:00:00Z') };
    await assert.rejects(syncApplicationSheets({ ...options, fetchImpl: provider({ failWrite: true }).fetchImpl }));
    assert.equal((await applicationSheetsStatus({ db, user, now: now() })).current, null);
    await syncApplicationSheets(options);
    await assert.rejects(syncApplicationSheets({ ...options, force: true, fetchImpl: provider({ failWrite: true }).fetchImpl }));
    await syncApplicationSheets(options);
    assert.equal(google.calls.filter(call => call.url.endsWith(':batchUpdate')).length, 2);
  } finally { await db.close(); }
});
test('verified removal of the last application clears its previously managed month', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const options = { db, env, fetchImpl: google.fetchImpl };
    await syncApplicationSheets({ ...options, now: now(), readReport: async () => report });
    // Seed a different current month destination; Google fake intentionally uses one ID per fixture.
    await db.query("INSERT INTO application_sheets_months(month,spreadsheet_id,fingerprint) VALUES ('2026-12','synthetic-december',NULL)");
    await syncApplicationSheets({ ...options, now: new Date('2026-12-01T15:00:00Z'), readReport: async () => ({ partial: false, applications: [] }) });
    const writes = google.calls.filter(call => call.url.endsWith(':batchUpdate') && call.url.includes('synthetic-file'));
    assert.equal(writes.length, 2);
    const rows = JSON.parse(writes.at(-1).body).requests.flatMap(request => request.updateCells?.rows ?? []);
    assert.equal(rows.some(row => row.values.some(cell => cell.userEnteredValue?.stringValue === '=Synthetic')), false);
  } finally { await db.close(); }
});
