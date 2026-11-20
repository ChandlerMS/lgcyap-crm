import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { betterAuth } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../lib/auth-server.mjs';
import { GOOGLE_ADMIN_SCOPES } from '../lib/google-admin.mjs';

// The real library generates/validates state, binds the account, executes the callback, and encrypts/stores the tokens.
// Only Google's network/provider boundary uses synthetic data.
test('existing basic-scope admin can reauthorize its exact Google account, persist Directory scopes, and keep tokens encrypted', async () => {
  const db = new PGlite();
  const env = { BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_SECRET: 'synthetic-auth-secret-at-least-32-characters', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', GOOGLE_WORKSPACE_DOMAIN: 'lgcyap.com', RECRUITING_EDITOR_EMAILS: 'chandler@lgcyap.com,editor@lgcyap.com' };
  const query = async (sql, params) => { const result = await db.query(sql, params); return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length, command: sql.trim().split(/\s+/)[0].toUpperCase() }; };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const options = authOptions(env, pool, async () => env);
  options.plugins = [];
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  try {
    const now = new Date();
    for (const [id, email, subject] of [['admin', 'chandler@lgcyap.com', '111'], ['ordinary', 'editor@lgcyap.com', '222']]) {
      await query('INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,$4,$4)', [id, id, email, now]);
      await query('INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', [`session-${id}`, `token-${id}`, id, new Date(now.getTime() + 600000), now]);
      await query('INSERT INTO "account" (id, "accountId", "providerId", "userId", scope, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6)', [`account-${id}`, subject, 'google', id, 'openid,email,profile', now]);
    }
    const ctx = await auth.$context;
    const provider = ctx.socialProviders.find(provider => provider.id === 'google');
    let subject = '111'; let email = 'chandler@lgcyap.com';
    provider.validateAuthorizationCode = async () => ({ accessToken: 'synthetic-directory-token', accessTokenExpiresAt: new Date(Date.now() + 600000), scopes: ['openid', 'email', 'profile', ...GOOGLE_ADMIN_SCOPES] });
    provider.getUserInfo = async () => ({ user: { id: subject, email, emailVerified: true, name: 'Synthetic Admin' }, data: { sub: subject, email, email_verified: true, hd: 'lgcyap.com' } });
    async function consent(id) {
      const signed = `token-${id}.${await makeSignature(`token-${id}`, env.BETTER_AUTH_SECRET)}`;
      const cookie = `better-auth.session_token=${encodeURIComponent(signed)}`;
      const started = await auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth/link-social`, { method: 'POST', headers: { Origin: env.BETTER_AUTH_URL, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: '/#admin', scopes: GOOGLE_ADMIN_SCOPES }) }));
      assert.equal(started.status, 200);
      const url = new URL((await started.json()).url);
      for (const scope of GOOGLE_ADMIN_SCOPES) assert.ok(url.searchParams.get('scope').includes(scope));
      const cookies = [cookie, ...started.headers.getSetCookie().map(value => value.split(';')[0])].join('; ');
      return auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/google?code=synthetic&state=${encodeURIComponent(url.searchParams.get('state'))}`, { headers: { Cookie: cookies } }));
    }
    const accepted = await consent('admin');
    assert.equal(accepted.status, 302);
    assert.ok(accepted.headers.get('location').endsWith('/#admin'), accepted.headers.get('location'));
    const account = (await query('SELECT scope, "accessToken" FROM "account" WHERE id=$1', ['account-admin'])).rows[0];
    for (const scope of GOOGLE_ADMIN_SCOPES) assert.ok(account.scope.includes(scope));
    assert.notEqual(account.accessToken, 'synthetic-directory-token');
    const signed = `token-admin.${await makeSignature('token-admin', env.BETTER_AUTH_SECRET)}`;
    const headers = new Headers({ Cookie: `better-auth.session_token=${encodeURIComponent(signed)}` });
    assert.ok((await auth.api.listUserAccounts({ headers }))[0].scopes.includes(GOOGLE_ADMIN_SCOPES[0]));
    assert.equal((await auth.api.getAccessToken({ headers, body: { accountId: 'account-admin' } })).accessToken, 'synthetic-directory-token');
    subject = '333';
    assert.match((await consent('admin')).headers.get('location'), /error=linking_not_allowed/);
    assert.equal((await query('SELECT id FROM "account" WHERE "accountId"=$1', ['333'])).rows.length, 0);
    subject = '222'; email = 'editor@lgcyap.com';
    assert.match((await consent('ordinary')).headers.get('location'), /error=linking_not_allowed/);
    assert.equal((await query('SELECT scope FROM "account" WHERE id=$1', ['account-ordinary'])).rows[0].scope, 'openid,email,profile');
  } finally { await db.close(); }
});
