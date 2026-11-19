import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { filterApplications, applicationWorkbook, exportGoogleSheet } from '../lib/applications-export.mjs';

const rows = [
  { id: '1', name: '=HYPERLINK("bad")', email: 'one@example.test', officeKey: 'orlando', phone: '+15551234567', flags: ['Discuss'], requirementsMet: false, sections: [{ title: 'Experience', rows: [{ label: 'Details', value: '<Five & six>' }] }], ticket: { id: '7', stage: 'Application', url: 'https://app.hubspot.com/record/7' } },
  { id: '2', name: 'Two', email: 'two@example.test', officeKey: 'tampa', requirementsMet: true, flags: [], sections: [] },
];
test('export filters the entire collection by the same query, office and status as Applications', () => {
  assert.deepEqual(filterApplications(rows, { query: 'ONE', office: 'orlando', status: 'not-met' }).map(row => row.id), ['1']);
  assert.deepEqual(filterApplications(rows, { query: '', office: 'all', status: 'flagged' }).map(row => row.id), ['1']);
  assert.equal(filterApplications(rows, { query: '', office: 'all', status: 'all' }).length, 2);
});
test('workbook preserves answers, phone formatting and review status as literal strings, never formulas', () => {
  const files = unzipSync(applicationWorkbook(rows, { '7': { status: 'approved' } }, true));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /Experience · Details/);
  assert.match(sheet, /&lt;Five &amp; six&gt;/);
  assert.match(sheet, /\+15551234567/);
  assert.match(sheet, /=HYPERLINK\(&quot;bad&quot;\)/);
  assert.match(sheet, /Approved/);
  assert.doesNotMatch(sheet, /<f[ >]/);
});
test('Drive export converts the workbook into a private native Google Sheet without a sharing request', async () => {
  const calls = [];
  const result = await exportGoogleSheet({ accessToken: 'synthetic', applications: rows, reviews: {}, reviewComplete: false, now: new Date('2026-11-19T15:00:00Z'), fetcher: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: 'synthetic_sheet_123', name: 'Applications' });
  } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/www.googleapis.com\/upload\/drive\/v3\/files\?/);
  assert.match(Buffer.from(calls[0].options.body).toString(), /application\/vnd.google-apps.spreadsheet/);
  assert.equal(result.url, 'https://docs.google.com/spreadsheets/d/synthetic_sheet_123/edit');
  assert.equal(result.count, 2);
});

import { startApplicationExport, finishApplicationExport, EXPORT_STATE_PREFIX } from '../lib/applications-export-oauth.mjs';
const env = { BETTER_AUTH_URL: 'https://crm.example.test', BETTER_AUTH_SECRET: 'synthetic-export-secret-at-least-32-chars', GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret' };
const user = { userId: 'u1', email: 'editor@example.test' };
const filters = { query: '', office: 'orlando', status: 'all' };
async function authorization() {
  const request = new Request(`${env.BETTER_AUTH_URL}/api/applications/export`, { method: 'POST', headers: { Origin: env.BETTER_AUTH_URL } });
  const response = await startApplicationExport(request, { user, env })(filters);
  const url = new URL((await response.json()).url);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { url, cookie, callback: new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?code=synthetic-code&state=${url.searchParams.get('state')}`, { headers: { Cookie: cookie } }) };
}
test('export consent uses only identity and app-created-file access with state, PKCE and a signed private cookie', async () => {
  const { url, cookie } = await authorization();
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.ok(url.searchParams.get('state').startsWith(EXPORT_STATE_PREFIX));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), `${env.BETTER_AUTH_URL}/api/auth/callback/google`);
  assert.equal(url.searchParams.get('scope'), 'openid email profile https://www.googleapis.com/auth/drive.file');
  assert.doesNotMatch(cookie, /synthetic-secret/);
  assert.throws(() => startApplicationExport(new Request(`${env.BETTER_AUTH_URL}/api/applications/export`, { method: 'POST', headers: { Origin: 'https://elsewhere.test' } }), { user, env }), /Open the CRM directly/);
  assert.throws(() => startApplicationExport(new Request(env.BETTER_AUTH_URL), { user: null, env }), /Sign in/);
});
test('callback verifies the destination Google account before reading applications, and exports all filtered rows', async () => {
  const { callback } = await authorization();
  const calls = [];
  let reads = 0;
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.ok(options.body.get('code_verifier'));
      return Response.json({ access_token: 'synthetic-token', scope: 'openid https://www.googleapis.com/auth/drive.file' });
    }
    if (url.endsWith('/userinfo')) return Response.json({ verified_email: true, email: user.email });
    return Response.json({ id: 'synthetic_sheet_123' });
  };
  const result = await finishApplicationExport(callback, { user, env, fetcher, readData: async () => { reads++; return { applications: rows, reviews: {}, reviewComplete: true, partial: false }; } });
  assert.equal(result.status, 200);
  assert.equal(reads, 1);
  const html = await result.text();
  assert.match(html, /"count":1/);
  assert.match(html, /synthetic_sheet_123/);
  assert.doesNotMatch(html, /synthetic-token|synthetic-secret|HYPERLINK/);
  assert.equal(calls.length, 3);
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
});
test('wrong Google identity, modified state, another CRM user and incomplete reads never create a Drive file', async () => {
  const { callback, cookie } = await authorization();
  let uploads = 0, reads = 0;
  const fetcher = async url => {
    if (url.includes('/token')) return Response.json({ access_token: 'synthetic', scope: 'https://www.googleapis.com/auth/drive.file' });
    if (url.endsWith('/userinfo')) return Response.json({ verified_email: true, email: 'different@example.test' });
    uploads++; return Response.json({ id: 'must_not_create' });
  };
  const readData = async () => { reads++; return { applications: rows, partial: true }; };
  assert.equal((await finishApplicationExport(callback, { user, env, fetcher, readData })).status, 403);
  assert.equal(reads, 0);
  assert.equal((await finishApplicationExport(new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?state=modified&code=x`, { headers: { Cookie: cookie } }), { user, env, fetcher, readData })).status, 400);
  assert.equal((await finishApplicationExport(callback, { user: { ...user, userId: 'another' }, env, fetcher, readData })).status, 400);
  const allowed = async (url, options) => url.endsWith('/userinfo') ? Response.json({ verified_email: true, email: user.email }) : fetcher(url, options);
  assert.equal((await finishApplicationExport(callback, { user, env, fetcher: allowed, readData })).status, 409);
  assert.equal(uploads, 0);
});

test('a real spreadsheet reader opens the export with all pages and literal applicant values intact', async () => {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const applications = Array.from({ length: 25 }, (_, index) => ({ ...rows[0], id: String(index + 1) }));
  const [{ data: workbook }] = await readXlsxFile(Buffer.from(applicationWorkbook(applications)));
  assert.equal(workbook.length, 26);
  assert.equal(workbook[1][3], '=HYPERLINK("bad")');
  assert.equal(workbook[1][6], '+15551234567');
});

test('expired or modified export cookies and denied consent perform no Google or HubSpot requests', async () => {
  const { callback, cookie } = await authorization();
  let calls = 0;
  const options = { user, env, fetcher: async () => { calls++; throw new Error('must not call'); }, readData: async () => { calls++; throw new Error('must not read'); } };
  assert.equal((await finishApplicationExport(callback, { ...options, now: Date.now() + 601000 })).status, 400);
  const tampered = new Request(callback.url, { headers: { Cookie: `${cookie.slice(0, -2)}xx` } });
  assert.equal((await finishApplicationExport(tampered, options)).status, 400);
  const denied = new URL(callback.url); denied.searchParams.set('error', 'access_denied');
  assert.equal((await finishApplicationExport(new Request(denied, { headers: { Cookie: cookie } }), options)).status, 400);
  assert.equal(calls, 0);
});
test('an uncertain Google write is not automatically retried', async () => {
  let calls = 0;
  await assert.rejects(() => exportGoogleSheet({ accessToken: 'synthetic', applications: rows, fetcher: async () => { calls++; throw new Error('network interruption'); } }), /Check your Drive/);
  assert.equal(calls, 1);
});

test('CSV includes every answer and review, quotes multiline fields and neutralizes formulas', async () => {
  const { applicationCsv } = await import('../lib/application-download.mjs');
  const csv = applicationCsv([{ ...rows[0], name: '=1+1', sections: [{ title: 'Answers', rows: [{ label: 'Notes', value: 'First, "quoted"\nSecond' }] }] }], { '7': { status: 'approved' } }, true);
  assert.ok(csv.startsWith('\uFEFF"Application ID"'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"First, ""quoted""\nSecond"'));
  assert.ok(csv.includes('"Approved"'));
  assert.ok(csv.includes('"\'+15551234567"'));
});
