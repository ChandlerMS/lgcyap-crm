import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

async function panel(run, respond = () => null) {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/private-email-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.invalid/#email' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const requests = []; let root, connected = true;
  const row = (id, subject) => ({ id, threadId: 'aa', from: 'Sender <sender@example.test>', to: 'staff@example.test', subject, date: '2026-11-19T10:00:00Z', snippet: 'Preview of the message', unread: true });
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; requests.push({ url, body });
    const custom = await respond({ url, body }); if (custom) return custom;
    if (url === '/api/gmail') { if (body?.action === 'disconnect') { connected = false; return Response.json({ disconnected: true }); } return Response.json({ available: true, connected, canRead: connected, email: 'staff@example.test' }); }
    if (url === '/api/recruit-email') return Response.json(body.action === 'status' ? { sender: 'staff@example.test', available: true, templates: [] } : { recipient: { name: 'Sender', email: 'sender@example.test' }, templates: [], subject: 'Re: Inbox message' });
    assert.equal(url, '/api/gmail/mail', 'the mailbox uses only the account-bound Gmail API');
    if (body.action === 'list') return Response.json({ messages: body.folder === 'sent' ? [row('cc', 'Sent message')] : body.pageToken ? [row('bb', 'Older inbox message')] : [row('aa', 'Inbox message')], nextPageToken: body.folder === 'inbox' && !body.pageToken ? 'next-page' : null });
    return Response.json({ message: { ...row(body.messageId, body.messageId === 'cc' ? 'Sent message' : 'Inbox message'), html: '<p>Complete message body</p><img src="https://tracker.example.test/pixel">', text: 'Plain complete message body', canReply: body.messageId !== 'cc' } });
  };
  try {
    await writeFile(`${dir}/entry.tsx`, `export {default as Panel} from '../../app/private-email-panel'; export {RecruitEmailProvider} from '../../app/recruit-email';`);
    await build({ entryPoints: [`${dir}/entry.tsx`], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const { Panel, RecruitEmailProvider } = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`);
    root = createRoot(document.getElementById('app'));
    const render = async (props = {}) => act(async () => root.render(h(RecruitEmailProvider, { recruits: [], disabled: Boolean(props.disabled) }, h(Panel, props))));
    const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
    const click = async label => { const item = button(label); assert.ok(item, `button ${label} exists`); await act(async () => item.click()); };
    await run({ render, requests, click, button, dom });
  } finally {
    if (root) await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
}

test('Gmail stays in app with inbox, sent, paging, a protected reader and Reply', async () => {
  await panel(async ui => {
    await ui.render();
    assert.match(document.body.textContent, /staff@example.test|Inbox message/);
    assert.equal(document.querySelector('a[href*="mail.google.com"]'), null);
    await ui.click('Older messages'); assert.match(document.body.textContent, /Older inbox message/);
    assert.equal(ui.requests.at(-1).body.pageToken, 'next-page');
    await ui.click('Newer messages'); assert.match(document.body.textContent, /Inbox message/);
    await ui.click('Read Inbox message');
    const frame = document.querySelector('iframe[title="Email message"]');
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.match(frame.getAttribute('srcdoc'), /Complete message body/);
    assert.match(frame.getAttribute('srcdoc'), /img-src data:/);
    assert.doesNotMatch(frame.getAttribute('srcdoc'), /img-src[^;]*https:/);
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    await ui.click('Reply');
    assert.equal(document.querySelector('dialog').open, true);
    assert.ok(ui.requests.some(item => item.body?.action === 'prepare' && item.body.replyMessageId === 'aa'));
    await ui.click('Close email'); await ui.click('Sent');
    assert.match(document.body.textContent, /Sent message/);
    assert.equal(document.querySelector('iframe[title="Email message"]'), null);
    await ui.click('Read Sent message'); assert.equal(ui.button('Reply'), undefined);
    await ui.click('Disconnect Gmail'); assert.ok(ui.button('Connect Gmail'));
    assert.equal(document.querySelector('[aria-label="Gmail mailbox"]'), null);
    assert.equal(ui.requests.filter(item => item.body?.action === 'disconnect').length, 1);
    assert.equal(document.querySelector('a[href*="mail.google.com"]'), null);
  });
});

test('old compose-only connections need reconnect and hidden or demo panels never fetch', async () => {
  await panel(async ui => {
    await ui.render({ active: false }); assert.equal(ui.requests.length, 0);
    await ui.render({ disabled: true }); assert.equal(ui.requests.length, 0);
    await ui.render();
    assert.ok(ui.button('Reconnect Gmail'));
    assert.match(document.body.textContent, /inbox access/i);
    assert.equal(ui.requests.some(item => item.url === '/api/gmail/mail'), false);
    ui.dom.window.history.replaceState(null, '', '/?gmail=error#email');
    await ui.click('Check connection'); assert.match(document.body.textContent, /authorization was not completed/);
  }, ({ url }) => url === '/api/gmail' ? Response.json({ available: true, connected: true, canRead: false, email: 'staff@example.test' }) : null);
});

test('folder changes discard a late message read', async () => {
  let finishRead;
  await panel(async ui => {
    await ui.render();
    await act(async () => ui.button('Read Inbox message').click());
    await ui.click('Sent');
    await act(async () => finishRead(Response.json({ message: { id: 'aa', threadId: 'aa', from: 'Old sender', to: 'staff@example.test', subject: 'Stale private message', text: 'Old private body', html: '<p>Stale private body</p>', canReply: true } })));
    assert.match(document.body.textContent, /Sent message/);
    assert.doesNotMatch(document.body.textContent, /Stale private/);
    assert.equal(document.querySelector('iframe'), null);
  }, ({ body }) => body?.action === 'read' ? new Promise(resolve => { finishRead = resolve; }) : null);
});

test('refreshing connection for another account removes previous messages and pending reads', async () => {
  let email = 'staff@example.test', finishRead;
  await panel(async ui => {
    await ui.render();
    await act(async () => ui.button('Read Inbox message').click());
    email = 'other@example.test'; await ui.render({ refreshKey: 1 });
    await act(async () => finishRead(Response.json({ message: { id: 'aa', threadId: 'aa', from: 'Old sender', to: 'staff@example.test', subject: 'Old employee message', text: 'Old body', html: '', canReply: true } })));
    assert.match(document.body.textContent, /other@example.test/);
    assert.doesNotMatch(document.body.textContent, /Old employee message|Old body/);
    assert.equal(document.querySelector('iframe'), null);
  }, ({ url, body }) => url === '/api/gmail' ? Response.json({ available: true, connected: true, canRead: true, email }) : body?.action === 'read' ? new Promise(resolve => { finishRead = resolve; }) : null);
});

test('unavailable production setup exposes no mailbox or connection actions', async () => {
  await panel(async ui => { await ui.render(); assert.match(document.body.textContent, /not enabled/); assert.equal(document.querySelector('.gmail-inapp-email a, .gmail-inapp-email button'), null); assert.equal(ui.requests.length, 1); }, ({ url }) => url === '/api/gmail' ? Response.json({ available: false, connected: false, canRead: false, email: 'staff@example.test' }) : null);
});


test('selecting the current folder reloads it without leaving the message list empty', async () => {
  await panel(async ui => { await ui.render(); await ui.click('Inbox'); assert.match(document.body.textContent, /Inbox message/); assert.equal(ui.requests.filter(item => item.body?.action === 'list').length, 2); });
});

test('a failed message read can be retried explicitly and plain text remains readable', async () => {
  let reads = 0;
  await panel(async ui => {
    await ui.render(); await ui.click('Read Inbox message'); assert.match(document.body.textContent, /Temporary read error/);
    await ui.click('Read Inbox message'); assert.match(document.body.textContent, /Complete plain text reply/);
    assert.equal(document.querySelector('iframe'), null); assert.equal(reads, 2);
  }, ({ body }) => {
    if (body?.action !== 'read') return null;
    reads++;
    return reads === 1 ? Response.json({ error: 'Temporary read error' }, { status: 503 }) : Response.json({ message: { id: 'aa', threadId: 'aa', from: 'Sender', to: 'staff@example.test', subject: 'Inbox message', date: null, text: 'Complete plain text reply', html: '', canReply: true } });
  });
});


test('folder changes discard a late inbox listing', async () => {
  let finishInbox;
  await panel(async ui => {
    await ui.render(); await ui.click('Sent');
    await act(async () => finishInbox(Response.json({ messages: [{ id: 'ff', threadId: 'ff', from: 'Old inbox sender', to: 'staff@example.test', subject: 'Stale inbox row', date: null, snippet: '', unread: false }], nextPageToken: null })));
    assert.match(document.body.textContent, /Sent message/); assert.doesNotMatch(document.body.textContent, /Stale inbox row/);
    assert.equal(document.querySelector('[aria-label="Gmail folders"] [aria-pressed="true"]').textContent, 'Sent');
  }, ({ body }) => body?.action === 'list' && body.folder === 'inbox' ? new Promise(resolve => { finishInbox = resolve; }) : null);
});
