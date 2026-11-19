import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

test('monthly Sheets panel shows owner status and current link, runs repair, and hides for other users', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/application-sheets-panel-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.invalid/#applications' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let root;
  try {
    await build({ entryPoints: ['app/application-sheets-panel.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Panel = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    const status = { visible: true, owner: 'chandler@lgcyap.com', canConnect: true, connected: true, available: true, lastSuccessAt: '2026-11-19T14:00:00Z', error: 'SYNC_FAILED', current: { title: '11-26 Applications', url: 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit', syncedAt: '2026-11-19T14:00:00Z' } };
    let hidden = false, submitted, signIns = false;
    globalThis.fetch = async (path, options = {}) => {
      assert.equal(path, signIns ? '/api/event-attendance/sheets' : '/api/applications/sheets');
      if (options.method === 'POST') { submitted = JSON.parse(options.body); return Response.json({ ...status, error: null, result: { status: 'synced' } }); }
      return Response.json(hidden ? { visible: false } : signIns ? { ...status, current: { ...status.current, title: '11-26 Recruits' } } : status);
    };
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(Panel)));
    assert.equal(document.querySelector('a').href, status.current.url);
    assert.match(document.body.textContent, /9 am Eastern/);
    assert.match(document.body.textContent, /last sync failed/i);
    const sync = [...document.querySelectorAll('button')].find(button => button.textContent === 'Sync now');
    await act(async () => sync.click());
    assert.deepEqual(submitted, { action: 'sync' });
    assert.match(document.body.textContent, /Sheets are up to date/);
    assert.equal(document.querySelector('[role="alert"]'), null);
    signIns = true;
    await act(async () => root.render(h(Panel, { key: 'sign-ins', report: 'sign-ins' })));
    assert.match(document.body.textContent, /Monthly Recruits Sheets/);
    assert.match(document.querySelector('a').textContent, /11-26 Recruits/);
    await act(async () => root.unmount());
    hidden = true; signIns = false; root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(Panel)));
    assert.equal(document.querySelector('aside'), null);
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
});
