import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../next.config.ts';
import { queueReadOrigin, queueAccessResponse, queueSessionHeaders } from '../lib/queue-host.mjs';
import { handleQueueRequest } from '../lib/phone-hud.mjs';

const canonical = 'https://crm.lgcyap.com';
const queue = 'https://queue.lgcyap.com';
const request = (url, origin = new URL(url).origin) => new Request(url, { method: 'POST', headers: { Origin: origin }, body: '{}' });

test('Queue reads allow each exact same origin and reject cross-origin or lookalike hosts', async () => {
  for (const [url, origin, want] of [
    [`${canonical}/api/queue`, canonical, 200], [`${queue}/api/queue`, queue, 200],
    [`${queue}/api/queue`, canonical, 403], [`${canonical}/api/queue`, queue, 403],
    ['https://queue.lgcyap.com.evil.invalid/api/queue', 'https://queue.lgcyap.com.evil.invalid', 403],
    ['https://other.lgcyap.com/api/queue', 'https://other.lgcyap.com', 403],
    ['http://queue.lgcyap.com/api/queue', 'http://queue.lgcyap.com', 403],
  ]) {
    const req = request(url, origin);
    const response = await handleQueueRequest(req, { getUser: async () => ({ email: 'synthetic@example.invalid' }), readBoard: async () => ({ ok: true }), allowedOrigin: queueReadOrigin(req, canonical) });
    assert.equal(response.status, want, `${url} from ${origin}`);
  }
  assert.equal(queueReadOrigin(request(`${queue}/api/queue`), 'https://preview.invalid'), 'https://preview.invalid');
});

test('only the Queue hostname root is rewritten before existing pages', async () => {
  const rules = await config.rewrites();
  assert.ok(!Array.isArray(rules));
  const rule = rules.beforeFiles.find(rule => rule.source === '/' && rule.destination === '/queue');
  assert.deepEqual(rule.has, [{ type: 'host', value: 'queue.lgcyap.com' }]);
  assert.ok(rules.afterFiles.some(rule => rule.source === '/api/google/callback' && rule.destination === '/api/v2/google/callback'));
  const redirects = await config.redirects();
  for (const path of ['/sign-in', '/sign-out']) {
    const rule = redirects.find(rule => rule.source === path);
    assert.deepEqual(rule.has, [{ type: 'host', value: 'queue.lgcyap.com' }]);
    assert.equal(rule.destination, path === '/sign-in' ? `${canonical}/queue-access` : `${canonical}/sign-out`);
  }
});

test('session handoff requires canonical host, approved verified session and unexpired signed cookie', async () => {
  const now = Date.now();
  const req = new Request(`${canonical}/queue-access?return_to=https://evil.invalid`, { headers: { Cookie: '__Secure-better-auth.session_token=synthetic.signed' } });
  const options = { baseURL: canonical, getSession: async () => ({ user: { email: 'synthetic@example.invalid' }, session: { token: 'synthetic', expiresAt: new Date(now + 60000) } }), authorize: session => session?.user?.email === 'synthetic@example.invalid', clock: () => now };
  const response = await queueAccessResponse(req, options);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), `${queue}/`);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Secure-lgcy-queue.session_token=synthetic.signed;/);
  assert.match(cookie, /Domain=lgcyap.com/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  for (const replacement of [null, { user: { email: 'unapproved@example.invalid' }, session: { token: 'synthetic', expiresAt: new Date(now + 60000) } }, { user: { email: 'synthetic@example.invalid' }, session: { token: 'synthetic', expiresAt: new Date(now - 1) } }]) {
    const denied = await queueAccessResponse(req, { ...options, getSession: async () => replacement });
    assert.equal(denied.headers.get('set-cookie'), null);
    assert.notEqual(denied.headers.get('location'), `${queue}/`);
  }
  const noCookie = await queueAccessResponse(new Request(`${canonical}/queue-access`), options);
  assert.equal(noCookie.headers.get('set-cookie'), null);
  const otherHost = await queueAccessResponse(new Request(`${queue}/queue-access`), options);
  assert.equal(otherHost.status, 404);
  const unavailable = await queueAccessResponse(req, { ...options, getSession: async () => { throw new Error('database unavailable'); } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('set-cookie'), null);
});

// A separate Queue cookie must never shadow canonical CRM login cookies.
test('Queue session adaptation is confined to the exact Queue host and cannot mask CRM login', () => {
  const cookies = '__Secure-lgcy-queue.session_token=old-queue.signed; __Secure-better-auth.session_token=new-crm.signed';
  const crmHeaders = new Headers({ Host: 'crm.lgcyap.com', Cookie: cookies });
  assert.equal(queueSessionHeaders(crmHeaders, canonical).get('cookie'), cookies);
  const queueHeaders = new Headers({ Host: 'queue.lgcyap.com', Cookie: cookies, Origin: queue });
  assert.equal(queueSessionHeaders(queueHeaders, canonical).get('cookie'), '__Secure-better-auth.session_token=old-queue.signed');
  assert.equal(queueSessionHeaders(queueHeaders, 'https://preview.invalid').get('cookie'), cookies);
});

test('handoff never copies a different cookie than the verified database session', async () => {
  const req = new Request(`${canonical}/queue-access`, { headers: { Cookie: '__Secure-better-auth.session_token=other.signed' } });
  const response = await queueAccessResponse(req, { baseURL: canonical, getSession: async () => ({ session: { token: 'verified-token', expiresAt: new Date(Date.now() + 60000) } }), authorize: () => true });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

// Embedding uses the same verified handoff, with a fixed Queue-only destination.
test('embedded handoff keeps the Queue embedded and offers top-level sign-in when expired', async () => {
  const request = new Request('https://crm.lgcyap.com/queue-access?embedded=1&return_to=https://evil.invalid', { headers: { Cookie: '__Secure-better-auth.session_token=synthetic.signed' } });
  const options = { baseURL: canonical, getSession: async () => ({ session: { token: 'synthetic', expiresAt: new Date(Date.now() + 60000) } }), authorize: () => true };
  const response = await queueAccessResponse(request, options);
  assert.equal(response.headers.get('location'), 'https://queue.lgcyap.com/?embedded=1');
  assert.match(response.headers.get('set-cookie'), /^__Secure-lgcy-queue.session_token=/);
  const expired = await queueAccessResponse(request, { ...options, getSession: async () => null });
  assert.equal(expired.status, 401);
  assert.equal(expired.headers.get('location'), null);
  assert.match(await expired.text(), /target="_top"/);
});
