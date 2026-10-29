import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecruitingData, normalizeRecruit, handleRecruitRequest, RecruitingError } from '../lib/hubspot.mjs';
import { RECRUIT_PROPERTIES, PIPELINE_ID, PORTAL_ID } from '../lib/recruiting-config.mjs';

const clock = () => Date.parse('2026-10-29T12:00:00Z');
const token = 'test-only-credential';
const fixture = (id = '101', changes = {}) => ({
  id, properties: {
    hs_pipeline: PIPELINE_ID, hs_pipeline_stage: '1416243212', recruit_name: 'Synthetic Example',
    orientation_office: 'orlando', intake_license_status: 'unlicensed', recruit_type: 'in-house_recruit',
    orientation_registered: 'true', orientation_checked_in: 'false',
    hs_v2_date_entered_current_stage: '2026-10-20T08:00:00Z',
    orientation_date: '2026-10-31', ...changes,
  },
});
const response = (results, total = results.length, next) => new Response(JSON.stringify({ results, total, ...(next === undefined ? {} : { paging: { next: { after: next, link: 'https://do-not-follow.invalid' } } }) }), { headers: { 'Content-Type': 'application/json' } });
const request = (body = '{}', headers = {}, method = 'POST') => new Request('https://private.example/api/recruits', {
  method, headers: { Origin: 'https://private.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body }),
});
const signedIn = () => ({ userId: 'synthetic-user' });

test('normalization keeps only allowlisted recruiting facts with truthful nullable flags', () => {
  const recruit = normalizeRecruit(fixture('101', { email: 'do-not-include@example.invalid', bank_account: 'do-not-include', appointments_created: '', unknown_field: 'do-not-include' }));
  assert.equal(recruit.office, 'Orlando');
  assert.equal(recruit.stage, 'Orientation');
  assert.equal(recruit.intake, 'Unlicensed');
  assert.deepEqual(recruit.flags, { orientationRegistered: true, orientationCheckedIn: false, licensingStarted: null, contractingRegistered: null, appointmentsCreated: null });
  assert.equal(recruit.orientationDate, '2026-10-31');
  assert.equal(recruit.enteredStageAt, '2026-10-20T08:00:00.000Z');
  assert.match(recruit.hubspotUrl, new RegExp(`/contacts/${PORTAL_ID}/record/0-5/101\\?utm_source=codex`));
  assert.doesNotMatch(JSON.stringify(recruit), /do-not-include|bank_account|unknown_field|email/);
});

test('missing facts are not fabricated and invalid calendar dates remain null', () => {
  const recruit = normalizeRecruit(fixture('102', { recruit_name: '', subject: 'Recruiting: Fallback Example', orientation_office: 'constructor', intake_license_status: '__proto__', hs_pipeline_stage: 'constructor', orientation_date: '2026-02-31', hs_v2_date_entered_current_stage: 'not a date' }));
  assert.equal(recruit.name, 'Fallback Example');
  assert.equal(recruit.office, 'Not recorded');
  assert.equal(recruit.intake, 'Not recorded');
  assert.equal(recruit.stage, 'Unknown stage');
  assert.equal(recruit.orientationDate, null);
  assert.equal(recruit.enteredStageAt, null);
});

test('rejects out-of-pipeline records and unsafe record identifiers', () => {
  assert.throws(() => normalizeRecruit(fixture('101', { hs_pipeline: '0' })), { code: 'HUBSPOT_RESPONSE_INVALID' });
  assert.throws(() => normalizeRecruit(fixture('../secret')), { code: 'HUBSPOT_RESPONSE_INVALID' });
});

test('every upstream page uses the fixed endpoint, pipeline and field allowlist; deduplicates IDs', async () => {
  const calls = [];
  const data = await readRecruitingData({ accessToken: token, now: clock, fetchImpl: async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return calls.length === 1 ? response([fixture('101'), fixture('102')], 3, '2') : response([fixture('102'), fixture('103')], 3);
  } });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.hubapi.com/crm/v3/objects/tickets/search');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(call.body.filterGroups, [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }] }]);
    assert.deepEqual(call.body.properties, [...RECRUIT_PROPERTIES]);
    assert.equal(call.body.limit, 100);
  }
  assert.equal(calls[1].body.after, '2');
  assert.equal(data.loadedCount, 3);
  assert.equal(data.total, 3);
  assert.equal(data.partial, false);
  assert.equal(data.portalId, PORTAL_ID);
  assert.equal(data.fetchedAt, '2026-10-29T12:00:00.000Z');
});

test('pagination is bounded at ten pages and exposes partial counts honestly', async () => {
  let calls = 0;
  const data = await readRecruitingData({ accessToken: token, now: clock, fetchImpl: async () => {
    const start = calls++ * 100 + 1;
    return response(Array.from({ length: 100 }, (_, i) => fixture(String(start + i))), 1200, String(calls * 100));
  } });
  assert.equal(calls, 10);
  assert.equal(data.loadedCount, 1000);
  assert.equal(data.total, 1200);
  assert.equal(data.partial, true);
});

test('uses the Workers-compatible manual redirect mode and refuses redirects without another request', async () => {
  let calls = 0;
  const data = await readRecruitingData({ accessToken: token, now: clock, fetchImpl: async (_url, options) => {
    if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode: error');
    assert.equal(options.redirect, 'manual');
    return response([fixture()]);
  } });
  assert.equal(data.loadedCount, 1);
  await assert.rejects(readRecruitingData({ accessToken: token, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 307, headers: { Location: 'https://do-not-follow.invalid' } });
  } }), { code: 'HUBSPOT_UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('truncated or malformed upstream pages cannot become a false complete result', async () => {
  const partial = await readRecruitingData({ accessToken: token, fetchImpl: async () => response([fixture()], 9) });
  assert.equal(partial.partial, true);
  await assert.rejects(readRecruitingData({ accessToken: token, fetchImpl: async () => response([fixture()], -1) }), { code: 'HUBSPOT_RESPONSE_INVALID' });
  await assert.rejects(readRecruitingData({ accessToken: token, fetchImpl: async () => new Response('invalid JSON') }), { code: 'HUBSPOT_RESPONSE_INVALID' });
  let count = 0;
  await assert.rejects(readRecruitingData({ accessToken: token, fetchImpl: async () => response([fixture(String(++count))], 9, '1') }), { code: 'HUBSPOT_RESPONSE_INVALID' });
});

test('missing credentials fail before any provider request', async () => {
  let calls = 0;
  await assert.rejects(readRecruitingData({ accessToken: '', fetchImpl: async () => { calls++; } }), { code: 'CONNECTION_NOT_CONFIGURED', status: 503 });
  assert.equal(calls, 0);
});

test('provider authorization, rate-limit and server failures are safe and never retried', async () => {
  for (const [status, code] of [[401, 'HUBSPOT_ACCESS_REQUIRED'], [403, 'HUBSPOT_ACCESS_REQUIRED'], [429, 'HUBSPOT_RATE_LIMITED'], [500, 'HUBSPOT_UNAVAILABLE']]) {
    let calls = 0;
    await assert.rejects(readRecruitingData({ accessToken: token, now: clock, fetchImpl: async () => {
      calls++; return new Response('secret-provider-error-body', { status, headers: { 'Retry-After': '120' } });
    } }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret-provider/);
      if (status === 429) assert.equal(error.retryAfterSeconds, 120);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('timeout cancels a hanging request once and produces a safe 504', async () => {
  let calls = 0;
  await assert.rejects(readRecruitingData({ accessToken: token, timeoutMs: 10, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('secret details')), { once: true }));
  } }), { code: 'HUBSPOT_TIMEOUT', status: 504 });
  assert.equal(calls, 1);
});

test('unauthenticated, cross-origin and non-POST requests cannot reach HubSpot', async () => {
  let calls = 0;
  const readData = async () => { calls++; return {}; };
  const anonymous = await handleRecruitRequest(request(), { getUser: () => null, readData });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).signInPath, '/signin-with-chatgpt?return_to=%2F');
  assert.equal((await handleRecruitRequest(request('{}', { Origin: 'https://untrusted.invalid' }), { getUser: signedIn, readData })).status, 403);
  assert.equal((await handleRecruitRequest(request(undefined, {}, 'GET'), { getUser: signedIn, readData })).status, 405);
  assert.equal(calls, 0);
});

test('rejects custom query authority, invalid JSON and oversized request bodies before a read', async () => {
  let calls = 0;
  const deps = { getUser: signedIn, readData: async () => { calls++; } };
  for (const body of ['{"pipeline":"0"}', '[]', 'null', 'invalid']) assert.equal((await handleRecruitRequest(request(body), deps)).status, 400);
  assert.equal((await handleRecruitRequest(request(' '.repeat(1025)), deps)).status, 413);
  assert.equal((await handleRecruitRequest(request('{}', { 'Content-Type': 'text/plain' }), deps)).status, 415);
  assert.equal(calls, 0);
});

test('successful and failed reads have no-store headers; unexpected exceptions are redacted', async () => {
  const success = await handleRecruitRequest(request(), { getUser: signedIn, readData: async () => ({ recruits: [], total: 0 }) });
  assert.equal(success.status, 200);
  assert.match(success.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(success.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(success.headers.get('X-Content-Type-Options'), 'nosniff');
  const failed = await handleRecruitRequest(request(), { getUser: signedIn, readData: async () => { throw Error('secret details'); } });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /secret details/);
  assert.match(failed.headers.get('Cache-Control'), /no-store/);
  const limited = await handleRecruitRequest(request(), { getUser: signedIn, readData: async () => { throw new RecruitingError('HUBSPOT_RATE_LIMITED', 'Wait before Refresh.', 429, 90); } });
  assert.equal(limited.headers.get('Retry-After'), '90');
  assert.equal((await limited.json()).retryAfterSeconds, 90);
});
