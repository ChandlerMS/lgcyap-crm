import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedEmails, approvedIdentity, authSetupIssues, safeReturnPath, sessionUser } from '../lib/auth-policy.mjs';

const email = 'editor@example.invalid';
const now = Date.parse('2026-10-29T12:00:00Z');
const session = () => ({ user: { id: 'synthetic-user', email, emailVerified: true, name: 'Synthetic Editor' }, session: { expiresAt: new Date(now + 60000) } });
const config = () => ({ BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_SECRET: 'a'.repeat(32), GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', DATABASE_URL: 'postgres://test:synthetic@localhost/test', RECRUITING_EDITOR_EMAILS: email });

test('only explicit verified Google email identities are approved', () => {
  assert.deepEqual(allowedEmails(` ${email.toUpperCase()}, ${email},@example.invalid,*@example.invalid`), [email]);
  assert.equal(approvedIdentity({ email, emailVerified: true }, email.toUpperCase()), true);
  for (const user of [null, {}, { email }, { email, emailVerified: 'true' }, { email, emailVerified: false }, { email: 'coworker@example.invalid', emailVerified: true }]) {
    assert.equal(approvedIdentity(user, email), false);
  }
  assert.equal(approvedIdentity({ email, emailVerified: true }, ''), false);
  assert.equal(approvedIdentity({ email, emailVerified: true }, '*@example.invalid'), false);
});

test('a verified Gmail identity needs the exact personal exception and main allowlist', () => {
  const personal = 'personal.editor@gmail.com';
  const identity = { email: personal.toUpperCase(), emailVerified: true };
  assert.equal(approvedIdentity(identity, personal, personal.toUpperCase()), true);
  assert.equal(approvedIdentity(identity, personal), false);
  assert.equal(approvedIdentity(identity, personal, 'another@gmail.com'), false);
  assert.equal(approvedIdentity(identity, email, personal), false);
  assert.equal(approvedIdentity({ ...identity, emailVerified: false }, personal, personal), false);
  assert.equal(approvedIdentity({ ...identity, email: 'personal.editor+alias@gmail.com' }, personal, personal), false);
});

test('an outside-company identity needs its exact external exception and main allowlist', () => {
  const external = 'partner.editor@partner.invalid';
  const identity = { email: external.toUpperCase(), emailVerified: true };
  assert.equal(approvedIdentity(identity, external, '', external.toUpperCase(), 'example.invalid'), true);
  assert.equal(approvedIdentity(identity, external, '', '', 'example.invalid'), false);
  assert.equal(approvedIdentity(identity, external, '', 'another@partner.invalid', 'example.invalid'), false);
  assert.equal(approvedIdentity(identity, email, '', external, 'example.invalid'), false);
  assert.equal(approvedIdentity({ ...identity, emailVerified: false }, external, '', external, 'example.invalid'), false);
  assert.equal(approvedIdentity({ ...identity, email: 'other@partner.invalid' }, `${external},other@partner.invalid`, '', external, 'example.invalid'), false);
  assert.equal(approvedIdentity({ email, emailVerified: true }, email, '', '', 'example.invalid'), true);
});

test('session projection denies expired, revoked, invalid or unverified sessions', () => {
  assert.deepEqual(sessionUser(session(), email, now), { userId: 'synthetic-user', email, displayName: 'Synthetic Editor', fullName: 'Synthetic Editor' });
  const expired = session(); expired.session.expiresAt = new Date(now);
  const unverified = session(); unverified.user.emailVerified = false;
  for (const value of [null, {}, { user: session().user }, expired, unverified]) assert.equal(sessionUser(value, email, now), null);
  assert.equal(sessionUser(session(), 'another@example.invalid', now), null);
  assert.equal(sessionUser({ headers: { 'oai-authenticated-user-id': 'synthetic-user', 'oai-authenticated-user-email': email } }, email, now), null);
});

test('removing a Gmail exception immediately denies its existing session without removing the main email', () => {
  const personal = 'personal.editor@gmail.com';
  const current = session(); current.user.email = personal.toUpperCase();
  assert.equal(sessionUser(current, personal, now, personal).email, personal);
  assert.equal(sessionUser(current, personal, now, ''), null);
  assert.equal(sessionUser(current, personal, now, 'another@gmail.com'), null);
});

test('removing an external exception immediately denies its existing session while the company domain remains configured', () => {
  const external = 'partner.editor@partner.invalid';
  const current = session(); current.user.email = external.toUpperCase();
  assert.equal(sessionUser(current, external, now, '', external, 'example.invalid').email, external);
  assert.equal(sessionUser(current, external, now, '', '', 'example.invalid'), null);
  assert.equal(sessionUser(current, external, now, '', 'other@partner.invalid', 'example.invalid'), null);
});

test('authentication setup fails closed without all credentials, explicit origin, and allowlist', () => {
  assert.deepEqual(authSetupIssues(config()), []);
  assert.deepEqual(authSetupIssues({ ...config(), BETTER_AUTH_URL: 'https://recruiting.example.invalid', VERCEL: '1' }), []);
  for (const key of Object.keys(config())) assert.ok(authSetupIssues({ ...config(), [key]: '' }).includes(key));
  for (const value of ['http://recruiting.example.invalid', 'https://x.invalid/', 'http://localhost:3000/', 'https://x.invalid/path', 'https://name:pass@x.invalid', 'https://x.invalid/?evil=true', 'https://x.invalid/#part']) {
    assert.ok(authSetupIssues({ ...config(), BETTER_AUTH_URL: value }).includes('BETTER_AUTH_URL'));
  }
  assert.ok(authSetupIssues({ ...config(), VERCEL: '1' }).includes('BETTER_AUTH_URL'));
  assert.ok(authSetupIssues({ ...config(), BETTER_AUTH_SECRET: 'short' }).includes('BETTER_AUTH_SECRET'));
  assert.ok(authSetupIssues({ ...config(), GOOGLE_WORKSPACE_DOMAIN: 'https://invalid.example' }).includes('GOOGLE_WORKSPACE_DOMAIN'));
  assert.ok(!authSetupIssues({ ...config(), GOOGLE_WORKSPACE_DOMAIN: '*' }).length);
});

test('personal exceptions must be exact Gmail addresses already present in the main allowlist', () => {
  const personal = 'personal.editor@gmail.com';
  const mixed = { ...config(), RECRUITING_EDITOR_EMAILS: `${email},${personal}` };
  assert.deepEqual(authSetupIssues({ ...mixed, GOOGLE_PERSONAL_EMAILS: ` ${personal.toUpperCase()} ` }), []);
  for (const value of ['another@gmail.com', '*@gmail.com', email, 'personal.editor@googlemail.com', `${personal},bad-address`]) {
    assert.ok(authSetupIssues({ ...mixed, GOOGLE_PERSONAL_EMAILS: value }).includes('GOOGLE_PERSONAL_EMAILS'));
  }
});

test('external exceptions require exact outside-company non-Gmail addresses in the main list and an exact company domain', () => {
  const external = 'partner.editor@partner.invalid';
  const mixed = { ...config(), GOOGLE_WORKSPACE_DOMAIN: 'example.invalid', RECRUITING_EDITOR_EMAILS: `${email},${external},personal.editor@gmail.com` };
  assert.deepEqual(authSetupIssues({ ...mixed, GOOGLE_EXTERNAL_EMAILS: external.toUpperCase() }), []);
  for (const value of ['other@partner.invalid', '*@partner.invalid', email, 'personal.editor@gmail.com', `${external},bad-address`]) {
    assert.ok(authSetupIssues({ ...mixed, GOOGLE_EXTERNAL_EMAILS: value }).includes('GOOGLE_EXTERNAL_EMAILS'));
  }
  for (const domain of [undefined, '', '*', 'https://invalid.example']) {
    assert.ok(authSetupIssues({ ...mixed, GOOGLE_EXTERNAL_EMAILS: external, GOOGLE_WORKSPACE_DOMAIN: domain }).includes('GOOGLE_WORKSPACE_DOMAIN'));
  }
});

test('post-login return paths stay in this app and cannot loop through auth', () => {
  assert.equal(safeReturnPath('/#recruits'), '/#recruits');
  for (const value of [undefined, 'https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/api/auth/callback/google', '/sign-in?return_to=/', '/sign-out']) assert.equal(safeReturnPath(value), '/');
});
