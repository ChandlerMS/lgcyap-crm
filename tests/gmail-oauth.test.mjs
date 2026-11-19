import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const env = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', BETTER_AUTH_SECRET: 'synthetic-gmail-secret-at-least-thirty-two-characters', BETTER_AUTH_URL: 'https://crm.example.invalid', VERCEL: '1', VERCEL_ENV: 'production', RECRUITING_EDITOR_EMAILS: 'editor@example.invalid,other@example.invalid' };
const user = { userId: 'editor-1', email: 'editor@example.invalid' };
const now = new Date('2026-11-19T14:00:00Z');
const scope = 'openid email https://www.googleapis.com/auth/gmail.compose';

async function database() {
  const db = new PGlite();
  const { GMAIL_SCHEMA } = await import('../db/gmail.mjs');
  assert.equal(typeof GMAIL_SCHEMA, 'string', 'Runtime Gmail schema must be bundled as executable SQL');
  await db.exec(GMAIL_SCHEMA);
  await db.exec('CREATE TABLE "account" (id text PRIMARY KEY, "userId" text, "providerId" text, "accountId" text);');
  await db.exec(await readFile(new URL('../migrations/0017_gmail_drafts.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO "account" VALUES ($1,$2,$3,$4)', ['account-1', user.userId, 'google', 'google-sub-1']);
  return db;
}
function provider({ profile = {}, token = {}, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (status !== 200) return Response.json({ error: 'sensitive-provider-body' }, { status });
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', scope, ...token });
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: 'google-sub-1', email: user.email, email_verified: true, ...profile });
    throw new Error('Unexpected external request');
  };
  return { fetchImpl, calls };
}
async function connectionRequest(options = {}) {
  const { startGmailConnection } = await import('../lib/gmail-oauth.mjs');
  const start = startGmailConnection({ user, env, now, ...options });
  const state = new URL(start.url).searchParams.get('state');
  return { start, request: new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?code=synthetic-code&state=${state}`, { headers: { Cookie: start.cookie.split(';')[0] } }) };
}

test('Gmail consent is separate, minimal, offline and PKCE-protected; saved credentials are encrypted for this employee', async () => {
  const { finishGmailConnection, GMAIL_STATE_PREFIX } = await import('../lib/gmail-oauth.mjs');
  const db = await database(), google = provider();
  try {
    const { start, request } = await connectionRequest();
    const url = new URL(start.url);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('scope'), scope);
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
    assert.equal(url.searchParams.get('login_hint'), user.email);
    assert.equal(url.searchParams.get('redirect_uri'), `${env.BETTER_AUTH_URL}/api/auth/callback/google`);
    assert.ok(url.searchParams.get('state').startsWith(GMAIL_STATE_PREFIX));
    assert.match(start.cookie, /^gmail_oauth=/);
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=600', 'Path=/api']) assert.ok(start.cookie.includes(flag));
    await finishGmailConnection(request, { user, env, db, fetchImpl: google.fetchImpl, now });
    const exchanged = google.calls[0].init.body;
    assert.equal(exchanged.get('grant_type'), 'authorization_code');
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(exchanged.get('code_verifier')).digest('base64url'));
    const row = (await db.query('SELECT * FROM gmail_connection')).rows[0];
    assert.equal(row.user_id, user.userId);
    assert.equal(row.email, user.email);
    assert.equal(row.google_sub, 'google-sub-1');
    assert.equal(row.scope, scope);
    assert.notEqual(row.refresh_token, 'synthetic-refresh');
    assert.equal(JSON.stringify(row).includes('synthetic-access'), false);
  } finally { await db.close(); }
});

test('callback rejects missing, tampered, expired and mismatched browser/employee state before contacting Google', async () => {
  const { finishGmailConnection } = await import('../lib/gmail-oauth.mjs');
  const { start, request } = await connectionRequest();
  const cookie = start.cookie.split(';')[0];
  let providerCalls = 0, databaseCalls = 0;
  const options = { user, env, db: { query: () => { databaseCalls++; throw new Error('Must not access database'); } }, fetchImpl: () => { providerCalls++; throw new Error('Must not contact Google'); }, now };
  const invalid = [
    [new Request(request.url), {}],
    [new Request(request.url.replace(/state=[^&]+/, 'state=gmail.wrong'), { headers: { Cookie: cookie } }), {}],
    [new Request(request.url, { headers: { Cookie: cookie.slice(0, -5) + 'xxxxx' } }), {}],
    [request, { now: new Date(now.getTime() + 600001) }],
    [request, { now: new Date(now.getTime() - 1) }],
    [request, { user: { ...user, userId: 'other-user' } }],
    [request, { user: { ...user, email: 'other@example.invalid' } }],
    [new Request(request.url.replace('crm.example.invalid', 'evil.example.invalid'), { headers: { Cookie: cookie } }), {}],
    [request, { env: { ...env, VERCEL_ENV: 'preview' } }],
    [request, { env: { ...env, VERCEL: undefined } }],
  ];
  for (const [input, overrides] of invalid) await assert.rejects(finishGmailConnection(input, { ...options, ...overrides }));
  assert.equal(providerCalls, 0);
  assert.equal(databaseCalls, 0);
});

test('consent must verify email and existing Google subject, and grant offline Gmail compose permission', async () => {
  const { finishGmailConnection } = await import('../lib/gmail-oauth.mjs');
  const db = await database();
  try {
    for (const options of [
      { profile: { email: 'other@example.invalid' } },
      { profile: { email_verified: false } },
      { profile: { email_verified: 'true' } },
      { profile: { sub: 'different-google-sub' } },
      { profile: { sub: '' } },
      { token: { refresh_token: '' } },
      { token: { scope: 'openid email' } },
      { token: { access_token: '' } },
    ]) {
      const { request } = await connectionRequest();
      await assert.rejects(finishGmailConnection(request, { user, env, db, fetchImpl: provider(options).fetchImpl, now }));
      assert.equal((await db.query('SELECT * FROM gmail_connection')).rows.length, 0);
    }
    await db.query('DELETE FROM "account"');
    const { request } = await connectionRequest();
    await assert.rejects(finishGmailConnection(request, { user, env, db, fetchImpl: provider().fetchImpl, now }));
  } finally { await db.close(); }
});

test('access refresh verifies own mailbox and subject again, and never returns refresh credentials', async () => {
  const { finishGmailConnection } = await import('../lib/gmail-oauth.mjs');
  const { getGmailAccess } = await import('../lib/gmail-connection.mjs');
  const db = await database();
  try {
    const { request } = await connectionRequest();
    await finishGmailConnection(request, { user, env, db, fetchImpl: provider().fetchImpl, now });
    const google = provider({ token: { refresh_token: undefined } });
    assert.deepEqual(await getGmailAccess({ user, env, db, fetchImpl: google.fetchImpl }), { accessToken: 'synthetic-access', email: user.email });
    const form = google.calls[0].init.body;
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'synthetic-refresh');
    for (const options of [{ profile: { sub: 'different' } }, { profile: { email: 'other@example.invalid' } }, { token: { scope: 'openid email' } }, { status: 403 }]) {
      await assert.rejects(getGmailAccess({ user, env, db, fetchImpl: provider(options).fetchImpl }), error => !error.message.includes('sensitive-provider-body'));
    }
    await assert.rejects(getGmailAccess({ user: { ...user, userId: 'another-user' }, env, db, fetchImpl: google.fetchImpl }));
    await db.query('UPDATE "account" SET "accountId"=$1', ['different']);
    let providerCalls = 0;
    await assert.rejects(getGmailAccess({ user, env, db, fetchImpl: () => { providerCalls++; throw new Error('Must not contact Google'); } }));
    assert.equal(providerCalls, 0);
  } finally { await db.close(); }
});

test('encrypted refresh credentials cannot be swapped into another employee connection', async () => {
  const { finishGmailConnection } = await import('../lib/gmail-oauth.mjs');
  const { getGmailAccess } = await import('../lib/gmail-connection.mjs');
  const db = await database();
  try {
    const { request } = await connectionRequest();
    await finishGmailConnection(request, { user, env, db, fetchImpl: provider().fetchImpl, now });
    await db.query('INSERT INTO "account" VALUES ($1,$2,$3,$4)', ['account-2', 'editor-2', 'google', 'google-sub-2']);
    await db.query('INSERT INTO gmail_connection (user_id,email,google_sub,refresh_token,scope,connected_at) SELECT $1,$2,$3,refresh_token,scope,connected_at FROM gmail_connection WHERE user_id=$4', ['editor-2', 'other@example.invalid', 'google-sub-2', user.userId]);
    let providerCalls = 0;
    await assert.rejects(getGmailAccess({ user: { userId: 'editor-2', email: 'other@example.invalid' }, env, db, fetchImpl: () => { providerCalls++; throw new Error('Must not decrypt swapped credentials'); } }));
    assert.equal(providerCalls, 0);
  } finally { await db.close(); }
});

test('draft request schema persists metadata, defaults timestamps and enforces one intent per employee/request', async () => {
  const db = await database();
  try {
    const insert = 'INSERT INTO gmail_draft_requests(user_id,request_id,payload_hash,status) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_id';
    assert.equal((await db.query(insert, [user.userId, 'request-1', 'hash-1', 'pending'])).rows.length, 1);
    assert.equal((await db.query(insert, [user.userId, 'request-1', 'hash-1', 'pending'])).rows.length, 0);
    assert.equal((await db.query(insert, ['other-user', 'request-1', 'hash-2', 'pending'])).rows.length, 1);
    await assert.rejects(db.query(insert, [user.userId, 'request-2', 'hash-1', 'sent']));
    const row = (await db.query('SELECT * FROM gmail_draft_requests WHERE user_id=$1', [user.userId])).rows[0];
    assert.ok(row.created_at && row.updated_at);
    assert.equal(row.draft_id, null);
    assert.equal(row.message_id, null);
    assert.equal(row.thread_id, null);
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'draft_id', 'message_id', 'payload_hash', 'request_id', 'status', 'thread_id', 'updated_at', 'user_id']);
  } finally { await db.close(); }
});
