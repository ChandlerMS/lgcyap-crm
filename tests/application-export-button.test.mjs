import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

test('export button passes the current filters, waits for its own OAuth popup and presents the saved Sheet', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/application-export-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.test/#applications' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let root;
  try {
    await build({ entryPoints: ['app/application-export-button.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], logLevel: 'silent' });
    const Button = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    const popup = { closed: false, close() { this.closed = true; }, location: { replace(url) { assert.match(url, /^https:\/\/accounts.google.com\/o\/oauth2\/v2\/auth/); } } };
    window.open = () => popup;
    let sent;
    globalThis.fetch = async (path, options) => { assert.equal(path, '/api/applications/export'); sent = JSON.parse(options.body); return Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' }); };
    root = createRoot(document.getElementById('app'));
    const filters = { query: 'Pat', office: 'orlando', status: 'flagged' };
    await act(async () => root.render(h(Button, { filters, count: 25 })));
    const button = document.querySelector('button');
    assert.match(button.title, /all 25 matching applications across every page/);
    await act(async () => button.click());
    assert.deepEqual(sent, filters);
    assert.equal(button.disabled, true);
    await act(async () => window.dispatchEvent(new window.MessageEvent('message', { origin: 'https://untrusted.test', source: popup, data: { type: 'crm:applications-export', url: 'https://docs.google.com/spreadsheets/d/synthetic_saved_sheet/edit', count: 25 } })));
    assert.equal(document.querySelector('a'), null);
    await act(async () => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: popup, data: { type: 'crm:applications-export', url: 'https://docs.google.com/spreadsheets/d/synthetic_saved_sheet/edit', count: 25 } })));
    assert.equal(document.querySelector('a').href, 'https://docs.google.com/spreadsheets/d/synthetic_saved_sheet/edit');
    assert.match(document.body.textContent, /Saved 25 applications/);
    assert.equal(button.disabled, false);
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
});

test('both standalone Applications and the Event Attendance Applications section render the export action', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/applications-export-placement-');
  try {
    await build({ entryPoints: ['app/applications-page.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Page = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    const review = { actions: () => null, error: '', retry: null };
    for (const board of [undefined, { review, reload: 0, topWindow: true }]) {
      const html = renderToStaticMarkup(h(Page, { onUnauthorized() {}, board }));
      assert.match(html, />Export to Google Sheets<\/button>/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
