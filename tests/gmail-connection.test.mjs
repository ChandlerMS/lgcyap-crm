import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const env = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', BETTER_AUTH_SECRET: 'synthetic-gmail-secret-at-least-thirty-two-characters', BETTER_AUTH_URL: 'https://crm.example.invalid', VERCEL: '1', VERCEL_ENV: 'production', RECRUITING_EDITOR_EMAILS: 'editor@example.invalid,other@example.invalid' };
const user = { userId: 'editor-1', email: 'editor@example.invalid' };
const getUser = async () => user;
const request = (input = { action: 'connect' }, overrides = {}) => new Request(`${env.BETTER_AUTH_URL}/api/gmail`, { method: 'POST', headers: { Origin: env.BETTER_AUTH_URL, 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...overrides });
const noDb = () => { throw new Error('Unauthorized database access'); };

test('connection endpoint rejects unauthenticated, unauthorized, cross-origin and preview mutations before database access', async () => {
  const { handleGmailConnection } = await import('../lib/gmail-connection.mjs');
  const base = { env, getUser, getDb: noDb };
  assert.equal((await handleGmailConnection(request(), { ...base, getUser: async () => null })).status, 401);
  assert.equal((await handleGmailConnection(request(), { ...base, getUser: async () => ({ ...user, email: 'outsider@example.invalid' }) })).status, 403);
  assert.equal((await handleGmailConnection(request({}, { headers: { Origin: 'https://evil.example.invalid', 'Content-Type': 'application/json' } }), base)).status, 403);
  assert.equal((await handleGmailConnection(new Request('https://evil.example.invalid/api/gmail'), base)).status, 403);
  assert.equal((await handleGmailConnection(request(), { ...base, env: { ...env, VERCEL_ENV: 'preview' } })).status, 403);
  assert.equal((await handleGmailConnection(request({ action: 'disconnect' }), { ...base, env: { ...env, VERCEL_ENV: 'preview' } })).status, 403);
  assert.equal((await handleGmailConnection(request(), { ...base, env: { ...env, VERCEL: undefined } })).status, 403);
});

test('status in a preview, local environment or missing OAuth setup does not access credentials', async () => {
  const { handleGmailConnection } = await import('../lib/gmail-connection.mjs');
  for (const disabled of [{ VERCEL_ENV: 'preview' }, { VERCEL: undefined }, { GOOGLE_CLIENT_SECRET: '' }]) {
    const response = await handleGmailConnection(new Request(`${env.BETTER_AUTH_URL}/api/gmail`), { env: { ...env, ...disabled }, getUser, getDb: noDb });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, false);
    assert.equal(body.connected, false);
  }
});

test('connection POST requires a small exact JSON action and returns only the consent URL', async () => {
  const { handleGmailConnection } = await import('../lib/gmail-connection.mjs');
  const options = { env, getUser, getDb: noDb };
  for (const body of [{ action: 'send' }, { action: 'connect', email: 'other@example.invalid' }, [], null]) assert.equal((await handleGmailConnection(request(body), options)).status, 400);
  assert.equal((await handleGmailConnection(request({}, { body: '{broken' }), options)).status, 400);
  assert.equal((await handleGmailConnection(request({}, { body: 'x'.repeat(300) }), options)).status, 413);
  assert.equal((await handleGmailConnection(request({}, { headers: { Origin: env.BETTER_AUTH_URL, 'Content-Type': 'text/plain' } }), options)).status, 415);
  const response = await handleGmailConnection(request(), options);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['url']);
  assert.equal(new URL(body.url).hostname, 'accounts.google.com');
  assert.match(response.headers.get('set-cookie'), /^gmail_oauth=/);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
});

test('status validates the current Google subject, exposes no credentials, and provides account-specific Gmail links', async () => {
  const { handleGmailConnection } = await import('../lib/gmail-connection.mjs');
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "account" (id text, "userId" text, "providerId" text, "accountId" text)');
    await db.exec(await readFile(new URL('../migrations/0017_gmail_drafts.sql', import.meta.url), 'utf8'));
    const getDb = async () => db;
    const read = () => handleGmailConnection(new Request(`${env.BETTER_AUTH_URL}/api/gmail`), { env, getUser, getDb });
    let response = await read(), body = await response.json();
    assert.equal(body.connected, false);
    assert.equal(body.email, user.email);
    assert.equal(body.available, true);
    assert.equal(body.inboxUrl, 'https://mail.google.com/mail/u/?authuser=editor%40example.invalid#inbox');
    assert.equal(body.draftsUrl, 'https://mail.google.com/mail/u/?authuser=editor%40example.invalid#drafts');
    await db.query('INSERT INTO "account" VALUES ($1,$2,$3,$4)', ['account-1', user.userId, 'google', 'google-sub-1']);
    await db.query('INSERT INTO gmail_connection VALUES ($1,$2,$3,$4,$5,now())', [user.userId, user.email, 'google-sub-1', 'sensitive-encrypted-token', 'openid email https://www.googleapis.com/auth/gmail.compose']);
    response = await read(); body = await response.json();
    assert.equal(body.connected, true);
    assert.equal(body.canRead, false, 'old compose permission requires reconnection before reading mail');
    await db.query('UPDATE gmail_connection SET scope=$1', ['openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly']);
    assert.equal((await (await read()).json()).canRead, true);
    assert.equal(JSON.stringify(body).includes('sensitive'), false);
    assert.equal(body.google_sub, undefined);
    await db.query('UPDATE "account" SET "accountId"=$1', ['different']);
    assert.equal((await (await read()).json()).connected, false);
  } finally { await db.close(); }
});

test('disconnect deletes only this employees Gmail credentials and clears in-flight consent', async () => {
  const { handleGmailConnection } = await import('../lib/gmail-connection.mjs');
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/0017_gmail_drafts.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../migrations/0015_application_sheets.sql', import.meta.url), 'utf8'));
    for (const [id, email] of [[user.userId, user.email], ['editor-2', 'other@example.invalid']]) await db.query('INSERT INTO gmail_connection VALUES ($1,$2,$3,$4,$5,now())', [id, email, `sub-${id}`, 'encrypted-token', 'https://www.googleapis.com/auth/gmail.compose']);
    await db.query('INSERT INTO application_sheets_connection(id,email,refresh_token,connected_at) VALUES(1,$1,$2,now())', ['chandler@lgcyap.com', 'sheets-token']);
    const response = await handleGmailConnection(request({ action: 'disconnect' }), { env, getUser, getDb: async () => db });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).connected, false);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.deepEqual((await db.query('SELECT user_id FROM gmail_connection')).rows, [{ user_id: 'editor-2' }]);
    assert.equal((await db.query('SELECT refresh_token FROM application_sheets_connection')).rows[0].refresh_token, 'sheets-token');
  } finally { await db.close(); }
});

test('callbacks redirect to Email and clear state on success and any authorization/provider failure without leaking details', async () => {
  const { handleGmailCallback } = await import('../lib/gmail-connection.mjs');
  const { startGmailConnection } = await import('../lib/gmail-oauth.mjs');
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "account" (id text, "userId" text, "providerId" text, "accountId" text)');
    await db.exec(await readFile(new URL('../migrations/0017_gmail_drafts.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO "account" VALUES ($1,$2,$3,$4)', ['account-1', user.userId, 'google', 'google-sub-1']);
    const start = startGmailConnection({ user, env });
    const callback = new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?code=sensitive-code&state=${new URL(start.url).searchParams.get('state')}`, { headers: { Cookie: start.cookie.split(';')[0] } });
    const fetchImpl = async url => Response.json(String(url).includes('/token') ? { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: 'openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly' } : { email: user.email, sub: 'google-sub-1', email_verified: true });
    for (const [options, result] of [
      [{ getUser, fetchImpl }, 'connected'],
      [{ getUser: async () => null, fetchImpl }, 'error'],
      [{ getUser, fetchImpl: async () => { throw new Error('sensitive-provider-error'); } }, 'error'],
      [{ getUser: async () => ({ ...user, email: 'outsider@example.invalid' }), fetchImpl }, 'error'],
    ]) {
      const response = await handleGmailCallback(callback, { env, getDb: async () => db, ...options });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), `${env.BETTER_AUTH_URL}/?gmail=${result}#email`);
      assert.match(response.headers.get('set-cookie'), /^gmail_oauth=.*Max-Age=0/);
      assert.equal((await response.text()).includes('sensitive'), false);
    }
  } finally { await db.close(); }
});
