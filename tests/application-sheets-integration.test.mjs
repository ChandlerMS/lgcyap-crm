import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sharingSchema } from '../db/application-sheets.mjs';
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', BETTER_AUTH_SECRET: 'synthetic-encryption-secret-more-than-32-characters', BETTER_AUTH_URL: 'https://crm.example.invalid', VERCEL_ENV: 'production', HUBSPOT_ACCESS_TOKEN: 'synthetic-hubspot' };
const user = { userId: 'owner-1', email: 'chandler@lgcyap.com' };
const now = () => new Date('2026-11-19T14:00:00Z');
const report = { partial: false, applications: [{ id: '1', at: '2026-11-19T13:00:00Z', name: '=Synthetic', sections: [], missed: [], flags: [] }] };
async function database() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../migrations/0015_application_sheets.sql', import.meta.url), 'utf8'));
  await db.exec(sharingSchema('application_sheets_months'));
  return db;
}
function provider({ email = user.email, failWrite = false, refuseShare = [] } = {}) {
  const calls = [], files = [], shares = [];
  const fetchImpl = async (url, init = {}) => {
    url = String(url); calls.push({ url, ...init });
    let body;
    if (url === 'https://oauth2.googleapis.com/token') body = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: 'openid email https://www.googleapis.com/auth/drive.file' };
    else if (url === 'https://openidconnect.googleapis.com/v1/userinfo') body = { email, email_verified: true };
    else if (url.includes('/permissions?')) { const share = JSON.parse(init.body); if (refuseShare.includes(share.emailAddress)) return Response.json({ error: { message: 'sensitive provider text' } }, { status: 403 }); shares.push({ url, ...share }); body = { id: `permission-${shares.length}` }; }
    else if (url.includes('/drive/v3/files?')) body = { files };
    else if (url === 'https://www.googleapis.com/drive/v3/files' && init.method === 'POST') { const file = { id: 'synthetic-file', ...JSON.parse(init.body) }; files.push(file); body = file; }
    else if (url.endsWith(':batchUpdate')) { if (failWrite) return Response.json({ error: { message: 'sensitive provider text' } }, { status: 403 }); body = {}; }
    else if (url.includes('/v4/spreadsheets/')) body = { sheets: [{ properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 1000, columnCount: 26 } } }] };
    else throw new Error('Unexpected synthetic URL: ' + url);
    return Response.json(body);
  };
  return { fetchImpl, calls, files, shares };
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
test('sync creates one monthly file, writes literal cells, and the next morning writes only new information', async () => {
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
    assert.equal(writes().length, 1, 'the morning run leaves an unchanged month alone');
    await syncApplicationSheets({ ...options, now: new Date('2026-11-21T14:00:00Z'), readReport: async () => ({ ...report, applications: [...report.applications, { ...report.applications[0], id: '2', at: '2026-11-20T15:00:00Z' }] }) });
    assert.equal(writes().length, 2, 'a new submission is written the next morning');
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
    assert.equal(connection.last_error, 'GOOGLE_SHEETS:GOOGLE_PERMISSION_REQUIRED');
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
test('scheduled runs happen once each morning from 9 am Eastern and retry only until one succeeds', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    let reads = 0;
    const options = { db, env, fetchImpl: google.fetchImpl, scheduled: true, readReport: async () => { reads++; return report; } };
    const at = (iso, extra = {}) => syncApplicationSheets({ ...options, now: new Date(iso), ...extra });
    assert.deepEqual(await at('2026-11-19T13:45:00Z'), { status: 'waiting', nextRun: 'today at 9 am Eastern' }, '8:45 am EST waits');
    assert.equal(reads, 0, 'a waiting call does not read HubSpot');
    await assert.rejects(at('2026-11-19T14:00:00Z', { fetchImpl: provider({ failWrite: true }).fetchImpl }));
    assert.equal((await at('2026-11-19T14:15:00Z')).status, 'synced', 'a failed morning run is retried at the next call');
    assert.deepEqual(await at('2026-11-19T14:30:00Z'), { status: 'waiting', nextRun: 'tomorrow at 9 am Eastern' });
    assert.deepEqual(await at('2026-11-19T22:00:00Z'), { status: 'waiting', nextRun: 'tomorrow at 9 am Eastern' });
    assert.equal(reads, 2);
    assert.equal((await at('2026-11-20T14:00:00Z')).status, 'synced', 'the next morning runs again');
    const { easternSyncTime } = await import('../lib/application-sheets-layout.mjs');
    assert.deepEqual([easternSyncTime(new Date('2027-06-01T12:59:00Z')).daily, easternSyncTime(new Date('2027-06-01T13:00:00Z')).daily], [false, true], '9 am EDT is 13:00 UTC in summer');
    assert.equal((await syncApplicationSheets({ ...options, scheduled: false, force: true, now: new Date('2026-11-20T20:00:00Z') })).status, 'synced', 'Sync now still runs at any time');
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
test('initiating report is encrypted into OAuth state and returned only after verified account consent', async () => {
  const { startSheetsConnection, finishSheetsConnection, unseal } = await import('../lib/application-sheets-oauth.mjs');
  const db = await database(), google = provider();
  try {
    const start = startSheetsConnection({ user, env, now: now(), report: 'sign-ins' });
    const cookie = start.cookie.split(';')[0];
    assert.equal(JSON.parse(unseal(cookie.slice(cookie.indexOf('=') + 1), env.BETTER_AUTH_SECRET)).report, 'sign-ins');
    const request = new Request(`https://crm.example.invalid/api/auth/callback/google?code=synthetic&state=${new URL(start.url).searchParams.get('state')}`, { headers: { cookie } });
    assert.equal((await finishSheetsConnection(request, { user, env, db, fetchImpl: google.fetchImpl, now: now() })).report, 'sign-ins');
  } finally { await db.close(); }
});
test('each new month is shared once with Sarah and Carlos as editors, with Google email notices', async () => {
  const { syncApplicationSheets, applicationSheetsStatus } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const options = { db, env, fetchImpl: google.fetchImpl, readReport: async () => report };
    const first = await syncApplicationSheets({ ...options, now: now() });
    assert.equal(first.shared, 2);
    assert.deepEqual(google.shares.map(share => [share.emailAddress, share.role, share.type]), [['sarah@lgcyap.com', 'writer', 'user'], ['carlos@fam1life.net', 'writer', 'user']]);
    assert.ok(google.shares.every(share => share.url.startsWith('https://www.googleapis.com/drive/v3/files/synthetic-file/permissions?') && new URL(share.url).searchParams.get('sendNotificationEmail') === 'true'));
    await syncApplicationSheets({ ...options, now: new Date('2026-11-19T14:01:00Z') });
    await syncApplicationSheets({ ...options, now: new Date('2026-11-20T14:00:00Z'), force: true });
    assert.equal(google.shares.length, 2, 'a completed share is never repeated');
    const status = await applicationSheetsStatus({ db, user, now: now() });
    assert.deepEqual(status.current.sharedWith, ['sarah@lgcyap.com', 'carlos@fam1life.net']);
    assert.deepEqual(status.current.sharePending, []);
    assert.equal(status.current.shareFailed, false);
  } finally { await db.close(); }
});
test('a refused share keeps the rows syncing and retries the next morning or on Sync now', async () => {
  const { syncApplicationSheets, applicationSheetsStatus } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), refused = provider({ refuseShare: ['carlos@fam1life.net'] });
  const permissionCalls = google => google.calls.filter(call => call.url.includes('/permissions?')).length;
  try {
    await connect(db, refused.fetchImpl);
    const options = { db, env, readReport: async () => report };
    const first = await syncApplicationSheets({ ...options, fetchImpl: refused.fetchImpl, now: now() });
    assert.equal(first.status, 'synced');
    assert.equal(first.shared, 1);
    const connection = (await db.query('SELECT last_error, last_success_at FROM application_sheets_connection')).rows[0];
    assert.equal(connection.last_error, null);
    assert.notEqual(connection.last_success_at, null);
    const status = await applicationSheetsStatus({ db, user, now: now() });
    assert.deepEqual(status.current.sharedWith, ['sarah@lgcyap.com']);
    assert.deepEqual(status.current.sharePending, ['carlos@fam1life.net']);
    assert.equal(status.current.shareFailed, true);
    assert.equal(JSON.stringify(status).includes('sensitive provider text'), false);
    await syncApplicationSheets({ ...options, fetchImpl: refused.fetchImpl, now: new Date('2026-11-19T20:00:00Z') });
    assert.equal(permissionCalls(refused), 2, 'no retry later the same day');
    const accepted = provider();
    await syncApplicationSheets({ ...options, fetchImpl: accepted.fetchImpl, now: new Date('2026-11-20T13:00:00Z') });
    assert.equal(permissionCalls(accepted), 0, 'no retry before 9 am Eastern');
    await syncApplicationSheets({ ...options, fetchImpl: accepted.fetchImpl, now: new Date('2026-11-20T14:05:00Z') });
    assert.deepEqual(accepted.shares.map(share => share.emailAddress), ['carlos@fam1life.net'], 'Sarah is not shared twice');
    const after = await applicationSheetsStatus({ db, user, now: now() });
    assert.deepEqual(after.current.sharePending, []);
    assert.equal(after.current.shareFailed, false);
    const forced = provider({ refuseShare: ['carlos@fam1life.net'] });
    await db.query("UPDATE application_sheets_months SET shared_with = '{sarah@lgcyap.com}', share_checked_day = '2026-11-20'");
    await syncApplicationSheets({ ...options, fetchImpl: forced.fetchImpl, now: new Date('2026-11-20T15:00:00Z'), force: true });
    assert.equal(permissionCalls(forced), 1, 'Sync now retries a pending share at once');
  } finally { await db.close(); }
});
test('a review decision or a recruit field edit rewrites the month on the next check', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    const base = { partial: false, applications: [{ ...report.applications[0], ticket: { id: '77', stage: 'Application', url: 'https://app.hubspot.com/synthetic' } }], reviews: {}, records: { 77: { properties: { orientation_office: 'orlando' } } } };
    let current = base;
    const options = { db, env, fetchImpl: google.fetchImpl, readReport: async () => current };
    const writes = () => google.calls.filter(call => call.url.endsWith(':batchUpdate'));
    const cells = () => JSON.parse(writes().at(-1).body).requests.flatMap(request => request.updateCells?.rows ?? []).flatMap(row => row.values.map(cell => cell.userEnteredValue?.stringValue));
    await syncApplicationSheets({ ...options, now: now() });
    assert.ok(cells().includes('Not reviewed') && cells().includes('Orlando'));
    current = { ...base, reviews: { 77: { status: 'approved', reviewedAt: '2026-11-19T14:00:30.000Z' } } };
    await syncApplicationSheets({ ...options, now: new Date('2026-11-19T14:01:00Z') });
    assert.equal(writes().length, 2);
    assert.ok(cells().includes('Approved'));
    current = { ...current, records: { 77: { properties: { orientation_office: 'miami' } } } };
    await syncApplicationSheets({ ...options, now: new Date('2026-11-19T14:02:00Z') });
    assert.equal(writes().length, 3);
    assert.ok(cells().includes('Miami') && !cells().includes('Orlando'));
  } finally { await db.close(); }
});

test('a HubSpot rate limit is retried within the run instead of failing the minute', async () => {
  const { syncApplicationSheets } = await import('../lib/application-sheets-sync.mjs');
  const db = await database(), google = provider();
  try {
    await connect(db, google.fetchImpl);
    let reads = 0;
    const limited = () => Object.assign(new Error('HubSpot is limiting requests.'), { code: 'HUBSPOT_RATE_LIMITED', retryAfterSeconds: 0.01 });
    const result = await syncApplicationSheets({ db, env, fetchImpl: google.fetchImpl, now: now(), readReport: async () => { reads++; if (reads === 1) throw limited(); return report; } });
    assert.equal(result.status, 'synced');
    assert.equal(reads, 2);
    reads = 0;
    await assert.rejects(syncApplicationSheets({ db, env, fetchImpl: google.fetchImpl, now: new Date('2026-11-19T14:05:00Z'), readReport: async () => { reads++; throw limited(); } }), /limiting/);
    assert.equal(reads, 3, 'two retries at most');
    assert.equal((await db.query('SELECT last_error FROM application_sheets_connection')).rows[0].last_error, 'HUBSPOT:HUBSPOT_RATE_LIMITED');
    reads = 0;
    await assert.rejects(syncApplicationSheets({ db, env, fetchImpl: google.fetchImpl, now: new Date('2026-11-19T14:06:00Z'), readReport: async () => { reads++; throw Object.assign(new Error('x'), { code: 'HUBSPOT_RESPONSE_INVALID' }); } }));
    assert.equal(reads, 1, 'other HubSpot failures are not retried');
  } finally { await db.close(); }
});
