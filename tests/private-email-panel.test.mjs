import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
test('received Email is hidden for other users and shows HubSpot subjects and connection errors for Chandler', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/private-email-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.invalid/#email' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let root; let canRead = false, connected = true; const requests = [];
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  let automaticRefresh; const originalInterval = window.setInterval.bind(window);
  window.setInterval = (callback, milliseconds) => { if (milliseconds === 60000) automaticRefresh = callback; return originalInterval(callback, milliseconds); };
  try {
    await build({ entryPoints: ['app/private-email-panel.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Panel = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, method: options.method });
      assert.equal(url, '/api/email');
      if (!options.method) return Response.json({ canRead });
      const input = JSON.parse(options.body);
      if (!connected) return Response.json({ tool: 'inbox', status: 'connection-required', error: { message: 'Connect Chandler mailbox in HubSpot.' } });
      return Response.json({ tool: 'inbox', status: 'available', archive: input.archive, records: [{ id: '11', title: 'Synthetic incoming email subject', subtitle: 'Synthetic sender' }], complete: true, continuation: null, partial: false });
    };
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(Panel, { key: 'other' })));
    assert.equal(document.querySelector('section'), null);
    assert.equal(requests.some(request => request.method === 'POST'), false);
    canRead = true;
    await act(async () => root.render(h(Panel, { key: 'owner' })));
    assert.match(document.body.textContent, /Synthetic incoming email subject/);
    assert.ok([...document.querySelectorAll('a')].some(link => link.href.includes('/settings/50894788/inbox/inboxes')));
    connected = false;
    await act(async () => automaticRefresh());
    assert.match(document.body.textContent, /Synthetic incoming email subject/, 'failed automatic refresh retains previously loaded email');
    const refresh = [...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh');
    await act(async () => refresh.click());
    assert.match(document.body.textContent, /Connect Chandler mailbox in HubSpot/);
    assert.doesNotMatch(document.body.textContent, /No conversations match this view/);
  } finally {
    if (root) await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
});
