import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ADMIN_EMAILS, CRM_AUTHORIZED, adminAllowed, effectivePolicy, normalizeAccessEmail } from '../lib/admin-policy.mjs';
import { sessionUser } from '../lib/auth-policy.mjs';
import { editorAllowed } from '../lib/hubspot-write.mjs';
import { setCrmAccess } from '../db/admin-access.mjs';
import { authOptions } from '../lib/auth-server.mjs';
import { directoryClient, readGoogleDirectory, changeGoogleRole } from '../lib/google-admin.mjs';

const env = { RECRUITING_EDITOR_EMAILS: 'old@lgcyap.com', GOOGLE_WORKSPACE_DOMAIN: 'lgcyap.com', BETTER_AUTH_URL: 'https://crm.example.test', BETTER_AUTH_SECRET: 'a'.repeat(40), GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic' };

test('only the two exact named administrators can manage access; email inputs cannot contain lists or wildcards', () => {
  for (const email of ADMIN_EMAILS) assert.equal(adminAllowed({ userId: 'verified', email: email.toUpperCase() }), true);
  for (const user of [null, { email: ADMIN_EMAILS[0] }, { userId: 'x', email: 'someone@lgcyap.com' }, { userId: 'x', email: 'chandler@lgcyap.com.attacker.test' }]) assert.equal(adminAllowed(user), false);
  assert.equal(normalizeAccessEmail(' New@lgcyap.com '), 'new@lgcyap.com');
  for (const value of ['', '*@lgcyap.com', 'a@lgcyap.com,b@lgcyap.com', 'not an email', null]) assert.throws(() => normalizeAccessEmail(value));
});

test('CRM grants and revocations affect existing sessions, new sign-ins and editing without a forgeable JSON flag', async () => {
  let rows = [{ email: 'old@lgcyap.com', allowed: false }, { email: 'new@lgcyap.com', allowed: true }, { email: 'approved@gmail.com', allowed: true }];
  const policy = () => effectivePolicy(env, rows);
  const session = email => ({ user: { id: 'u', email, emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60000) } });
  assert.equal(sessionUser(session('old@lgcyap.com'), policy().RECRUITING_EDITOR_EMAILS), null);
  assert.ok(sessionUser(session('new@lgcyap.com'), policy().RECRUITING_EDITOR_EMAILS));
  assert.equal(editorAllowed({ userId: 'u', email: 'new@lgcyap.com', accessGranted: true }, env.RECRUITING_EDITOR_EMAILS), false);
  assert.equal(editorAllowed({ userId: 'u', email: 'new@lgcyap.com', [CRM_AUTHORIZED]: true }, env.RECRUITING_EDITOR_EMAILS), true);
  for (const admin of ADMIN_EMAILS) assert.ok(effectivePolicy(env, [{ email: admin, allowed: false }]).RECRUITING_EDITOR_EMAILS.includes(admin));
  const options = authOptions(env, {}, async () => policy());
  await options.socialProviders.google.mapProfileToUser({ email: 'new@lgcyap.com', email_verified: true, hd: 'lgcyap.com' });
  await options.databaseHooks.user.create.before({ email: 'new@lgcyap.com', emailVerified: true });
  rows = [{ email: 'new@lgcyap.com', allowed: false }];
  await assert.rejects(options.socialProviders.google.mapProfileToUser({ email: 'new@lgcyap.com', email_verified: true, hd: 'lgcyap.com' }));
  await assert.rejects(options.databaseHooks.user.create.before({ email: 'new@lgcyap.com', emailVerified: true }));
});

test('CRM access changes and audit entries persist together in Postgres', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/0013_admin_access.sql', import.meta.url), 'utf8'));
    const pool = { connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
    await assert.rejects(setCrmAccess(ADMIN_EMAILS[0], false, ADMIN_EMAILS[1], pool), error => error.status === 400);
    await assert.rejects(setCrmAccess('new@lgcyap.com', true, 'outsider@lgcyap.com', pool), error => error.status === 403);
    await setCrmAccess('new@lgcyap.com', true, ADMIN_EMAILS[0], pool);
    await setCrmAccess('new@lgcyap.com', false, ADMIN_EMAILS[1], pool);
    assert.equal((await db.query('SELECT allowed FROM crm_access_overrides')).rows[0].allowed, false);
    assert.deepEqual((await db.query('SELECT actor, action FROM crm_admin_audit ORDER BY id')).rows, [{ actor: ADMIN_EMAILS[0], action: 'crm.grant' }, { actor: ADMIN_EMAILS[1], action: 'crm.revoke' }]);
  } finally { await db.close(); }
});

test('Google directory reads every page and returns only dashboard fields', async () => {
  const paths = [];
  const data = await readGoogleDirectory(async path => {
    paths.push(path);
    if (path.startsWith('users?') && !path.includes('pageToken')) return { users: [{ id: '1', primaryEmail: 'one@lgcyap.com', name: { fullName: 'One' }, secret: 'omit' }], nextPageToken: 'next' };
    if (path.startsWith('users?')) return { users: [{ id: '2', primaryEmail: 'two@lgcyap.com' }] };
    if (path.includes('/roleassignments?')) return { items: [{ roleAssignmentId: '5', assignedTo: '1', roleId: '3', scopeType: 'CUSTOMER' }] };
    return { items: [{ roleId: '3', roleName: 'User management' }] };
  });
  assert.equal(data.users.length, 2); assert.equal(data.partial, false); assert.equal(data.users[0].secret, undefined);
  assert.ok(paths.some(path => path.includes('pageToken=next')));
  assert.equal(data.assignments[0].userId, '1');
});

test('Google grants and removals use fixed endpoints, exact IDs and explicit organization-wide scope', async () => {
  const calls = [];
  const read = async (...args) => { calls.push(args); return { assignedTo: '12', roleId: '34', roleAssignmentId: '56' }; };
  await changeGoogleRole(read, { action: 'grant', userId: '12', roleId: '34' });
  assert.deepEqual(calls.at(-1), ['customer/my_customer/roleassignments', 'POST', { assignedTo: '12', roleId: '34', scopeType: 'CUSTOMER' }]);
  await changeGoogleRole(read, { action: 'revoke', assignmentId: '56' });
  assert.deepEqual(calls.at(-1), ['customer/my_customer/roleassignments/56', 'DELETE']);
  for (const input of [{ action: 'grant', userId: '../users', roleId: '34' }, { action: 'revoke', assignmentId: 'https://evil.test' }, { action: 'delete-user', userId: '12' }]) await assert.rejects(changeGoogleRole(read, input));
});

test('Google errors do not leak tokens or upstream response details and do not retry a write', async () => {
  let calls = 0;
  const read = directoryClient('synthetic-secret-token', async (url, options) => { calls++; assert.ok(url.startsWith('https://admin.googleapis.com/admin/directory/v1/')); assert.equal(options.redirect, 'error'); return new Response('private upstream detail', { status: 403 }); });
  await assert.rejects(read('customer/my_customer/roleassignments', 'POST', {}), error => error.status === 403 && !/secret-token|private upstream/.test(error.message));
  assert.equal(calls, 1);
});
