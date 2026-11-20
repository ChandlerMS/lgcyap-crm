import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { betterAuth } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';
import { getMigrations } from 'better-auth/db/migration';
import { google } from 'better-auth/social-providers';
import { authOptions, getAuth, handleAuthRequest } from '../lib/auth-server.mjs';
import { sessionUser } from '../lib/auth-policy.mjs';

const email = 'editor@example.invalid';
const env = { BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_SECRET: 'synthetic-auth-secret-with-at-least-32-characters', GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', RECRUITING_EDITOR_EMAILS: email };

async function setup(config = env) {
  const db = await PGlite.create();
  const query = async (sql, params) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length, command: sql.trim().split(/\s+/)[0].toUpperCase() };
  };
  // pg-compatible boundary over the real embedded PostgreSQL engine. No network,
  // production data, or alternate authentication path is used by these tests.
  const pool = { connect: async () => ({ query, release() {} }), query, end: async () => {} };
  const options = authOptions(config, pool);
  const migration = await getMigrations(options);
  await migration.runMigrations();
  const auth = betterAuth(options);
  return { db, options, auth };
}

test('auth factory stays closed without configuration; Google options require Workspace and identity scopes only', () => {
  assert.equal(getAuth(), null);
  const options = authOptions(env, {});
  assert.deepEqual(options.trustedOrigins, ['http://localhost:3000']);
  assert.equal(options.socialProviders.google.hd, '*');
  assert.equal(authOptions({ ...env, GOOGLE_WORKSPACE_DOMAIN: ' Example.invalid ' }, {}).socialProviders.google.hd, 'example.invalid');
  assert.equal(options.socialProviders.google.accessType, 'online');
  assert.equal(options.socialProviders.google.includeGrantedScopes, false);
  assert.deepEqual(options.socialProviders.google.scope, ['openid', 'email', 'profile']);
  assert.equal(options.account.accountLinking.enabled, false);
  assert.equal(options.emailAndPassword.enabled, false);
  assert.equal(options.session.cookieCache.enabled, false);
  assert.equal(options.rateLimit.storage, 'database');
});

test('database hooks reject unverified/unapproved users and prevent their sessions', async () => {
  const options = authOptions(env, {});
  const create = options.databaseHooks.user.create.before;
  await create({ email, emailVerified: true });
  for (const user of [{ email, emailVerified: false }, { email: 'outsider@example.invalid', emailVerified: true }]) await assert.rejects(create(user));
  const createSession = options.databaseHooks.session.create.before;
  const context = user => ({ context: { internalAdapter: { findUserById: async () => user } } });
  await createSession({ userId: 'synthetic' }, context({ email, emailVerified: true }));
  await assert.rejects(createSession({ userId: 'synthetic' }, context({ email, emailVerified: false })));
  await assert.rejects(createSession({ userId: 'synthetic' }, context({ email: 'outsider@example.invalid', emailVerified: true })));
  await assert.rejects(createSession({ userId: 'synthetic' }, undefined));
});

test('installed Google provider enforces Workspace hd claims, including an exact configured domain', async (t) => {
  // Rejected synthetic profiles intentionally produce SDK error logs.
  t.mock.method(console, 'error', () => {});
  const profile = domain => {
    const payload = { sub: 'synthetic-subject', email, email_verified: true, name: 'Synthetic Editor', ...(domain ? { hd: domain } : {}) };
    return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic`;
  };
  // This isolates the SDK's profile/domain filter, not Google token verification.
  // Real sign-in still verifies Google's token signature, issuer and audience.
  const workspace = google(authOptions(env, {}).socialProviders.google);
  assert.equal(await workspace.getUserInfo({ idToken: profile() }), null);
  assert.equal((await workspace.getUserInfo({ idToken: profile('example.invalid') })).user.email, email);
  const exact = google(authOptions({ ...env, GOOGLE_WORKSPACE_DOMAIN: 'example.invalid' }, {}).socialProviders.google);
  assert.equal(await exact.getUserInfo({ idToken: profile('other.invalid') }), null);
  assert.equal((await exact.getUserInfo({ idToken: profile('example.invalid') })).user.email, email);
});

test('installed provider permits only the explicit verified Gmail exception while retaining Workspace claims', async (t) => {
  t.mock.method(console, 'error', () => {});
  const personal = 'personal.editor@gmail.com';
  const main = `${email},${personal}`;
  const mixed = { ...env, GOOGLE_WORKSPACE_DOMAIN: 'example.invalid', RECRUITING_EDITOR_EMAILS: main, GOOGLE_PERSONAL_EMAILS: personal };
  const token = claims => ({ idToken: `e30.${Buffer.from(JSON.stringify({ sub: 'synthetic-subject', name: 'Synthetic Editor', email, email_verified: true, ...claims })).toString('base64url')}.synthetic` });
  // Only the installed profile filter is isolated here. Real OAuth retains the
  // library's Google token verification, code exchange, state and PKCE checks.
  const provider = google(authOptions(mixed, {}).socialProviders.google);
  const accepted = await provider.getUserInfo(token({ email: personal.toUpperCase() }));
  assert.equal(accepted?.user.email, personal.toUpperCase());
  assert.equal(accepted?.user.emailVerified, true);
  assert.equal((await provider.getUserInfo(token({ hd: 'example.invalid' })))?.user.email, email);
  const rejected = [
    { email: 'outsider@gmail.com' },
    { email: 'personal.editor+alias@gmail.com' },
    { email: personal, email_verified: false },
    { email: personal, email_verified: 'true' },
    {},
    { hd: 'other.invalid' },
    { hd: 'example.invalid', email: 'outsider@example.invalid' },
    { hd: 'example.invalid', email_verified: false },
  ];
  for (const claims of rejected) {
    let result;
    try { result = await provider.getUserInfo(token(claims)); }
    catch (error) { assert.equal(error.statusCode, 403); continue; }
    assert.equal(result, null);
  }
  const noException = google(authOptions({ ...mixed, GOOGLE_PERSONAL_EMAILS: '' }, {}).socialProviders.google);
  assert.equal(await noException.getUserInfo(token({ email: personal })), null);
});

test('personal exceptions also gate creation of database users and sessions', async () => {
  const personal = 'personal.editor@gmail.com';
  const config = { ...env, RECRUITING_EDITOR_EMAILS: `${email},${personal}`, GOOGLE_PERSONAL_EMAILS: personal };
  const identity = { email: personal.toUpperCase(), emailVerified: true };
  const options = authOptions(config, {});
  await options.databaseHooks.user.create.before(identity);
  const context = { context: { internalAdapter: { findUserById: async () => identity } } };
  await options.databaseHooks.session.create.before({ userId: 'synthetic' }, context);
  const strict = authOptions({ ...config, GOOGLE_PERSONAL_EMAILS: '' }, {});
  await assert.rejects(strict.databaseHooks.user.create.before(identity));
  await assert.rejects(strict.databaseHooks.session.create.before({ userId: 'synthetic' }, context));
});

test('installed provider allows only exact verified external exceptions without weakening company Workspace claims', async (t) => {
  t.mock.method(console, 'error', () => {});
  const external = 'partner.editor@partner.invalid';
  const other = 'other@partner.invalid';
  const mixed = { ...env, GOOGLE_WORKSPACE_DOMAIN: 'example.invalid', RECRUITING_EDITOR_EMAILS: `${email},${external},${other}`, GOOGLE_EXTERNAL_EMAILS: external };
  const token = claims => ({ idToken: `e30.${Buffer.from(JSON.stringify({ sub: 'synthetic-subject', name: 'Synthetic Editor', email, email_verified: true, ...claims })).toString('base64url')}.synthetic` });
  const provider = google(authOptions(mixed, {}).socialProviders.google);
  for (const hd of [undefined, 'partner.invalid', 'another.invalid']) {
    const accepted = await provider.getUserInfo(token({ email: external.toUpperCase(), ...(hd ? { hd } : {}) }));
    assert.equal(accepted?.user.email, external.toUpperCase());
    assert.equal(accepted?.user.emailVerified, true);
  }
  assert.equal((await provider.getUserInfo(token({ hd: 'example.invalid' })))?.user.email, email);
  for (const claims of [
    { email: other },
    { email: other, hd: 'example.invalid' },
    { email: external, email_verified: false },
    { email: external, email_verified: 'true' },
    { email: 'unlisted@partner.invalid' },
    { email: 'personal.editor@gmail.com' },
    {},
    { hd: 'another.invalid' },
  ]) {
    let result;
    try { result = await provider.getUserInfo(token(claims)); }
    catch (error) { assert.equal(error.statusCode, 403); continue; }
    assert.equal(result, null);
  }
});

test('external exceptions also gate creation of database users and sessions after removal', async () => {
  const external = 'partner.editor@partner.invalid';
  const config = { ...env, GOOGLE_WORKSPACE_DOMAIN: 'example.invalid', RECRUITING_EDITOR_EMAILS: `${email},${external}`, GOOGLE_EXTERNAL_EMAILS: external };
  const identity = { email: external.toUpperCase(), emailVerified: true };
  const options = authOptions(config, {});
  await options.databaseHooks.user.create.before(identity);
  const context = { context: { internalAdapter: { findUserById: async () => identity } } };
  await options.databaseHooks.session.create.before({ userId: 'synthetic' }, context);
  const strict = authOptions({ ...config, GOOGLE_EXTERNAL_EMAILS: '' }, {});
  await assert.rejects(strict.databaseHooks.user.create.before(identity));
  await assert.rejects(strict.databaseHooks.session.create.before({ userId: 'synthetic' }, context));
});

test('Better Auth PostgreSQL migration and signed session verification reject forged/expired sessions', async () => {
  const { db, auth, options } = await setup();
  try {
    const fresh = await getMigrations(options);
    assert.equal(fresh.toBeCreated.length + fresh.toBeAdded.length + fresh.toBeAddedIndexes.length, 0);
    const now = new Date();
    const expiry = new Date(now.getTime() + 60000);
    await db.query('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,$4,$4)', ['synthetic-user', 'Synthetic Editor', email, now]);
    await db.query('INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', ['synthetic-session', 'synthetic-token', 'synthetic-user', expiry, now]);
    const signed = `synthetic-token.${await makeSignature('synthetic-token', env.BETTER_AUTH_SECRET)}`;
    const cookie = `better-auth.session_token=${encodeURIComponent(signed)}`;
    const session = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    assert.equal(session.user.email, email);
    assert.equal(sessionUser(session, email).userId, 'synthetic-user');
    assert.equal(sessionUser(session, 'different@example.invalid'), null);
    assert.equal(await auth.api.getSession({ headers: new Headers({ Cookie: 'better-auth.session_token=synthetic-token.forged' }) }), null);
    assert.equal(await auth.api.getSession({ headers: new Headers({ 'oai-authenticated-user-email': email, 'oai-authenticated-user-id': 'synthetic-user' }) }), null);
    await db.query('UPDATE "session" SET "expiresAt" = $1', [new Date(Date.now() - 60000)]);
    assert.equal(await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) }), null);
  } finally { await db.close(); }
});

test('real auth route starts Google OAuth with fixed callback and rejects cross-origin/password requests', async () => {
  const { db, auth } = await setup();
  try {
    const request = origin => new Request('http://localhost:3000/api/auth/sign-in/social', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: '/' }) });
    const handle = request => handleAuthRequest(request, { resolveAuth: () => auth, baseURL: env.BETTER_AUTH_URL });
    const response = await handle(request('http://localhost:3000'));
    assert.equal(response.status, 200);
    const result = await response.json();
    const url = new URL(result.url);
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/callback/google');
    assert.equal(url.searchParams.get('access_type'), 'online');
    assert.equal(url.searchParams.get('hd'), '*');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const scopes = url.searchParams.get('scope').split(' ');
    assert.ok(scopes.every(scope => ['openid', 'email', 'profile'].includes(scope)));
    assert.equal((await handle(request('https://other.example.invalid'))).status, 403);
    const password = await handle(new Request('http://localhost:3000/api/auth/sign-up/email', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'synthetic-test-password', name: 'Synthetic' }) }));
    assert.notEqual(password.status, 200);
  } finally { await db.close(); }
});

test('mixed-account OAuth omits the Workspace chooser restriction and retains identity-only PKCE sign-in', async () => {
  const personal = 'personal.editor@gmail.com';
  const mixed = { ...env, GOOGLE_WORKSPACE_DOMAIN: 'example.invalid', RECRUITING_EDITOR_EMAILS: `${email},${personal}`, GOOGLE_PERSONAL_EMAILS: personal };
  const { db, auth } = await setup(mixed);
  try {
    const request = new Request('http://localhost:3000/api/auth/sign-in/social', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: '/' }) });
    const response = await handleAuthRequest(request, { resolveAuth: () => auth, baseURL: env.BETTER_AUTH_URL });
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('hd'), null);
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/callback/google');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('access_type'), 'online');
    assert.ok(url.searchParams.get('scope').split(' ').every(scope => ['openid', 'email', 'profile'].includes(scope)));
  } finally { await db.close(); }
});

test('an external exception alone removes the Workspace chooser restriction while preserving fixed-callback PKCE', async () => {
  const external = 'partner.editor@partner.invalid';
  const mixed = { ...env, GOOGLE_WORKSPACE_DOMAIN: 'example.invalid', RECRUITING_EDITOR_EMAILS: `${email},${external}`, GOOGLE_EXTERNAL_EMAILS: external };
  const { db, auth } = await setup(mixed);
  try {
    const request = new Request('http://localhost:3000/api/auth/sign-in/social', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: '/' }) });
    const response = await handleAuthRequest(request, { resolveAuth: () => auth, baseURL: env.BETTER_AUTH_URL });
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    assert.equal(url.searchParams.get('hd'), null);
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/callback/google');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('scope').split(' ').every(scope => ['openid', 'email', 'profile'].includes(scope)));
  } finally { await db.close(); }
});

test('Queue handoff shares only a genuinely verified session and rejects forged, unapproved, expired and revoked sessions', async () => {
  const { queueAccessResponse, queueSessionHeaders } = await import('../lib/queue-host.mjs');
  const production = { ...env, BETTER_AUTH_URL: 'https://crm.lgcyap.com' };
  const { db, auth } = await setup(production);
  try {
    const now = new Date();
    const expiry = new Date(now.getTime() + 60000);
    await db.query('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,$4,$4)', ['queue-user', 'Synthetic Editor', email, now]);
    await db.query('INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', ['queue-session', 'queue-token', 'queue-user', expiry, now]);
    const signed = `queue-token.${await makeSignature('queue-token', env.BETTER_AUTH_SECRET)}`;
    const options = { baseURL: production.BETTER_AUTH_URL, getSession: headers => auth.api.getSession({ headers }), authorize: session => Boolean(sessionUser(session, email)) };
    const request = value => new Request('https://crm.lgcyap.com/queue-access', { headers: { Cookie: `__Secure-better-auth.session_token=${encodeURIComponent(value)}` } });
    const accepted = await queueAccessResponse(request(signed), options);
    assert.equal(accepted.status, 307);
    assert.equal(accepted.headers.get('location'), 'https://queue.lgcyap.com/');
    const cookie = accepted.headers.get('set-cookie');
    assert.ok(cookie.startsWith(`__Secure-lgcy-queue.session_token=${encodeURIComponent(signed)};`));
    assert.match(cookie, /Domain=lgcyap.com/);
    // The Queue API's standard Better Auth check verifies this same cookie.
    const queueSession = await auth.api.getSession({ headers: queueSessionHeaders(new Headers({ Host: 'queue.lgcyap.com', Origin: 'https://queue.lgcyap.com', Cookie: cookie.split(';')[0] }), production.BETTER_AUTH_URL) });
    assert.equal(sessionUser(queueSession, email)?.userId, 'queue-user');
    const forged = await queueAccessResponse(request('queue-token.forged'), options);
    assert.equal(forged.headers.get('set-cookie'), null);
    const unapproved = await queueAccessResponse(request(signed), { ...options, authorize: session => Boolean(sessionUser(session, 'someone.else@example.invalid')) });
    assert.equal(unapproved.status, 403);
    assert.equal(unapproved.headers.get('set-cookie'), null);
    await db.query('UPDATE "session" SET "expiresAt" = $1', [new Date(Date.now() - 60000)]);
    assert.equal((await queueAccessResponse(request(signed), options)).headers.get('set-cookie'), null);
    await db.query('DELETE FROM "session"');
    assert.equal(await auth.api.getSession({ headers: queueSessionHeaders(new Headers({ Host: 'queue.lgcyap.com', Origin: 'https://queue.lgcyap.com', Cookie: cookie.split(';')[0] }), production.BETTER_AUTH_URL) }), null);
    assert.equal((await queueAccessResponse(request(signed), options)).headers.get('set-cookie'), null);
    // A later CRM login must recover even though the old Queue cookie is still present.
    await db.query('INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', ['new-session', 'new-token', 'queue-user', expiry, now]);
    const newSigned = `new-token.${await makeSignature('new-token', env.BETTER_AUTH_SECRET)}`;
    const relogin = new Request('https://crm.lgcyap.com/queue-access', { headers: { Cookie: `${cookie.split(';')[0]}; __Secure-better-auth.session_token=${encodeURIComponent(newSigned)}` } });
    const recovered = await queueAccessResponse(relogin, options);
    assert.equal(recovered.status, 307);
    assert.ok(recovered.headers.get('set-cookie').startsWith(`__Secure-lgcy-queue.session_token=${encodeURIComponent(newSigned)};`));
  } finally { await db.close(); }
});

test('Leaderboard TV handoff shares only a genuinely verified session and rejects forged, unapproved, expired and revoked sessions', async () => {
  const { leaderboardAccessResponse, leaderboardSessionHeaders } = await import('../lib/leaderboard-host.mjs');
  const production = { ...env, BETTER_AUTH_URL: 'https://crm.lgcyap.com' };
  const { db, auth } = await setup(production);
  try {
    const now = new Date();
    const expiry = new Date(now.getTime() + 60000);
    await db.query('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,$4,$4)', ['tv-user', 'Synthetic Editor', email, now]);
    await db.query('INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', ['tv-session', 'tv-token', 'tv-user', expiry, now]);
    const signed = `tv-token.${await makeSignature('tv-token', env.BETTER_AUTH_SECRET)}`;
    const options = { baseURL: production.BETTER_AUTH_URL, getSession: headers => auth.api.getSession({ headers }), authorize: session => Boolean(sessionUser(session, email)) };
    const request = value => new Request('https://crm.lgcyap.com/leaderboard-access', { headers: { Cookie: `__Secure-better-auth.session_token=${encodeURIComponent(value)}` } });
    const accepted = await leaderboardAccessResponse(request(signed), options);
    assert.equal(accepted.status, 307);
    assert.equal(accepted.headers.get('location'), 'https://leaderboard.lgcyap.com/');
    const cookie = accepted.headers.get('set-cookie');
    assert.ok(cookie.startsWith(`__Secure-lgcy-leaderboard.session_token=${encodeURIComponent(signed)};`));
    // The leaderboard API's standard Better Auth check verifies this same cookie on the TV host.
    const tvHeaders = () => leaderboardSessionHeaders(new Headers({ Host: 'leaderboard.lgcyap.com', Origin: 'https://leaderboard.lgcyap.com', Cookie: cookie.split(';')[0] }), production.BETTER_AUTH_URL);
    assert.equal(sessionUser(await auth.api.getSession({ headers: tvHeaders() }), email)?.userId, 'tv-user');
    assert.equal((await leaderboardAccessResponse(request('tv-token.forged'), options)).headers.get('set-cookie'), null);
    const unapproved = await leaderboardAccessResponse(request(signed), { ...options, authorize: session => Boolean(sessionUser(session, 'someone.else@example.invalid')) });
    assert.equal(unapproved.status, 403);
    assert.equal(unapproved.headers.get('set-cookie'), null);
    await db.query('UPDATE "session" SET "expiresAt" = $1', [new Date(Date.now() - 60000)]);
    assert.equal((await leaderboardAccessResponse(request(signed), options)).headers.get('set-cookie'), null);
    // Signing out of the CRM (deleting the session) ends the TV's access too.
    await db.query('DELETE FROM "session"');
    assert.equal(await auth.api.getSession({ headers: tvHeaders() }), null);
  } finally { await db.close(); }
});
