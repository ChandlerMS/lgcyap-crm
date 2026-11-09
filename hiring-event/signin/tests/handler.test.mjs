import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { handleHealth, handleSubmit, signInMode } from '../lib/handler.mjs';
import { resetAccessCache } from '../lib/hubspot.mjs';
import { fakeHubSpot, signInRequest, validForm } from './helpers.mjs';

const LIVE = { VERCEL_ENV: 'production', HUBSPOT_ACCESS_TOKEN: 'test-token', SIGNIN_WRITES_ENABLED: 'true' };
let logs;
const originalLog = console.log;

beforeEach(() => {
  resetAccessCache();
  logs = [];
  console.log = (...args) => logs.push(args.join(' '));
});
afterEach(() => { console.log = originalLog; });

test('mode: dry run only outside Production; writes need both the token and the switch', () => {
  assert.equal(signInMode({ SIGNIN_DRY_RUN: '1', VERCEL_ENV: 'preview' }), 'dry-run');
  assert.equal(signInMode({ SIGNIN_DRY_RUN: '1' }), 'dry-run');
  assert.equal(signInMode({ SIGNIN_DRY_RUN: '1', VERCEL_ENV: 'production' }), 'not-configured');
  assert.equal(signInMode({ VERCEL_ENV: 'production', HUBSPOT_ACCESS_TOKEN: 't' }), 'closed');
  assert.equal(signInMode(LIVE), 'live');
});

test('a live sign-in writes to HubSpot and logs no personal details', async () => {
  const hub = fakeHubSpot();
  const response = await handleSubmit(signInRequest(validForm()), { env: LIVE, fetchImpl: hub.fetchImpl });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(hub.find('POST /crm/v3/objects/tickets').length, 1);
  const logged = logs.join('\n');
  assert.match(logged, /signin_recorded/);
  assert.doesNotMatch(logged, /Testy|McSample|example\.invalid|555|12345678|Pat Example/);
});

test('cross-origin and origin-less posts are refused before anything is read', async () => {
  const hub = fakeHubSpot();
  for (const origin of ['https://evil.invalid', null]) {
    const response = await handleSubmit(signInRequest(validForm(), { origin }), { env: LIVE, fetchImpl: hub.fetchImpl });
    assert.equal(response.status, 403);
  }
  assert.equal(hub.calls.length, 0);
});

test('non-multipart bodies and oversized bodies are refused', async () => {
  const json = new Request('https://lgcyap-signin.vercel.app/api/submit', {
    method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://lgcyap-signin.vercel.app', host: 'lgcyap-signin.vercel.app' },
  });
  assert.equal((await handleSubmit(json, { env: LIVE })).status, 415);

  const big = signInRequest(validForm());
  const headers = new Headers(big.headers);
  headers.set('content-length', '9000000');
  assert.equal((await handleSubmit(new Request(big, { headers }), { env: LIVE })).status, 413);
});

test('bot submissions look successful but write nothing', async () => {
  const hub = fakeHubSpot();
  const response = await handleSubmit(signInRequest(validForm({ website: 'spam' })), { env: LIVE, fetchImpl: hub.fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(hub.calls.length, 0);
});

test('invalid answers return field codes without echoing values', async () => {
  const response = await handleSubmit(signInRequest(validForm({ email: 'nope', phone: '1' })), { env: LIVE });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.deepEqual(body, { ok: false, code: 'INVALID', fields: { email: 'invalid', phone: 'invalid' } });
});

test('closed, unconfigured and dry-run deployments never call HubSpot', async () => {
  const hub = fakeHubSpot();
  const closed = await handleSubmit(signInRequest(validForm()), { env: { ...LIVE, SIGNIN_WRITES_ENABLED: 'false' }, fetchImpl: hub.fetchImpl });
  assert.deepEqual([closed.status, (await closed.json()).code], [503, 'CLOSED']);
  const missing = await handleSubmit(signInRequest(validForm()), { env: { VERCEL_ENV: 'production' }, fetchImpl: hub.fetchImpl });
  assert.deepEqual([missing.status, (await missing.json()).code], [503, 'NOT_CONFIGURED']);
  const dry = await handleSubmit(signInRequest(validForm()), { env: { SIGNIN_DRY_RUN: '1', VERCEL_ENV: 'preview' }, fetchImpl: hub.fetchImpl });
  assert.deepEqual(await dry.json(), { ok: true, dryRun: true });
  assert.equal(hub.calls.length, 0);
});

test('HubSpot failures return a safe code', async () => {
  const hub = fakeHubSpot({ 'POST /crm/v3/objects/tickets': () => [400, { message: 'Property values were not valid: Testy' }] });
  const response = await handleSubmit(signInRequest(validForm()), { env: LIVE, fetchImpl: hub.fetchImpl });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: 'HUBSPOT_REJECTED' });
  assert.doesNotMatch(logs.join('\n'), /Testy/);
});

test('an invalid property name for "how heard" is ignored', async () => {
  const hub = fakeHubSpot();
  await handleSubmit(signInRequest(validForm()), { env: { ...LIVE, HUBSPOT_HEARD_ABOUT_PROPERTY: 'bad name; drop' }, fetchImpl: hub.fetchImpl });
  const props = hub.find('POST /crm/v3/objects/tickets')[0].body.properties;
  assert.equal(Object.keys(props).some(k => k.includes(' ')), false);
});

test('health reports mode and token check without secrets', async () => {
  const hub = fakeHubSpot();
  let response = await handleHealth({ env: LIVE, fetchImpl: hub.fetchImpl });
  assert.deepEqual(await response.json(), { ok: true, mode: 'live', hubspot: 'verified' });
  resetAccessCache();
  const denied = fakeHubSpot({ 'POST /oauth/v2/private-apps/get/access-token-info': () => [401, { message: 'expired' }] });
  response = await handleHealth({ env: LIVE, fetchImpl: denied.fetchImpl });
  assert.deepEqual(await response.json(), { ok: false, mode: 'live', hubspot: 'access-needed' });
  response = await handleHealth({ env: { SIGNIN_DRY_RUN: '1' } });
  assert.deepEqual(await response.json(), { ok: false, mode: 'dry-run', hubspot: 'unchecked' });
});
