import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const env = { VERCEL: '1', VERCEL_ENV: 'production', BETTER_AUTH_URL: 'https://crm.example.invalid', RECRUITING_EDITOR_EMAILS: 'editor@example.invalid' };
const user = { userId: 'employee-1', email: 'editor@example.invalid' };
const request = (input, overrides = {}) => new Request(`${env.BETTER_AUTH_URL}/api/gmail/mail`, { method: 'POST', headers: { Origin: env.BETTER_AUTH_URL, 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...overrides });
const header = (name, value) => ({ name, value });
const defaults = [header('From', 'Sender Person <sender@example.invalid>'), header('To', 'Editor <editor@example.invalid>'), header('Subject', 'A useful message'), header('Date', 'Thu, 19 Nov 2026 14:00:00 +0000')];
const message = (extra = {}) => ({ id: 'abc123', threadId: 'def456', labelIds: ['INBOX', 'UNREAD'], internalDate: '1795096800000', snippet: 'Preview &amp; more', payload: { mimeType: 'text/plain', headers: defaults, body: { data: Buffer.from('Hello there').toString('base64url'), size: 11 } }, ...extra });
const options = (fetchImpl, extra = {}) => ({ env, getUser: async () => user, getDb: async () => ({ query: () => { throw new Error('Mailbox content must not be stored'); } }), fetchImpl, access: async input => {
  assert.equal(input.requireRead, true);
  assert.equal(input.user, user);
  return { accessToken: 'synthetic-access', email: user.email };
}, ...extra });
async function handle(input, fetchImpl, extra) {
  const { handleGmailMail } = await import('../lib/gmail-mail.mjs');
  return handleGmailMail(request(input), options(fetchImpl, extra));
}
function onlyMessage(value = message()) {
  return async (url, init) => {
    assert.equal(new URL(url).origin, 'https://gmail.googleapis.com');
    assert.equal(new URL(url).pathname, '/gmail/v1/users/me/messages/abc123');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-access');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    return Response.json(value);
  };
}

test('mailbox access rejects unauthorized, cross-origin and nonproduction requests before credentials or provider access', async () => {
  const { handleGmailMail } = await import('../lib/gmail-mail.mjs');
  let touched = 0;
  const forbidden = () => { touched++; throw new Error('Must not access a mailbox'); };
  const base = { env, getUser: async () => user, getDb: forbidden, access: forbidden, fetchImpl: forbidden };
  assert.equal((await handleGmailMail(request({ action: 'list', folder: 'inbox' }), { ...base, getUser: async () => null })).status, 401);
  assert.equal((await handleGmailMail(request({ action: 'list', folder: 'inbox' }), { ...base, getUser: async () => ({ ...user, email: 'outsider@example.invalid' }) })).status, 403);
  assert.equal((await handleGmailMail(request({ action: 'list', folder: 'inbox' }, { headers: { Origin: 'https://evil.example.invalid', 'Content-Type': 'application/json' } }), base)).status, 403);
  assert.equal((await handleGmailMail(new Request('https://evil.example.invalid/api/gmail/mail', { method: 'POST', headers: { Origin: env.BETTER_AUTH_URL, 'Content-Type': 'application/json' }, body: '{}' }), base)).status, 403);
  for (const disabled of [{ VERCEL: undefined }, { VERCEL_ENV: 'preview' }]) assert.equal((await handleGmailMail(request({ action: 'list', folder: 'inbox' }), { ...base, env: { ...env, ...disabled } })).status, 403);
  assert.equal((await handleGmailMail(new Request(`${env.BETTER_AUTH_URL}/api/gmail/mail`), base)).status, 405);
  assert.equal(touched, 0);
});

test('mailbox JSON input accepts exact actions, bounded safe tokens and hex message IDs only', async () => {
  const { handleGmailMail } = await import('../lib/gmail-mail.mjs');
  let touched = 0;
  const forbidden = () => { touched++; throw new Error('Invalid input must not read credentials'); };
  const base = { env, getUser: async () => user, getDb: forbidden, access: forbidden, fetchImpl: forbidden };
  for (const input of [null, [], {}, { action: 'send' }, { action: 'list', folder: 'drafts' }, { action: 'list', folder: 'inbox', url: 'https://evil.invalid' }, { action: 'list', folder: 'inbox', pageToken: '' }, { action: 'list', folder: 'inbox', pageToken: 'a\r\nb' }, { action: 'list', folder: 'inbox', pageToken: 'x'.repeat(2049) }, { action: 'read', messageId: '../abc' }, { action: 'read', messageId: 'f'.repeat(41) }, { action: 'read', messageId: 'abc123', email: 'someone@example.invalid' }]) {
    assert.equal((await handleGmailMail(request(input), base)).status, 400);
  }
  assert.equal((await handleGmailMail(request({}, { body: '{broken' }), base)).status, 400);
  assert.equal((await handleGmailMail(request({}, { body: 'x'.repeat(4097) }), base)).status, 413);
  assert.equal((await handleGmailMail(request({}, { headers: { Origin: env.BETTER_AUTH_URL, 'Content-Type': 'application/jsonp' } }), base)).status, 415);
  assert.equal(touched, 0);
});

test('inbox page reads ten messages in order with at most four parallel metadata requests and no provider writes', async () => {
  let active = 0, maxActive = 0, metadataReads = 0, verified = false;
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aa'];
  const fetchImpl = async (url, init) => {
    assert.equal(verified, true);
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://gmail.googleapis.com');
    assert.ok(parsed.pathname.startsWith('/gmail/v1/users/me/messages'));
    if (parsed.pathname.endsWith('/messages')) {
      assert.equal(parsed.searchParams.get('labelIds'), 'INBOX');
      assert.equal(parsed.searchParams.get('maxResults'), '10');
      return Response.json({ messages: ids.map(id => ({ id, threadId: 'def456' })), nextPageToken: 'next-page_123', resultSizeEstimate: 30 });
    }
    metadataReads++;
    assert.equal(parsed.searchParams.get('format'), 'metadata');
    assert.ok(parsed.searchParams.getAll('metadataHeaders').includes('Subject'));
    active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return Response.json(message({ id: parsed.pathname.split('/').at(-1) }));
  };
  const response = await handle({ action: 'list', folder: 'inbox' }, fetchImpl, { access: async input => { assert.equal(input.requireRead, true); verified = true; return { accessToken: 'synthetic-access', email: user.email }; } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.match(response.headers.get('vary'), /Cookie/);
  const body = await response.json();
  assert.deepEqual(body.messages.map(row => row.id), ids);
  assert.equal(metadataReads, 10);
  assert.equal(maxActive, 4);
  assert.equal(body.nextPageToken, 'next-page_123');
  assert.deepEqual(body.messages[0], { id: 'a1', threadId: 'def456', from: 'Sender Person <sender@example.invalid>', to: 'Editor <editor@example.invalid>', subject: 'A useful message', date: '2026-11-19T14:00:00.000Z', snippet: 'Preview & more', unread: true });
  assert.equal(JSON.stringify(body).includes('synthetic-access'), false);
});

test('sent pagination URL-encodes provider tokens and valid empty inboxes return an explicit terminal page', async () => {
  let reads = 0;
  const response = await handle({ action: 'list', folder: 'sent', pageToken: 'A+/=._-' }, async url => {
    reads++;
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('labelIds'), 'SENT');
    assert.equal(parsed.searchParams.get('pageToken'), 'A+/=._-');
    return Response.json({ resultSizeEstimate: 0 });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { messages: [], nextPageToken: null });
  assert.equal(reads, 1);
});

test('partial metadata and provider failures return actionable fixed errors without claiming an empty mailbox', async () => {
  for (const [status, expected] of [[401, 403], [403, 403], [404, 404], [429, 429], [503, 502]]) {
    const response = await handle({ action: 'list', folder: 'inbox' }, async url => new URL(url).pathname.endsWith('/messages')
      ? Response.json({ messages: [{ id: 'abc123', threadId: 'def456' }], resultSizeEstimate: 1 })
      : Response.json({ error: { message: 'sensitive provider token and mailbox data' } }, { status }));
    assert.equal(response.status, expected);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.match(body.code, /^GMAIL_/);
    assert.equal(body.messages, undefined);
    assert.equal(JSON.stringify(body).includes('sensitive'), false);
  }
});

test('malformed or repeated provider pagination and mismatched message identities never silently truncate a page', async () => {
  for (const value of [
    {}, { resultSizeEstimate: 3 }, { messages: null, resultSizeEstimate: 0 }, { messages: [], nextPageToken: 'next', resultSizeEstimate: 3 },
    { messages: [{ id: '../bad', threadId: 'def456' }] },
    { messages: [{ id: 'abc123', threadId: 'def456' }, { id: 'abc123', threadId: 'def456' }] },
    { messages: Array.from({ length: 11 }, (_, i) => ({ id: (i + 1).toString(16), threadId: 'def456' })) },
    { messages: [{ id: 'abc123', threadId: 'def456' }], nextPageToken: 'bad&token' },
  ]) {
    const response = await handle({ action: 'list', folder: 'inbox' }, async () => Response.json(value));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).messages, undefined);
  }
  const mismatch = await handle({ action: 'list', folder: 'inbox' }, async url => new URL(url).pathname.endsWith('/messages') ? Response.json({ messages: [{ id: 'abc123', threadId: 'def456' }] }) : Response.json(message({ id: 'ffff' })));
  assert.equal(mismatch.status, 502);
  const repeated = await handle({ action: 'list', folder: 'inbox', pageToken: 'same-token' }, async () => Response.json({ messages: [{ id: 'abc123', threadId: 'def456' }], nextPageToken: 'same-token' }));
  assert.equal(repeated.status, 502);
});

test('read decodes nested MIME, omits attachments, and sanitizes active markup, remote images and unsafe styles', async () => {
  const html = '<html><head><style>body{background:url(https://tracker.invalid)}</style></head><body onload="steal()"><p style="font-weight:bold;position:fixed;background-image:url(https://tracker.invalid)">Hello <strong>friend</strong> &amp; team</p><img src="https://tracker.invalid/pixel"><img src="data:image/svg+xml,x"><script>secret()</script><iframe srcdoc="steal()"></iframe><object data="x"></object><form action="https://bad.invalid"><input name="secret"></form><svg onload="steal()"></svg><a href="javascript:steal()">Bad link</a><a href="https://example.invalid">Good link</a></body></html>';
  const value = message({ payload: { mimeType: 'multipart/mixed', headers: defaults, parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Hello friend & team').toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } }] }, { mimeType: 'text/plain', filename: 'secret.txt', body: { data: Buffer.from('ATTACHMENT SECRET').toString('base64url'), attachmentId: 'attachment-1' } }, { mimeType: 'message/rfc822', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('FORWARDED ATTACHMENT SECRET').toString('base64url') } }] }] } });
  const response = await handle({ action: 'read', messageId: 'abc123' }, onlyMessage(value));
  assert.equal(response.status, 200);
  const { message: result } = await response.json();
  assert.equal(result.text, 'Hello friend & team');
  assert.equal(result.canReply, true);
  assert.equal(result.date, '2026-11-19T14:00:00.000Z');
  const document = new JSDOM(result.html).window.document;
  assert.equal(document.querySelectorAll('script,style,img,iframe,object,form,input,svg,link,meta').length, 0);
  assert.equal(document.querySelector('[onload],[onclick],[srcdoc]'), null);
  assert.equal(document.querySelector('p').style.fontWeight, 'bold');
  assert.equal(document.querySelector('p').style.position, '');
  assert.equal(document.querySelector('p').style.backgroundImage, '');
  assert.equal(document.querySelector('a').getAttribute('href'), null);
  assert.equal(document.querySelectorAll('a')[1].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(result.html.includes('ATTACHMENT SECRET'), false);
  assert.equal(result.html.includes('tracker.invalid'), false);
  assert.deepEqual(Object.keys(result).sort(), ['canReply', 'date', 'from', 'html', 'id', 'subject', 'text', 'threadId', 'to']);
});

test('plain and HTML-only messages have readable safe fallbacks and honor supported text charsets', async () => {
  const plain = await handle({ action: 'read', messageId: 'abc123' }, onlyMessage());
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).message.html, '');
  const latin = message({ payload: { mimeType: 'text/plain', headers: [...defaults, header('Content-Type', 'text/plain; charset=iso-8859-1')], body: { data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64url') } } });
  assert.equal((await (await handle({ action: 'read', messageId: 'abc123' }, onlyMessage(latin))).json()).message.text, 'café');
  const html = message({ payload: { mimeType: 'text/html', headers: defaults, body: { data: Buffer.from('<p>Hello &amp; goodbye</p><script>secret()</script>').toString('base64url') } } });
  const result = (await (await handle({ action: 'read', messageId: 'abc123' }, onlyMessage(html))).json()).message;
  assert.equal(result.text.trim(), 'Hello & goodbye');
});

test('oversized, deeply nested and malformed MIME fails safely instead of returning incomplete content', async () => {
  const deep = { mimeType: 'multipart/mixed', parts: [] }; let cursor = deep;
  for (let i = 0; i < 15; i++) { const part = { mimeType: 'multipart/mixed', parts: [] }; cursor.parts.push(part); cursor = part; }
  const cases = [
    { mimeType: 'text/plain', body: { data: Buffer.alloc(600000, 0x61).toString('base64url') } },
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.alloc(300000, 0x61).toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.alloc(300000, 0x62).toString('base64url') } }] },
    deep,
    { mimeType: 'multipart/mixed', parts: Array.from({ length: 101 }, () => ({ mimeType: 'text/plain', body: { data: 'YQ' } })) },
    { mimeType: 'text/plain', body: { data: '%%%invalid' } },
    { mimeType: 'text/plain', body: { attachmentId: 'missing-body' } },
  ];
  for (const payload of cases) {
    const response = await handle({ action: 'read', messageId: 'abc123' }, onlyMessage(message({ payload: { headers: defaults, ...payload } })));
    assert.ok(response.status >= 400);
    const body = await response.json();
    assert.match(body.code, /^GMAIL_/);
    assert.equal(body.message, undefined);
  }
  const oversizedResponse = await handle({ action: 'read', messageId: 'abc123' }, async () => new Response('x'.repeat(2100000)));
  assert.equal(oversizedResponse.status, 413);
});

test('reply target is read from own verified mailbox, prefers a sole Reply-To and carries only valid threading metadata', async () => {
  const { readReplyTarget } = await import('../lib/gmail-mail.mjs');
  const headers = [...defaults, header('Reply-To', 'Reply Person <reply@example.invalid>'), header('Message-ID', '<current@example.invalid>'), header('References', '<first@example.invalid> <second@example.invalid>')];
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).searchParams.get('format'), 'metadata');
    assert.ok(new URL(url).searchParams.getAll('metadataHeaders').includes('Reply-To'));
    return onlyMessage(message({ payload: { headers } }))(url, init);
  };
  const result = await readReplyTarget('abc123', { user, env, db: {}, access: options(fetchImpl).access, fetchImpl });
  assert.deepEqual(result, { email: 'reply@example.invalid', name: 'Reply Person', firstName: 'Reply', route: 'unknown', subject: 'Re: A useful message', threadId: 'def456', rfcMessageId: '<current@example.invalid>', references: '<first@example.invalid> <second@example.invalid>' });
});

test('empty subjects retain their reply semantics instead of inserting display placeholder text', async () => {
  const { readReplyTarget } = await import('../lib/gmail-mail.mjs');
  const headers = defaults.filter(value => value.name !== 'Subject');
  const result = await readReplyTarget('abc123', { user, env, db: {}, access: options().access, fetchImpl: onlyMessage(message({ payload: { headers } })) });
  assert.equal(result.subject, 'Re:');
});

test('replying to Sent uses the sole To recipient and does not add a second reply subject prefix', async () => {
  const { readReplyTarget } = await import('../lib/gmail-mail.mjs');
  const headers = [header('From', 'Editor <editor@example.invalid>'), header('To', '"Person, Reply" <REPLY@example.invalid>'), header('Reply-To', 'alias@example.invalid'), header('Subject', 'RE: Re: Existing subject')];
  const result = await readReplyTarget('abc123', { user, env, db: {}, access: options().access, fetchImpl: onlyMessage(message({ labelIds: ['SENT'], payload: { headers } })) });
  assert.equal(result.email, 'reply@example.invalid');
  assert.equal(result.name, 'Person, Reply');
  assert.equal(result.subject, 'Re: Existing subject');
});

test('ambiguous or no-reply recipients disable reply, and unsafe threading header values are omitted', async () => {
  const { readReplyTarget } = await import('../lib/gmail-mail.mjs');
  for (const headers of [
    [header('From', 'a@example.invalid, b@example.invalid')],
    [header('From', 'noreply@example.invalid')],
    [...defaults, header('Reply-To', 'a@example.invalid, b@example.invalid')],
    [...defaults, header('Reply-To', 'no-reply@example.invalid')],
    [header('From', user.email), header('To', 'a@example.invalid, b@example.invalid')],
    [...defaults, header('From', 'other@example.invalid')],
    [...defaults, header('Reply-To', 'person@example.invalid\r\nBcc: other@example.invalid')],
  ]) {
    const fetchImpl = onlyMessage(message({ payload: { mimeType: 'text/plain', headers, body: { data: 'SGVsbG8' } } }));
    const response = await handle({ action: 'read', messageId: 'abc123' }, fetchImpl);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message.canReply, false);
    await assert.rejects(readReplyTarget('abc123', { user, env, db: {}, access: options().access, fetchImpl }), { code: 'GMAIL_REPLY_UNAVAILABLE' });
  }
  const headers = [...defaults, header('Message-ID', '<valid@example.invalid>\r\nBcc: secret@example.invalid'), header('References', '<valid@example.invalid> untrusted')];
  const result = await readReplyTarget('abc123', { user, env, db: {}, access: options().access, fetchImpl: onlyMessage(message({ payload: { headers } })) });
  assert.equal(result.rfcMessageId, undefined);
  assert.equal(result.references, undefined);
});

test('mailbox account mismatch is rejected before any message read and credentials failures expose only fixed messages', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('Must not read another mailbox'); };
  const response = await handle({ action: 'read', messageId: 'abc123' }, fetchImpl, { access: async () => ({ accessToken: 'synthetic-access', email: 'other@example.invalid' }) });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
  const failed = await handle({ action: 'list', folder: 'inbox' }, fetchImpl, { access: async () => { throw Object.assign(new Error('secret token/provider error'), { code: 'GMAIL_READ_PERMISSION_REQUIRED', status: 403 }); } });
  assert.equal(failed.status, 403);
  assert.equal((await failed.text()).includes('secret'), false);
  assert.equal(calls, 0);
});
