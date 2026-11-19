import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../next.config.ts';
import { leaderboardAccessResponse, leaderboardReadOrigin, leaderboardReturnPath, leaderboardSessionHeaders } from '../lib/leaderboard-host.mjs';
import { queueSessionHeaders } from '../lib/queue-host.mjs';
import { handleLeaderboardRequest } from '../lib/leaderboard.mjs';

const canonical = 'https://crm.lgcyap.com';
const leaderboard = 'https://leaderboard.lgcyap.com';
const read = (url, origin = new URL(url).origin) => new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'sp', period: 'day' }) });

test('leaderboard reads allow each exact same origin and reject cross-origin or lookalike hosts', async () => {
  for (const [url, origin, want] of [
    [`${canonical}/api/leaderboard`, canonical, 200], [`${leaderboard}/api/leaderboard`, leaderboard, 200],
    [`${leaderboard}/api/leaderboard`, canonical, 403], [`${canonical}/api/leaderboard`, leaderboard, 403],
    ['https://leaderboard.lgcyap.com.evil.invalid/api/leaderboard', 'https://leaderboard.lgcyap.com.evil.invalid', 403],
    ['https://queue.lgcyap.com/api/leaderboard', 'https://queue.lgcyap.com', 403],
    ['http://leaderboard.lgcyap.com/api/leaderboard', 'http://leaderboard.lgcyap.com', 403],
  ]) {
    const request = read(url, origin);
    const response = await handleLeaderboardRequest(request, { getUser: async () => ({ email: 'synthetic@example.invalid' }), authorizeUser: () => true, readData: async () => ({ ok: true }), allowedOrigin: leaderboardReadOrigin(request, canonical) });
    assert.equal(response.status, want, `${url} from ${origin}`);
  }
  // Outside production the canonical origin is unchanged.
  assert.equal(leaderboardReadOrigin(read(`${leaderboard}/api/leaderboard`), 'https://preview.invalid'), 'https://preview.invalid');
});

test('only the Leaderboard hostname root opens the TV page, and its sign-in goes through the CRM', async () => {
  const rules = await config.rewrites();
  assert.ok(!Array.isArray(rules));
  const tv = rules.beforeFiles.find(rule => rule.destination === '/leaderboard-tv');
  assert.equal(tv.source, '/');
  assert.deepEqual(tv.has, [{ type: 'host', value: 'leaderboard.lgcyap.com' }]);
  // The Queue rewrite is untouched.
  assert.ok(rules.beforeFiles.some(rule => rule.source === '/' && rule.destination === '/queue' && rule.has?.[0]?.value === 'queue.lgcyap.com'));
  // leaderboard.lgcyap.com/standard and /shopper open their single-board pages.
  for (const board of ['standard', 'shopper']) {
    const rule = rules.beforeFiles.find(item => item.source === `/${board}` && item.has?.[0]?.value === "leaderboard.lgcyap.com");
    assert.equal(rule.destination, `/leaderboard-tv/${board}`);
    assert.deepEqual(rule.has, [{ type: 'host', value: 'leaderboard.lgcyap.com' }]);
  }
  const redirects = await config.redirects();
  const onLeaderboard = path => redirects.find(rule => rule.source === path && rule.has?.some(condition => condition.value === 'leaderboard.lgcyap.com'));
  assert.equal(onLeaderboard('/sign-in').destination, `${canonical}/leaderboard-access`);
  assert.equal(onLeaderboard('/sign-out').destination, `${canonical}/sign-out`);
  const headers = await config.headers();
  for (const path of ['/leaderboard-tv', '/leaderboard-access']) {
    assert.ok(headers.some(rule => rule.source === path && rule.headers.some(header => header.key === 'Cache-Control' && /no-store/.test(header.value))), `${path} is private`);
  }
});

test('handoff requires the CRM host, an approved verified session and an unexpired signed cookie', async () => {
  const now = Date.now();
  const request = new Request(`${canonical}/leaderboard-access?return_to=https://evil.invalid`, { headers: { Cookie: '__Secure-better-auth.session_token=synthetic.signed' } });
  const options = { baseURL: canonical, getSession: async () => ({ user: { email: 'synthetic@example.invalid' }, session: { token: 'synthetic', expiresAt: new Date(now + 24 * 3600e3) } }), authorize: session => session?.user?.email === 'synthetic@example.invalid', clock: () => now };
  const response = await leaderboardAccessResponse(request, options);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), `${leaderboard}/`);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Secure-lgcy-leaderboard.session_token=synthetic.signed;/);
  for (const part of ['Domain=lgcyap.com', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(part), part);
  // At most twelve hours, even when the CRM session lasts longer.
  assert.equal(Date.parse(/Expires=([^;]+)/.exec(cookie)[1]), Math.floor((now + 12 * 3600e3) / 1000) * 1000);
  assert.match(response.headers.get('cache-control'), /no-store/);
  for (const replacement of [null, { user: { email: 'unapproved@example.invalid' }, session: { token: 'synthetic', expiresAt: new Date(now + 60000) } }, { user: { email: 'synthetic@example.invalid' }, session: { token: 'synthetic', expiresAt: new Date(now - 1) } }, { user: { email: 'synthetic@example.invalid' }, session: { token: 'different', expiresAt: new Date(now + 60000) } }]) {
    const denied = await leaderboardAccessResponse(request, { ...options, getSession: async () => replacement });
    assert.equal(denied.headers.get('set-cookie'), null);
    assert.notEqual(denied.headers.get('location'), `${leaderboard}/`);
  }
  assert.equal((await leaderboardAccessResponse(new Request(`${canonical}/leaderboard-access`), options)).headers.get('set-cookie'), null);
  assert.equal((await leaderboardAccessResponse(new Request(`${leaderboard}/leaderboard-access`), options)).status, 404);
  assert.equal((await leaderboardAccessResponse(request, { ...options, baseURL: 'https://preview.invalid' })).status, 404);
  const unavailable = await leaderboardAccessResponse(request, { ...options, getSession: async () => { throw new Error('database unavailable'); } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('set-cookie'), null);
  const signedOut = await leaderboardAccessResponse(request, { ...options, getSession: async () => null });
  assert.equal(signedOut.headers.get('location'), `${canonical}/sign-in?return_to=%2Fleaderboard-access`);
});

test('after sign-in a TV returns to its own board page and options, never anywhere else', async () => {
  const access = returnTo => `${canonical}/leaderboard-access?return_to=${encodeURIComponent(returnTo)}`;
  for (const [returnTo, want] of [
    ['/leaderboard-tv/standard', '/standard'], ['/leaderboard-tv/shopper?periods=day,month&seconds=30', '/shopper?periods=day%2Cmonth&seconds=30'],
    ['/standard', '/standard'], ['/shopper/', '/shopper'], ['/leaderboard-tv?boards=sp', '/?boards=sp'], ['/', '/'],
    ['https://evil.invalid/standard', '/'], ['//evil.invalid/shopper', '/'], ['/leaderboard-tv/whatsapp', '/'], ['/queue', '/'],
    ['/standard?rows=<script>&utm=x', '/standard'], ['/api/leaderboard', '/'],
  ]) assert.equal(leaderboardReturnPath(access(returnTo)), want, returnTo);
  assert.equal(leaderboardReturnPath(`${canonical}/leaderboard-access`), '/');
  const options = { baseURL: canonical, getSession: async () => ({ session: { token: 'synthetic', expiresAt: new Date(Date.now() + 60000) } }), authorize: () => true };
  const signedIn = new Request(access('/leaderboard-tv/standard?periods=day,month'), { headers: { Cookie: '__Secure-better-auth.session_token=synthetic.signed' } });
  assert.equal((await leaderboardAccessResponse(signedIn, options)).headers.get('location'), `${leaderboard}/standard?periods=day%2Cmonth`);
  // Signing in on the CRM first keeps the board for the trip back.
  const signedOut = await leaderboardAccessResponse(new Request(access('/leaderboard-tv/shopper')), { ...options, getSession: async () => null });
  const next = new URL(signedOut.headers.get('location'));
  assert.equal(next.origin + next.pathname, `${canonical}/sign-in`);
  assert.equal(next.searchParams.get('return_to'), '/leaderboard-access?return_to=%2Fshopper');
  assert.equal(leaderboardReturnPath(`${canonical}${next.searchParams.get('return_to')}`), '/shopper');
});

test('Leaderboard session adaptation is confined to its exact host and never masks CRM or Queue sign-in', () => {
  const cookies = '__Secure-lgcy-leaderboard.session_token=tv.signed; __Secure-lgcy-queue.session_token=queue.signed; __Secure-better-auth.session_token=crm.signed';
  for (const host of ['crm.lgcyap.com', 'queue.lgcyap.com', 'leaderboard.lgcyap.com.evil.invalid']) {
    assert.equal(leaderboardSessionHeaders(new Headers({ Host: host, Cookie: cookies }), canonical).get('cookie'), cookies, host);
  }
  assert.equal(leaderboardSessionHeaders(new Headers({ Host: 'leaderboard.lgcyap.com', Cookie: cookies }), canonical).get('cookie'), '__Secure-better-auth.session_token=tv.signed');
  assert.equal(leaderboardSessionHeaders(new Headers({ Host: 'leaderboard.lgcyap.com', Cookie: cookies }), 'https://preview.invalid').get('cookie'), cookies);
  // Chained as in app-auth.ts: the Queue host still reads only its own cookie.
  const queue = leaderboardSessionHeaders(queueSessionHeaders(new Headers({ Host: 'queue.lgcyap.com', Cookie: cookies }), canonical), canonical);
  assert.equal(queue.get('cookie'), '__Secure-better-auth.session_token=queue.signed');
});
