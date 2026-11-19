import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createGmailTemplateDraft, handleGmailCompose } from '../lib/gmail-compose.mjs';
const user = { userId: 'employee', email: 'agent@example.test' };
const now = 1795090000000;
const env = { VERCEL: '1', VERCEL_ENV: 'production', BETTER_AUTH_URL: 'https://crm.test', RECRUITING_EDITOR_EMAILS: user.email, BETTER_AUTH_SECRET: 's'.repeat(32) };
const target = { email: 'recruit@example.test', name: 'Synthetic Recruit', firstName: 'Synthetic', route: 'licensed', contactId: '2' };
const template = { id: 'licensed', route: 'licensed', name: 'Licensed Offer', subject: 'Your offer', fields: [], html: '<p>Hello {{firstName}}</p><img src="cid:logo">', text: 'Hello {{firstName}}', assets: [{ cid: 'logo', data: 'aGVsbG8=' }] };
const requestId = '9e283fd5-8e92-4cbe-b97f-af16cc216659';
const input = { recruitId: '1', templateId: 'licensed', subject: 'Your offer', body: '', fields: {} };
const request = body => new Request('https://crm.test/api/recruit-email', { method: 'POST', headers: { origin: 'https://crm.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function fixture(t, { failPost = false, failConfirm = false, failSave = false } = {}) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE TABLE gmail_draft_requests(user_id text,request_id text,payload_hash text NOT NULL,status text NOT NULL,draft_id text,message_id text,thread_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,request_id));`);
  const writes = [], recipient = async () => ({ ...target }); let accessCount = 0;
  const deps = { user, env, db, templates: [template], recipient, now: () => now, access: async () => { accessCount++; return { accessToken: 'synthetic-google-token', email: user.email }; }, fetchImpl: async (url, init) => {
    assert.ok(url.startsWith('https://gmail.googleapis.com/'));
    assert.equal(init.redirect, 'error');
    if (init.method === 'POST') { writes.push(JSON.parse(init.body)); if (failPost) throw Error('private provider body'); return Response.json({ id: 'r-123', message: { id: 'abc123', threadId: 'def456' } }); }
    if (failConfirm) return Response.json({}, { status: 403 });
    return Response.json({ id: 'r-123', message: { id: 'abc123', threadId: 'def456', labelIds: ['DRAFT'] } });
  } };
  if (failSave) deps.db = { query: async (sql, args) => { if (sql.includes("status='created'")) throw Error('database disconnected'); return db.query(sql, args); } };
  const handler = { ...deps, getUser: async () => user, getDb: async () => deps.db };
  const previewResponse = await handleGmailCompose(request({ ...input, action: 'preview' }), handler);
  const preview = await previewResponse.json(); assert.equal(previewResponse.status, 200);
  return { db, deps, handler, writes, preview, accessCount: () => accessCount };
}
test('preview renders branded template locally, then one confirmed Gmail draft is created and replayed without another POST', async t => {
  const s = await fixture(t); assert.match(s.preview.html, /data:image\/png;base64,aGVsbG8=/); assert.match(s.preview.html, /Hello Synthetic/);
  const draft = { ...input, previewToken: s.preview.previewToken, requestId };
  const result = await createGmailTemplateDraft(draft, s.deps);
  assert.equal(result.created, true); assert.equal(result.draftId, 'r-123'); assert.match(result.gmailUrl, /authuser=agent%40example.test#all\/def456$/);
  assert.equal((await createGmailTemplateDraft(draft, s.deps)).replayed, true); assert.equal(s.writes.length, 1);
  const mime = Buffer.from(s.writes[0].message.raw, 'base64url').toString();
  assert.match(mime, /To: recruit@example.test/); assert.match(mime, /Content-ID: <logo>/);
  assert.ok(!Object.hasOwn(s.writes[0], 'send'));
  const rows = (await s.db.query('SELECT * FROM gmail_draft_requests')).rows;
  assert.equal(rows[0].status, 'created'); assert.ok(!JSON.stringify(rows).includes(target.email)); assert.ok(!JSON.stringify(rows).includes('Hello Synthetic'));
});
test('recipient, route, content, employee or expired-preview changes block draft creation', async t => {
  const s = await fixture(t), original = { ...input, previewToken: s.preview.previewToken, requestId };
  for (const [change, deps] of [
    [{ subject: 'Changed' }, s.deps], [{ body: 'Changed' }, s.deps],
    [{}, { ...s.deps, recipient: async () => ({ ...target, email: 'other@example.test' }) }],
    [{}, { ...s.deps, user: { ...user, userId: 'other' } }],
    [{}, { ...s.deps, now: () => now + 600001 }],
  ]) await assert.rejects(createGmailTemplateDraft({ ...original, ...change }, deps), error => error.code === 'PREVIEW_CHANGED');
  await assert.rejects(createGmailTemplateDraft(original, { ...s.deps, recipient: async () => ({ ...target, route: 'not_licensed' }) }), /unavailable|licensing route/);
  assert.equal(s.writes.length, 0); assert.equal(s.accessCount(), 0);
});
test('network ambiguity, post-create permission failure and failed database confirmation never replay a draft POST', async t => {
  for (const behavior of [{ failPost: true }, { failConfirm: true }, { failSave: true }]) {
    const s = await fixture(t, behavior), draft = { ...input, previewToken: s.preview.previewToken, requestId };
    await assert.rejects(createGmailTemplateDraft(draft, s.deps), error => error.uncertain === true);
    await assert.rejects(createGmailTemplateDraft(draft, s.deps), error => error.uncertain === true);
    assert.equal(s.writes.length, 1);
    assert.equal((await s.db.query('SELECT status FROM gmail_draft_requests')).rows[0].status, 'uncertain');
  }
});
test('invalid input, unsupported send and foreign origins cannot reach Gmail or database', async () => {
  let calls = 0;
  const handler = { env, getUser: async () => user, getDb: async () => { calls++; throw Error(); }, templates: [template], recipient: async () => { calls++; return target; } };
  for (const bad of [{ action: 'send' }, { action: 'draft', ...input, requestId, previewToken: 'invalid' }, { action: 'prepare', recruitId: '1', to: 'other@example.test' }, { action: 'preview', ...input, subject: 'Hello\r\nBcc: other@example.test' }]) assert.ok((await handleGmailCompose(request(bad), handler)).status >= 400);
  const foreign = new Request('https://crm.test/api/recruit-email', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status' }) });
  assert.equal((await handleGmailCompose(foreign, handler)).status, 403);
  assert.equal((await handleGmailCompose(request({ action: 'status' }), { ...handler, getUser: async () => null })).status, 401);
  assert.equal(calls, 0);
});
test('different Gmail identity and preview deployments cannot create drafts', async t => {
  const s = await fixture(t), draft = { ...input, previewToken: s.preview.previewToken, requestId };
  await assert.rejects(createGmailTemplateDraft(draft, { ...s.deps, access: async () => ({ accessToken: 'test', email: 'other@example.test' }) }), error => error.code === 'GMAIL_ACCOUNT_MISMATCH');
  await assert.rejects(createGmailTemplateDraft(draft, { ...s.deps, env: { ...env, VERCEL_ENV: 'preview' } }), error => error.status === 403);
  assert.equal(s.writes.length, 0);
});
