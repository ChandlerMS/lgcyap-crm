import test from 'node:test';
import assert from 'node:assert/strict';
import { startApplicationExport, finishApplicationExport, exportFilters } from '../lib/attendance-export-oauth.mjs';
const env = { BETTER_AUTH_URL: 'https://crm.example.test', BETTER_AUTH_SECRET: 'synthetic-secret-32-characters-long', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' };
const user = { userId: 'test', email: 'test@example.test' };
async function callback() {
  const response = await startApplicationExport(new Request(`${env.BETTER_AUTH_URL}/api/event-attendance/export`, { headers: { Origin: env.BETTER_AUTH_URL } }), { user, env })({ startDate: '2026-11-12', endDate: '2026-11-12' });
  const url = new URL((await response.json()).url);
  assert.equal(url.searchParams.get('access_type'), 'online');
  return new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?code=test&state=${url.searchParams.get('state')}`, { headers: { Cookie: response.headers.get('set-cookie').split(';')[0] } });
}
test('manual signed-in export includes people whose intermediate visit matches the date and creates a native Sheet', async () => {
  let uploaded = false;
  const response = await finishApplicationExport(await callback(), { user, env, readData: async () => ({ partial: false, attendees: [{ ticketId: '1', name: 'Included', firstDay: '2026-11-10', lastDay: '2026-11-19', signIns: 3 }, { ticketId: '2', name: 'Excluded' }], visits: [{ ticketId: '1', day: '2026-11-12' }] }), fetcher: async (url, options) => {
    if (url.includes('/token')) return Response.json({ access_token: 'test-token', scope: 'https://www.googleapis.com/auth/drive.file' });
    if (url.includes('/userinfo')) return Response.json({ verified_email: true, email: user.email });
    assert.match(options.body.toString(), /Signed In recruits/);
    assert.match(options.body.toString(), /application\/vnd.google-apps.spreadsheet/);
    uploaded = true; return Response.json({ id: 'test_sheet_123' });
  } });
  assert.equal(response.status, 200); assert.ok(uploaded); assert.match(await response.text(), /"count":1/);
});
test('wrong Google account cannot read attendees or create a file', async () => {
  const response = await finishApplicationExport(await callback(), { user, env, readData: () => { throw new Error('Must not read'); }, fetcher: async url => url.includes('/token') ? Response.json({ access_token: 'test', scope: 'https://www.googleapis.com/auth/drive.file' }) : Response.json({ verified_email: true, email: 'other@example.test' }) });
  assert.equal(response.status, 403);
});
test('invalid sign-in date filters are rejected', () => {
  for (const startDate of ['invalid', '2026-02-30', '2026-99-99']) assert.throws(() => exportFilters({ startDate }), /valid sign-in dates/);
});

test('retired updater has no schedule and its public entry points return gone', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.ok(!config.crons.some(job => job.path === '/api/cron/sign-in-sheets'));
  assert.ok(config.crons.some(job => job.path === '/api/cron/application-sheets'));
  for (const path of ['app/api/cron/sign-in-sheets/route.ts', 'app/api/event-attendance/sheets/notify/route.ts', 'app/api/event-attendance/sheets/route.ts']) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /status: 410/); assert.doesNotMatch(source, /syncSignInSheets/);
  }
});
