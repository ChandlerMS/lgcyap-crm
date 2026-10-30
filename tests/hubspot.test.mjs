import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecruitingData, normalizeRecruit, handleRecruitRequest as handleBoundary, RecruitingError } from '../lib/hubspot.mjs';
import { RECRUIT_PROPERTIES, PIPELINE_ID, PORTAL_ID } from '../lib/recruiting-config.mjs';

const handleRecruitRequest = (request, options) => handleBoundary(request, { allowedOrigin: 'https://private.example', ...options });

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
  assert.equal(recruit.stage, 'Orientation (legacy)');
  assert.equal(recruit.stageKey, '');
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

test('routing metadata uses only explicit canonical choices and never infers from intake or recruit type', () => {
  const selected = normalizeRecruit(fixture('103', { recruiting_path: 'mass_recruiting', licensing_branch: 'not_licensed', intake_license_status: 'already_licensed' }));
  assert.equal(selected.recruitingPath, 'mass_recruiting');
  assert.equal(selected.licenseRoute, 'not_licensed');
  for (const values of [{}, { recruiting_path: 'Mass Recruiting', licensing_branch: 'licensed_with_npn' }, { recruiting_path: 'constructor', licensing_branch: '__proto__' }]) {
    const legacy = normalizeRecruit(fixture('103', { intake_license_status: 'already_licensed', recruit_type: 'in-house_recruit', ...values }));
    assert.equal(legacy.recruitingPath, ''); assert.equal(legacy.licenseRoute, '');
  }
});

test('last contacted comes only from the verified ticket contact timestamp', () => {
  const recruit = normalizeRecruit(fixture('103', {
    hs_lastcontacted: '2026-10-28T18:23:00Z',
    hs_lastactivitydate: '2026-10-29T12:00:00Z',
    hs_lastmodifieddate: '2026-10-30T09:00:00Z',
  }));
  assert.equal(recruit.lastContactedAt, '2026-10-28T18:23:00.000Z');
  for (const value of [undefined, '', 'not-a-date', '2026-02-31']) {
    assert.equal(normalizeRecruit(fixture('103', { hs_lastcontacted: value, hs_lastactivitydate: '2026-10-29T12:00:00Z' })).lastContactedAt, null);
  }
  assert.ok(RECRUIT_PROPERTIES.includes('hs_lastcontacted'));
});

test('owner identifiers stay nullable and owner names are never inferred from other ticket fields', () => {
  const assigned = normalizeRecruit(fixture('103', { hubspot_owner_id: '901', recruit_type: 'in-house_recruit' }));
  assert.equal(assigned.ownerId, '901');
  assert.equal(assigned.recruiter, null);
  assert.equal(assigned.recruiterStatus, 'unavailable');
  for (const value of [undefined, '', 'constructor', '../901', '0']) {
    const recruit = normalizeRecruit(fixture('103', { hubspot_owner_id: value }));
    assert.equal(recruit.ownerId, null);
    assert.equal(recruit.recruiterStatus, 'unassigned');
  }
});

test('owner labels use fixed scoped requests, include archived owners, omit emails and reuse a short cache', async () => {
  const calls = [];
  let current = clock();
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/tickets/search')) return response([fixture('101', { hubspot_owner_id: '901' }), fixture('102', { hubspot_owner_id: '902' })]);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(JSON.stringify({ results: url.includes('archived=true')
      ? [{ id: '902', firstName: 'Former', lastName: 'Recruiter', email: 'private-owner@example.invalid', teams: [{ name: 'Do not expose' }] }]
      : [{ id: '901', firstName: 'Active', lastName: 'Recruiter', email: 'private-owner@example.invalid' }] }));
  };
  const first = await readRecruitingData({ accessToken: token, now: () => current, fetchImpl });
  assert.equal(first.recruits[0].recruiter, 'Active Recruiter');
  assert.equal(first.recruits[1].recruiter, 'Former Recruiter');
  assert.ok(first.recruits.every(row => row.recruiterStatus === 'available'));
  assert.equal(calls[1].url, 'https://api.hubapi.com/crm/v3/owners/?limit=100&archived=false');
  assert.equal(calls[2].url, 'https://api.hubapi.com/crm/v3/owners/?limit=100&archived=true');
  assert.doesNotMatch(JSON.stringify(first), /private-owner|Do not expose/);
  await readRecruitingData({ accessToken: token, now: () => current, fetchImpl });
  assert.equal(calls.length, 4);
  current += 300001;
  await readRecruitingData({ accessToken: token, now: () => current, fetchImpl });
  assert.equal(calls.length, 7);
  await readRecruitingData({ accessToken: 'other-synthetic-token', now: () => current, fetchImpl: async (url, options) => {
    if (url.endsWith('/tickets/search')) return response([fixture('101', { hubspot_owner_id: '901' })]);
    assert.equal(options.headers.Authorization, 'Bearer other-synthetic-token');
    return new Response(null, { status: 403 });
  } });
});

test('missing owner scope or failed owner reads preserve ticket availability without fabricated names', async () => {
  for (const status of [401, 403, 429, 500, 302]) {
    let ownerCalls = 0;
    const result = await readRecruitingData({ accessToken: token, now: clock, fetchImpl: async url => {
      if (url.endsWith('/tickets/search')) return response([fixture('101', { hubspot_owner_id: '901' })]);
      ownerCalls++;
      return new Response('secret-provider-detail', { status });
    } });
    assert.equal(result.loadedCount, 1);
    assert.equal(result.partial, false);
    assert.equal(result.recruits[0].recruiter, null);
    assert.equal(result.recruits[0].recruiterStatus, 'unavailable');
    assert.equal(ownerCalls, 1);
    assert.doesNotMatch(JSON.stringify(result), /secret-provider-detail/);
  }
});

test('owners pagination is bounded, follows only opaque cursors on fixed endpoint and exposes unresolved owners honestly', async () => {
  let ownerCalls = 0;
  const result = await readRecruitingData({ accessToken: token, now: clock, fetchImpl: async url => {
    if (url.endsWith('/tickets/search')) return response([fixture('101', { hubspot_owner_id: '999' })]);
    assert.ok(url.startsWith('https://api.hubapi.com/crm/v3/owners/?limit=100&archived=false'));
    ownerCalls++;
    return new Response(JSON.stringify({ results: [{ id: String(ownerCalls), firstName: 'Synthetic' }], paging: { next: { after: `cursor_${ownerCalls}`, link: 'https://attacker.invalid' } } }));
  } });
  assert.equal(ownerCalls, 5);
  assert.equal(result.recruits[0].recruiterStatus, 'unavailable');
  const complete = await readRecruitingData({ accessToken: token, now: clock, fetchImpl: async url => url.endsWith('/tickets/search')
    ? response([fixture('101', { hubspot_owner_id: '999' })]) : new Response(JSON.stringify({ results: [] })) });
  assert.equal(complete.recruits[0].recruiterStatus, 'not-found');
});

test('only bound stage IDs normalize to semantic flow keys', () => {
  assert.equal(normalizeRecruit(fixture('103', { hs_pipeline_stage: '1473318768' })).stageKey, 'hiring-event');
  assert.equal(normalizeRecruit(fixture('103', { hs_pipeline_stage: '1473318769' })).stageKey, 'application');
  assert.equal(normalizeRecruit(fixture('103', { hs_pipeline_stage: '1416243218' })).stageKey, 'completed');
  assert.equal(normalizeRecruit(fixture('103', { hs_pipeline_stage: '1473318773' })).stageKey, 'withdrawn');
  assert.equal(normalizeRecruit(fixture('103', { hs_pipeline_stage: '1416243212' })).stageKey, '');
  assert.equal(normalizeRecruit(fixture('103', { hs_pipeline_stage: 'unknown' })).stageKey, '');
});

test('editable values preserve separate name and ticket title and canonical blank, flag and date values', () => {
  const recruit = normalizeRecruit(fixture('104', { recruit_name: 'Example Person', subject: 'An independent ticket title', orientation_date: '1793404800000' }));
  assert.equal(recruit.editValues.recruit_name, 'Example Person');
  assert.equal(recruit.editValues.subject, 'An independent ticket title');
  assert.equal(recruit.editValues.orientation_registered, 'true');
  assert.equal(recruit.editValues.orientation_checked_in, 'false');
  assert.equal(recruit.editValues.licensing_started, '');
  assert.equal(recruit.editValues.orientation_date, '2026-10-31');
  assert.equal(Object.keys(recruit.editValues).length, 14);
});

test('a signed-in account outside the server allowlist cannot read recruiting data', async () => {
  let read = false;
  const result = await handleRecruitRequest(request(), { getUser: signedIn, authorizeUser: () => false, readData: async () => { read = true; } });
  assert.equal(result.status, 403);
  assert.equal(read, false);
  assert.equal((await result.json()).error.code, 'ACCESS_DENIED');
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

test('uses manual redirect mode and refuses redirects without another request', async () => {
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
  assert.equal((await anonymous.json()).signInPath, '/sign-in');
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

test('read origin is pinned to configured application URL rather than a caller-selected Host', async () => {
  let calls = 0;
  const deps = { getUser: signedIn, readData: async () => { calls++; } };
  const forged = new Request('https://attacker.invalid/api/recruits', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await handleRecruitRequest(forged, deps)).status, 403);
  assert.equal((await handleBoundary(request(), deps)).status, 403);
  assert.equal(calls, 0);
});
