import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMode, handleHealth, handleSubmit } from '../lib/handler.mjs';
import { resetAccessCache } from '../lib/hubspot.mjs';
import { applicationForm, baseAnswers } from './fixtures.mjs';
import { fakeHubSpot } from './fake-hubspot.mjs';

const LIVE = { HUBSPOT_ACCESS_TOKEN: 'test-token', APPLY_WRITES_ENABLED: 'true', VERCEL_ENV: 'production' };

function request(form, { origin = 'https://lgcyap-apply.vercel.app', host = 'lgcyap-apply.vercel.app' } = {}) {
  const headers = { host };
  if (origin) headers.origin = origin;
  return new Request('https://lgcyap-apply.vercel.app/api/submit', { method: 'POST', body: form, headers });
}

test('mode: dry run only outside Production, and writes need the switch', () => {
  assert.equal(applyMode({ APPLY_DRY_RUN: '1' }), 'dry-run');
  assert.equal(applyMode({ APPLY_DRY_RUN: '1', VERCEL_ENV: 'production' }), 'not-configured');
  assert.equal(applyMode({ HUBSPOT_ACCESS_TOKEN: 'x' }), 'closed');
  assert.equal(applyMode(LIVE), 'live');
});

test('cross-site posts are refused', async () => {
  const res = await handleSubmit(request(applicationForm(), { origin: 'https://evil.example' }), { env: LIVE });
  assert.equal(res.status, 403);
  const none = await handleSubmit(request(applicationForm(), { origin: null }), { env: LIVE });
  assert.equal(none.status, 403);
});

test('invalid answers return 422 with question IDs and no echoed values', async () => {
  const res = await handleSubmit(request(applicationForm({ answers: baseAnswers({ email: 'nope' }) })), { env: LIVE });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.deepEqual(body, { ok: false, code: 'INVALID', fields: { email: 'invalid' } });
});

test('bot submissions look accepted but write nothing', async () => {
  const hub = fakeHubSpot();
  const res = await handleSubmit(request(applicationForm({ website: 'x' })), { env: LIVE, fetchImpl: hub.fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(hub.state.calls.length, 0);
});

test('dry run evaluates without HubSpot', async () => {
  const res = await handleSubmit(request(applicationForm({ answers: baseAnswers({ workAuth: 'no' }) })), { env: { APPLY_DRY_RUN: '1' } });
  const body = await res.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.pass, false);
  assert.deepEqual(body.failed, ['authorization to work in the United States']);
});

test('not configured or switched off returns 503 and writes nothing', async () => {
  assert.equal((await handleSubmit(request(applicationForm()), { env: {} })).status, 503);
  const hub = fakeHubSpot();
  const res = await handleSubmit(request(applicationForm()), { env: { HUBSPOT_ACCESS_TOKEN: 'x' }, fetchImpl: hub.fetchImpl });
  assert.equal((await res.json()).code, 'CLOSED');
  assert.equal(hub.state.calls.length, 0);
});

test('live: records the application and reports pass', async () => {
  resetAccessCache();
  const hub = fakeHubSpot();
  const logs = [];
  const original = console.log;
  console.log = line => logs.push(line);
  try {
    const res = await handleSubmit(request(applicationForm()), { env: LIVE, fetchImpl: hub.fetchImpl });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, pass: true, failed: [] });
  } finally { console.log = original; }
  assert.equal(hub.state.tickets.length, 1);
  assert.ok(logs.every(line => !/Testy|example\.com|4075550142/i.test(line)), 'logs hold no applicant details');
});

test('health reports mode and HubSpot access without secrets', async () => {
  resetAccessCache();
  const hub = fakeHubSpot();
  const ok = await (await handleHealth({ env: LIVE, fetchImpl: hub.fetchImpl })).json();
  assert.deepEqual(ok, { ok: true, mode: 'live', hubspot: 'ok', via: 'token_info' });
  const fallback = await (await handleHealth({ env: LIVE, fetchImpl: fakeHubSpot({ tokenInfoStatus: 404 }).fetchImpl })).json();
  assert.deepEqual(fallback, { ok: true, mode: 'live', hubspot: 'ok', via: 'recruiting_pipeline' });
  const rejected = await (await handleHealth({ env: LIVE, fetchImpl: fakeHubSpot({ tokenInfoStatus: 400, pipelineStatus: 401 }).fetchImpl })).json();
  assert.deepEqual(rejected, { ok: false, mode: 'live', hubspot: 'access_problem', step: 'access_pipeline', status: 401, tokenInfoStatus: 400, savedValue: 'not_a_hubspot_key' });
  const shaped = { ...LIVE, HUBSPOT_ACCESS_TOKEN: `  pat-na1-${'a1b2c3d4-'.repeat(4)}e5f6\n` };
  const keyLike = await (await handleHealth({ env: shaped, fetchImpl: fakeHubSpot({ tokenInfoStatus: 400, pipelineStatus: 401 }).fetchImpl })).json();
  assert.equal(keyLike.savedValue, 'hubspot_key', 'surrounding spaces and line breaks are ignored');
  assert.ok(!JSON.stringify(keyLike).includes('a1b2c3d4'), 'the value itself is never returned');
  const bad = await (await handleHealth({ env: LIVE, fetchImpl: fakeHubSpot({ hubId: 1 }).fetchImpl })).json();
  assert.deepEqual(bad, { ok: false, mode: 'live', hubspot: 'access_problem', step: 'access', status: null, savedValue: 'not_a_hubspot_key' });
  const denied = await (await handleHealth({ env: LIVE, fetchImpl: fakeHubSpot({ tokenInfoStatus: 401 }).fetchImpl })).json();
  assert.deepEqual(denied, { ok: false, mode: 'live', hubspot: 'access_problem', step: 'access', status: 401, savedValue: 'not_a_hubspot_key' });
  const off = await (await handleHealth({ env: {} })).json();
  assert.deepEqual(off, { ok: false, mode: 'not-configured', hubspot: 'not_checked' });
});
