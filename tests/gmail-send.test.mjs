import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { GMAIL_SCHEMA } from '../db/gmail.mjs';
import { handleGmailCompose } from '../lib/gmail-compose.mjs';
const user = { userId: 'editor', email: 'staff@example.test' };
const env = { VERCEL: '1', VERCEL_ENV: 'production', BETTER_AUTH_URL: 'https://crm.test', BETTER_AUTH_SECRET: 's'.repeat(32), RECRUITING_EDITOR_EMAILS: user.email };
const input = { recruitId: '1', templateId: 'licensed', subject: 'Your offer', body: '', fields: {} };
const requestId = '9e283fd5-8e92-4cbe-b97f-af16cc216659';
const target = { email: 'recruit@example.test', name: 'Recruit', firstName: 'Pat', route: 'licensed' };
const template = { id: 'licensed', name: 'Licensed Offer', route: 'licensed', subject: 'Your offer', fields: [], html: '<p>Hello {{firstName}}</p><img src="cid:logo">', text: 'Hello {{firstName}}', assets: [{ cid: 'logo', data: 'aGVsbG8=' }] };
const request = body => new Request('https://crm.test/api/recruit-email', { method: 'POST', headers: { origin: 'https://crm.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function fixture(t, mode = '') {
  const db = new PGlite(); await db.exec(GMAIL_SCHEMA); t.after(() => db.close());
  const posts = []; let changed = false;
  const deps = { env, getUser: async () => user, getDb: async () => db, templates: [template], now: () => 1795090000000,
    recipient: async () => ({ ...target, ...(changed ? { email: 'changed@example.test' } : {}) }),
    replyTarget: async () => ({ email: 'sender@example.test', name: 'Sender', firstName: 'Sender', route: 'unknown', subject: 'Re: Appointment', threadId: 'abcdef', rfcMessageId: '<original@example.test>', references: '<previous@example.test>' }),
    access: async options => { assert.equal(options.requireRead, true); return { accessToken: 'synthetic', email: user.email }; },
    fetchImpl: async (url, init) => {
      assert.ok(url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/'));
      if (init.method === 'POST') {
        assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
        posts.push(JSON.parse(init.body));
        if (mode === 'timeout') throw Error('private provider details');
        if (mode === 'reject') return Response.json({ private: 'provider details' }, { status: 403 });
        return Response.json({ id: '123abc', threadId: 'abcdef', labelIds: ['SENT'] });
      }
      if (mode === 'confirm') return Response.json({}, { status: 403 });
      return Response.json({ id: '123abc', threadId: 'abcdef', labelIds: ['SENT'] });
    } };
  if (mode === 'save') deps.getDb = async () => ({ query: async (sql, args) => { if (sql.includes("status='sent'")) throw Error('database disconnected'); return db.query(sql, args); } });
  const call = async body => { const response = await handleGmailCompose(request(body), deps); return { response, data: await response.json() }; };
  const preview = await call({ action: 'preview', ...input }); assert.equal(preview.response.status, 200);
  return { call, posts, db, deps, preview: preview.data, change: () => { changed = true; } };
}
test('explicit in-app Send uses the previewed HTML and logo, confirms SENT and replays without a second delivery', async t => {
  const s = await fixture(t);
  const payload = { action: 'send', ...input, requestId, previewToken: s.preview.previewToken };
  const result = await s.call(payload);
  assert.equal(result.response.status, 200, result.data.error);
  assert.equal(result.data.sent, true); assert.equal(result.data.messageId, '123abc'); assert.equal(result.data.gmailUrl, undefined);
  assert.equal((await s.call(payload)).data.replayed, true); assert.equal(s.posts.length, 1);
  const mime = Buffer.from(s.posts[0].raw, 'base64url').toString();
  assert.match(mime, /To: recruit@example.test/); assert.match(mime, /Content-ID: <logo>/);
  assert.equal((await s.db.query('SELECT status FROM gmail_send_requests')).rows[0].status, 'sent');
  assert.ok(!JSON.stringify((await s.db.query('SELECT * FROM gmail_send_requests')).rows).includes(target.email));
});
test('uncertain send transport, confirmation and ledger results cannot automatically send again', async t => {
  for (const mode of ['timeout', 'confirm', 'save']) {
    const s = await fixture(t, mode), payload = { action: 'send', ...input, requestId, previewToken: s.preview.previewToken };
    for (let i=0;i<2;i++) { const result = await s.call(payload); assert.equal(result.data.code, 'SEND_UNCERTAIN'); assert.equal(result.data.uncertain, true); assert.ok(!result.data.error.includes('private')); }
    assert.equal(s.posts.length, 1);
  }
});
test('fresh recipient and preview authorization must still match before sending', async t => {
  const s = await fixture(t), payload = { action: 'send', ...input, requestId, previewToken: s.preview.previewToken };
  assert.equal((await s.call({ ...payload, subject: 'Unreviewed' })).data.code, 'PREVIEW_CHANGED');
  s.change(); assert.equal((await s.call(payload)).data.code, 'PREVIEW_CHANGED'); assert.equal(s.posts.length, 0);
  for (const bad of [{ ...payload, to: 'unverified@example.test' }, { ...payload, subject: 'X\r\nBcc: bad@example.test' }, { ...payload, replyMessageId: 'abcdef' }]) assert.ok((await s.call(bad)).response.status >= 400);
  assert.equal(s.posts.length, 0);
});
test('replies resolve their recipient from the mailbox and send RFC reply headers on the original Gmail thread', async t => {
  const s = await fixture(t), reply = { replyMessageId: 'abc123', templateId: '', subject: 'Re: Appointment', body: 'Confirmed, thank you.', fields: {} };
  const prepared = await s.call({ action: 'prepare', replyMessageId: 'abc123' });
  assert.equal(prepared.response.status, 200, prepared.data.error); assert.equal(prepared.data.recipient.email, 'sender@example.test'); assert.equal(prepared.data.subject, 'Re: Appointment');
  const preview = await s.call({ action: 'preview', ...reply }); assert.equal(preview.response.status, 200, preview.data.error);
  const result = await s.call({ action: 'send', ...reply, requestId, previewToken: preview.data.previewToken });
  assert.equal(result.data.sent, true, result.data.error); assert.equal(s.posts[0].threadId, 'abcdef');
  const mime = Buffer.from(s.posts[0].raw, 'base64url').toString();
  assert.match(mime, /To: sender@example.test/); assert.match(mime, /In-Reply-To: <original@example.test>/); assert.match(mime, /References: <previous@example.test>\r\n <original@example.test>/);
});
test('rejected provider sends stay distinguishable from uncertain delivery and remain protected against replay', async t => {
  const s = await fixture(t, 'reject'), payload = { action: 'send', ...input, requestId, previewToken: s.preview.previewToken };
  const first = await s.call(payload); assert.equal(first.response.status, 403); assert.equal(first.data.uncertain, false);
  assert.equal((await s.call(payload)).data.code, 'SEND_UNCERTAIN'); assert.equal(s.posts.length, 1);
});
test('simultaneous delivery requests share one durable send claim', async t => {
  const s = await fixture(t), payload = { action: 'send', ...input, requestId, previewToken: s.preview.previewToken };
  const results = await Promise.all([s.call(payload), s.call(payload)]);
  assert.equal(s.posts.length, 1);
  assert.ok(results.some(result => result.data.sent === true));
  assert.ok(results.every(result => result.data.sent === true || result.data.code === 'SEND_UNCERTAIN'));
});
test('the composer prepares, previews and sends a reply through the real mailbox target resolver', async t => {
  const s = await fixture(t), delivery = s.deps.fetchImpl;
  delete s.deps.replyTarget;
  s.deps.fetchImpl = async (url, init) => String(url).includes('format=metadata') ? Response.json({
    id: 'abc123', threadId: 'abcdef', payload: { headers: [
      { name: 'From', value: 'Sender <sender@example.test>' }, { name: 'To', value: user.email },
      { name: 'Subject', value: 'A'.repeat(250) }, { name: 'Message-ID', value: '<original@example.test>' },
    ] },
  }) : delivery(url, init);
  const prepared = await s.call({ action: 'prepare', replyMessageId: 'abc123' });
  assert.equal(prepared.data.recipient.email, 'sender@example.test');
  assert.equal(prepared.data.subject, 'Re: ' + 'A'.repeat(250));
  const reply = { replyMessageId: 'abc123', subject: prepared.data.subject, templateId: '', fields: {}, body: 'Thank you.' };
  const preview = await s.call({ action: 'preview', ...reply });
  const result = await s.call({ action: 'send', ...reply, requestId, previewToken: preview.data.previewToken });
  assert.equal(result.data.sent, true, result.data.error);
  assert.equal(s.posts[0].threadId, 'abcdef');
  assert.match(Buffer.from(s.posts[0].raw, 'base64url').toString(), /References: <original@example.test>/);
});

test('another UUID cannot deliver while an earlier send outcome is unresolved', async t => {
  const s = await fixture(t, 'timeout'), payload = { action: 'send', ...input, requestId, previewToken: s.preview.previewToken };
  assert.equal((await s.call(payload)).data.code, 'SEND_UNCERTAIN');
  assert.equal((await s.call({ ...payload, requestId: '6e283fd5-8e92-4cbe-b97f-af16cc216659' })).data.code, 'SEND_UNCERTAIN');
  assert.equal(s.posts.length, 1);
});
test('acknowledging a missing operation prevents its delayed original request from delivering', async t => {
  const s = await fixture(t);
  const { handleGmailConnection } = await import('../lib/gmail-connection.mjs');
  const acknowledgment = new Request('https://crm.test/api/gmail', { method: 'POST', headers: { origin: env.BETTER_AUTH_URL, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'acknowledge-send', requestId }) });
  assert.equal((await handleGmailConnection(acknowledgment, s.deps)).status, 200);
  const late = await s.call({ action: 'send', ...input, requestId, previewToken: s.preview.previewToken });
  assert.equal(late.data.code, 'REQUEST_ID_REUSED'); assert.equal(s.posts.length, 0);
});
