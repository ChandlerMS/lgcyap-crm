import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { appHtml, database } from '../lib/generated/onboard-runtime.mjs';
import { mountOnboardHtml, onboardEnvironment, serveOnboard } from '../lib/onboard-host.mjs';

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
  assert.equal((await serveOnboard(request('state'), { env })).status, 401);
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
  } finally { await pg.close(); }
});
