import test from 'node:test';
import assert from 'node:assert/strict';
const env = { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', BETTER_AUTH_SECRET: 'synthetic-secret-over-thirty-two-characters', BETTER_AUTH_URL: 'https://crm.example.invalid', RECRUITING_EDITOR_EMAILS: 'chandler@lgcyap.com,editor@example.invalid', VERCEL_ENV: 'production', CRON_SECRET: 'synthetic-cron-secret-more-than-32-characters', APPLICATION_SHEETS_NOTIFY_SECRET: 'synthetic-notification-secret-more-than-32-characters' };
const owner = { userId: 'owner', email: 'chandler@lgcyap.com' };
const request = (action = 'connect', origin = env.BETTER_AUTH_URL) => new Request(`${env.BETTER_AUTH_URL}/api/applications/sheets`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
test('blocks signed-out users, non-owner writes and cross-origin writes before database access', async () => {
  const { handleApplicationSheets } = await import('../lib/application-sheets-handlers.mjs');
  const getDb = () => { throw new Error('Must not access the database'); };
  assert.equal((await handleApplicationSheets(request(), { env, getUser: async () => null, getDb })).status, 401);
  assert.equal((await handleApplicationSheets(request(), { env, getUser: async () => ({ userId: 'editor', email: 'editor@example.invalid' }), getDb })).status, 403);
  assert.equal((await handleApplicationSheets(request('connect', 'https://other.example.invalid'), { env, getUser: async () => owner, getDb })).status, 403);
  assert.equal((await handleApplicationSheets(request('unknown'), { env, getUser: async () => owner, getDb })).status, 400);
});
test('connect returns a private PKCE authorization URL without tokens or touching the database', async () => {
  const { handleApplicationSheets } = await import('../lib/application-sheets-handlers.mjs');
  const response = await handleApplicationSheets(request(), { env, getUser: async () => owner, getDb: () => { throw new Error('Not needed'); } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(new URL(body.url).searchParams.get('redirect_uri'), `${env.BETTER_AUTH_URL}/api/auth/callback/google`);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(body.refresh_token, undefined);
});
test('cron and notification authorization fail closed and do not initialize the database', async () => {
  const { handleApplicationSheetsJob } = await import('../lib/application-sheets-handlers.mjs');
  const getDb = () => { throw new Error('Not authorized'); };
  const url = `${env.BETTER_AUTH_URL}/api/cron/application-sheets`;
  assert.equal((await handleApplicationSheetsJob(new Request(url), { env, getDb })).status, 401);
  const valid = new Request(url, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  const result = await handleApplicationSheetsJob(valid, { env, getDb: async () => ({}), sync: async () => ({ status: 'synced' }) });
  assert.equal((await result.json()).status, 'synced');
  const notify = new Request(`${env.BETTER_AUTH_URL}/api/applications/sheets/notify`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  assert.equal((await handleApplicationSheetsJob(notify, { env, getDb, notification: true })).status, 401);
  const failure = await handleApplicationSheetsJob(valid, { env, getDb: async () => ({}), sync: async () => { throw new Error('secret-provider-body'); } });
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes('secret-provider-body'), false);
});
test('connection status is owner-only and non-owner reads do not initialize the database', async () => {
  const { handleApplicationSheets } = await import('../lib/application-sheets-handlers.mjs');
  const response = await handleApplicationSheets(new Request(`${env.BETTER_AUTH_URL}/api/applications/sheets`), { env, getUser: async () => ({ userId: 'editor', email: 'editor@example.invalid' }), getDb: () => { throw new Error('No access'); } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { visible: false });
});
test('retired Sign-Ins consent returns to Event Attendance without scheduling an updater', async () => {
  const { handleApplicationSheetsCallback } = await import('../lib/application-sheets-handlers.mjs');
  let applications = 0, signIns = 0; const pending = [];
  const response = await handleApplicationSheetsCallback(new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?state=application-sheets.synthetic&code=synthetic`), {
    env, getUser: async () => owner, getDb: async () => ({}), getSignInDb: async () => ({}), finish: async () => ({ report: 'sign-ins' }),
    sync: async () => { applications++; }, syncSignIns: async () => { signIns++; }, defer: promise => pending.push(promise),
  });
  await Promise.all(pending);
  assert.equal(new URL(response.headers.get('location')).hash, '#event-attendance');
  assert.equal(applications, 0);
  assert.equal(signIns, 0);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('application_sheets'), 'error');
});
