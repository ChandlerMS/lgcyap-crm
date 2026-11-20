import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);
test('dismissed notices stay hidden on refresh, while changed messages reappear', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/notice-');
  const dom = new JSDOM('<div id="app"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, flag: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    await build({ entryPoints: ['app/dismissible-notice.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*'] });
    const Notice = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    root = createRoot(document.getElementById('app'));
    const render = message => root.render(createElement(Notice, { role: 'status' }, createElement('strong', null, message)));
    await act(async () => render('Sync needs attention'));
    assert.equal(document.querySelector('button').getAttribute('aria-label'), 'Dismiss notification');
    await act(async () => document.querySelector('button').click());
    assert.equal(document.querySelector('[role="status"]'), null);
    await act(async () => render('Sync needs attention'));
    assert.equal(document.querySelector('[role="status"]'), null);
    await act(async () => render('New sync problem'));
    assert.match(document.body.textContent, /New sync problem/);
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.flag;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
