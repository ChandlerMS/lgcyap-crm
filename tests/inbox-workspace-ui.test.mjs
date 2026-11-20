import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
test('full Inbox replies, retains per-thread drafts, updates status and refreshes HubSpot changes on focus', async () => {
  const { act, createElement } = require('react');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.test' });
  const before = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, flag: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/inbox-workspace-ui-');
  const wait = () => new Promise(resolve => setTimeout(resolve, 25));
  let root, sends = 0, updates = 0, status = 'OPEN', text = 'Synthetic customer question';
  try {
    await build({ entryPoints: ['app/inbox-workspace.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Inbox = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url === '/api/inbox-thread') {
        if (body.action === 'update') { updates++; status = body.operation === 'close' ? 'CLOSED' : 'OPEN'; return Response.json({ status: 'saved' }); }
        return Response.json({ threadId: body.threadId, status, archived: false, contextToken: 'synthetic' });
      }
      if (url === '/api/inbox-reply') {
        if (body.action === 'prepare') return Response.json({ threadId: body.threadId, contextToken: 'synthetic', senderLabel: 'agent@example.test', recipientLabel: 'customer@example.test', channelLabel: 'Email' });
        sends++; assert.equal(body.threadId, '101'); assert.equal(body.text, 'My synthetic reply'); return Response.json({ status: 'sent' });
      }
      if (body.threadId) return Response.json({ tool: 'inbox', status: 'available', archive: 'all', selectedThreadId: body.threadId, messages: [{ id: 'm1', text, direction: 'Incoming', createdAt: '2026-11-19T15:00:00Z' }], complete: true, continuation: null });
      return Response.json({ tool: 'inbox', status: 'available', archive: 'all', records: ['101', '102'].map(id => ({ id, title: `Conversation ${id}`, status })), complete: true, continuation: null });
    };
    root = createRoot(document.getElementById('app'));
    await act(async () => { root.render(createElement(Inbox, { onUnauthorized() { assert.fail('unexpected sign-out'); } })); await wait(); });
    const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
    const select = id => [...document.querySelectorAll('[aria-label="Conversations"] button')].find(node => node.textContent.includes(`Conversation ${id}`));
    const flush = () => act(async () => { await wait(); });
    const native = document.querySelector('a[aria-label="New message in HubSpot"]');
    assert.equal(native.href, 'https://app.hubspot.com/live-messages/50894788'); assert.equal(native.target, '_blank');
    await act(async () => select('101').click()); await flush();
    assert.match(document.body.textContent, /Synthetic customer question/);
    const type = value => { const textarea = document.querySelector('textarea'); const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set; setter.call(textarea, value); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
    await act(async () => type('My synthetic reply'));
    await act(async () => select('102').click()); await flush();
    assert.equal(document.querySelector('textarea').value, '');
    await act(async () => select('101').click()); await flush();
    assert.equal(document.querySelector('textarea').value, 'My synthetic reply');
    await act(async () => { button('Send reply').click(); await wait(); }); await flush();
    assert.equal(sends, 1); assert.equal(document.querySelector('textarea').value, '');
    await act(async () => { button('Close conversation').click(); await wait(); }); await flush();
    assert.equal(updates, 1); assert.ok(button('Reopen conversation'));
    status = 'OPEN'; text = 'Changed in HubSpot';
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); await wait(); }); await flush();
    assert.match(document.body.textContent, /Changed in HubSpot/); assert.ok(button('Close conversation'));
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = before.window; globalThis.document = before.document; globalThis.fetch = before.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = before.flag;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
