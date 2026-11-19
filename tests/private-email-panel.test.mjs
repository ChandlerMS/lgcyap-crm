import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

test('received Email opens the employee Gmail inbox and manages only the Gmail draft connection', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/private-email-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.invalid/#email' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let root, connected = true, available = true; const requests = [];
  try {
    await build({ entryPoints: ['app/private-email-panel.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Panel = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
      assert.equal(url, '/api/gmail', 'the Email panel never requests a HubSpot mailbox or message list');
      if (options.method === 'POST') { assert.equal(JSON.parse(options.body).action, 'disconnect'); connected = false; return Response.json({ disconnected: true }); }
      return Response.json({ available, connected, email: 'staff@example.test', inboxUrl: 'https://mail.google.com/mail/u/staff@example.test/#inbox', draftsUrl: 'https://mail.google.com/mail/u/staff@example.test/#drafts' });
    };
    const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label);
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(Panel)));
    assert.match(document.body.textContent, /staff@example.test/);
    assert.match(document.body.textContent, /includes sending/);
    const inbox = document.querySelector('a[href$="#inbox"]'); assert.equal(inbox.textContent, 'Open Gmail inbox'); assert.equal(inbox.target, '_blank');
    assert.ok(document.querySelector('a[href$="#drafts"]'));
    assert.doesNotMatch(document.body.textContent, /HubSpot|Conversations Inbox|Google authorization required/);
    assert.equal(document.querySelector('table'), null);
    await act(async () => button('Disconnect Gmail drafts').click());
    assert.ok(button('Connect Gmail drafts'));
    assert.equal(requests.filter(item => item.body?.action === 'disconnect').length, 1);
    dom.window.history.replaceState(null, '', '/?gmail=error#email');
    await act(async () => button('Check connection').click());
    assert.match(document.body.textContent, /Gmail authorization was not completed/);
    assert.ok(button('Connect Gmail drafts'), 'a failed consent callback gives an explicit recovery action');
    available = false;
    await act(async () => button('Check connection').click());
    assert.match(document.body.textContent, /not enabled/i);
    assert.equal(document.querySelector('a,button'), null, 'disabled production setup provides no mail actions');
    const before = requests.length;
    await act(async () => root.render(h(Panel, { disabled: true })));
    assert.match(document.body.textContent, /demo mode/);
    assert.equal(requests.length, before);
    assert.equal(document.querySelector('a,button'), null);
  } finally {
    if (root) await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
});
