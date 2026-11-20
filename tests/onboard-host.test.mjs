import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { appHtml, database } from '../lib/generated/onboard-runtime.mjs';
import { ONBOARD_NO_ACCESS_ID } from '../lib/onboard-frame.mjs';
import { mountOnboardHtml, onboardEnvironment, onboardFailure, serveOnboard } from '../lib/onboard-host.mjs';

const origin = 'https://crm.example.invalid';
const user = { email: 'test-reviewer@example.invalid', displayName: 'Test Reviewer' };
function request(path, method = 'GET', body, headers = {}) {
  return new Request(origin + '/api/v2/' + path, { method, headers: { origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function fixture() {
  const pg = new PGlite();
  const queries = client => ({
    async query(sql, args) { const result = await client.query(sql, args); return { rows: result.rows, count: result.affectedRows ?? result.rows.length }; },
    async exec(sql) { await client.exec(sql); },
  });
  const db = database({ ...queries(pg), transaction: fn => pg.transaction(tx => fn(queries(tx))) });
  return { pg, env: onboardEnvironment({}, db) };
}

test('the compiled application uses the uploaded HTML verbatim; hosting keeps all styles and body layout', async () => {
  const source = await readFile(new URL('../vendor/lgcy-onboard/src/pages/app.html', import.meta.url), 'utf8');
  assert.equal(appHtml, source);
  const mounted = mountOnboardHtml(source);
  assert.deepEqual([...mounted.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]), [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]));
  assert.ok(mounted.includes("const API = '/api/v2';"));
  assert.ok(!mounted.includes('/api/v2/v2'));
  assert.ok(mounted.includes("window.top.location.assign('/sign-out')"));
  assert.ok(!mounted.includes('/api/recruits'));
  assert.ok(mounted.includes('src="/v2/brand/') || mounted.includes('href="/v2/brand/'));
});

// Runs the mounted page's real sign-in check against what /api/v2/me answered.
function startupCheck(me) {
  const statement = mountOnboardHtml().match(/if \(!me \|\| !me\.email\) \{[\s\S]*?return; \}/)[0];
  const redirects = [];
  const window = { top: { location: { replace: to => redirects.push(to) } } };
  const document = { body: { innerHTML: '<main id="main">sample data</main>' } };
  new Function('me', 'window', 'document', statement)(me, window, document);
  return { redirects, body: document.body.innerHTML };
}

test('only a real signed-out answer leaves Version 2 for the sign-in page', () => {
  const signedOut = startupCheck({ error: 'sign_in' });
  assert.deepEqual(signedOut.redirects, ['/sign-in?return_to=%2Fv2']);
  assert.match(signedOut.body, /sample data/);
});

test('a server or network failure during startup stays in the frame and removes the app', () => {
  for (const answer of [{ error: 'server', message: 'Version 2 is temporarily unavailable. Try again.' }, {}, null]) {
    const failed = startupCheck(answer);
    assert.deepEqual(failed.redirects, []);
    assert.doesNotMatch(failed.body, /sample data|id="main"/);
    assert.match(failed.body, /could not load/);
    // Replacing the body removes the source's stylesheets, so the notice needs its own colors.
    assert.match(failed.body, /background:#0b0b0a;color:#e3bf5e/);
    assert.ok(!failed.body.includes(ONBOARD_NO_ACCESS_ID));
  }
});

test('an inactive member sees a final no-access page instead of the sign-in page', () => {
  const inactive = startupCheck({ error: 'inactive' });
  assert.deepEqual(inactive.redirects, []);
  assert.ok(inactive.body.includes(`id="${ONBOARD_NO_ACCESS_ID}"`));
  assert.match(inactive.body, /access is turned off/);
  assert.match(inactive.body, /background:#0b0b0a;color:#e3bf5e/);
  assert.doesNotMatch(inactive.body, /sample data/);
});

test('a signed-in member is not interrupted by the startup check', () => {
  const allowed = startupCheck({ email: user.email });
  assert.deepEqual(allowed.redirects, []);
  assert.match(allowed.body, /sample data/);
});

test('host failures return the unavailable answer and log a diagnosis without sensitive values', async () => {
  const lines = [];
  const logged = (path, error) => {
    const response = onboardFailure(new Request(origin + path, { method: 'POST' }), error, line => lines.push(line));
    return { response, entry: JSON.parse(lines.at(-1)), raw: lines.at(-1) };
  };

  const database = logged('/api/v2/state?oauth=synthetic-query', Object.assign(new Error('Key (email)=(synthetic.person@example.invalid) already exists'), { name: 'error', code: '23505' }));
  assert.equal(database.response.status, 503);
  assert.deepEqual(await database.response.json(), { error: 'server', message: 'Version 2 is temporarily unavailable. Try again.' });
  assert.match(database.response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(database.entry, { event: 'onboard_host_failed', method: 'POST', path: '/api/v2/state', name: 'error', code: '23505' });
  assert.doesNotMatch(database.raw, /synthetic/);

  const application = logged('/v2/apply/synthetic-application-token', new Error('Could not provision Version 2 access'));
  assert.deepEqual(application.entry, { event: 'onboard_host_failed', method: 'POST', path: '/v2/apply', name: 'Error', message: 'Could not provision Version 2 access' });
  assert.doesNotMatch(application.raw, /synthetic/);

  const unreadable = logged('/api/v2/state', new SyntaxError('Unexpected token, "synthetic candidate" is not valid JSON'));
  assert.deepEqual(unreadable.entry, { event: 'onboard_host_failed', method: 'POST', path: '/api/v2/state', name: 'SyntaxError' });
  assert.doesNotMatch(unreadable.raw, /synthetic/);

  assert.equal(logged('/api/v2/me', undefined).entry.name, 'undefined');
});

test('V2 integrations do not inherit V1 credentials', () => {
  const env = onboardEnvironment({ HUBSPOT_ACCESS_TOKEN: 'synthetic-hubspot', GOOGLE_CLIENT_ID: 'synthetic-login', GOOGLE_CLIENT_SECRET: 'synthetic-secret', GOOGLE_TEAM_REFRESH_TOKEN: 'synthetic-mail', ONBOARD_GOOGLE_CLIENT_ID: 'explicit-v2' }, {});
  assert.equal(env.HUBSPOT_ACCESS_TOKEN, undefined);
  assert.equal(env.GOOGLE_CLIENT_ID, 'explicit-v2');
  assert.equal(env.GOOGLE_CLIENT_SECRET, '');
  assert.equal(env.GOOGLE_TEAM_REFRESH_TOKEN, '');
  assert.equal(env.DEV_LOGIN_CODES, '0');
});

test('anonymous private API and cross-origin writes fail before accessing storage', async () => {
  const env = onboardEnvironment({}, { prepare() { throw new Error('Storage must not be accessed'); } });
  const anonymous = await serveOnboard(request('state'), { env });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, 'sign_in');
  assert.equal((await serveOnboard(request('state', 'PUT', {}, { origin: 'https://other.invalid' }), { env, user })).status, 403);
  assert.equal((await serveOnboard(request('login/start', 'POST', {}), { env, user })).status, 404);
  assert.equal((await serveOnboard(request('cron'), { env, user })).status, 404);
});

test('shared sign-in provisions a basic user, independent state persists, stale writes conflict, and internal sessions are removed', async () => {
  const { pg, env } = await fixture();
  try {
    const me = await serveOnboard(request('me'), { env, user });
    const identity = await me.json();
    assert.equal(identity.email, user.email);
    assert.deepEqual(identity.user.access, ['recruiter']);
    assert.equal(identity.user.owner, undefined);
    assert.equal(me.headers.get('set-cookie'), null);
    const initial = await (await serveOnboard(request('state'), { env, user })).json();
    assert.deepEqual(initial.state.cands, []);
    const state = { ...initial.state, cands: [{ id: 1, first: 'Synthetic', last: 'Recruit', stage: 'applied', recruiter: user.displayName, notes: [] }] };
    const save = await serveOnboard(request('state', 'PUT', state, { 'if-match': String(initial.version) }), { env, user });
    assert.equal(save.status, 200);
    const stale = await serveOnboard(request('state', 'PUT', initial.state, { 'if-match': String(initial.version) }), { env, user });
    assert.equal(stale.status, 409);
    const saved = await (await serveOnboard(request('state'), { env, user })).json();
    assert.equal(saved.state.cands[0].first, 'Synthetic');
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS n FROM onboard.sessions')).rows[0].n, 0);
    assert.equal((await pg.query("SELECT to_regclass('public.recruit_write_ledger') AS table")).rows[0].table, null);
  } finally { await pg.close(); }
});

test('original source members retain their roles; inactive members remain denied', async () => {
  const { pg, env } = await fixture();
  try {
    const owner = { email: 'carlos@lgcyap.com', displayName: 'Source Owner' };
    const me = await (await serveOnboard(request('me'), { env, user: owner })).json();
    assert.equal(me.user.owner, true);
    await serveOnboard(request('me'), { env, user });
    await pg.query('UPDATE onboard.members SET data = $1 WHERE email = $2', [JSON.stringify({ name: user.displayName, email: user.email, status: 'inactive', access: ['recruiter'] }), user.email]);
    assert.equal((await serveOnboard(request('state'), { env, user })).status, 403);
    const denied = await serveOnboard(request('me'), { env, user });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'inactive');
  } finally { await pg.close(); }
});
