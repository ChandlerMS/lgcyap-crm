import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

test('title shortcuts use named icons in order and preserve navigation and disabled behavior', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/title-shortcuts-');
  const dom = new JSDOM('<nav><div id="crm-title-controls"></div></nav><div id="app"></div>', { url: 'https://crm.example.test' });
  const previous = { window: globalThis.window, document: globalThis.document, ResizeObserver: globalThis.ResizeObserver, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  let root;
  try {
    await build({ entryPoints: ['app/workspace-titlebar.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Component = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    const navigated = [];
    const props = { demo: false, demoRecords: [], modeDisabled: false, searchDisabled: false, menuOpen: false, activeView: 'calendar', onModeChange() {}, onNavigate() {}, onUnauthorized() {}, onSupportNavigate: id => navigated.push(id) };
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(Component, props)));
    const links = [...document.querySelectorAll('[aria-label="Workspace shortcuts"] a')];
    assert.deepEqual(links.map(link => link.getAttribute('aria-label')), ['Tasks', 'Follow-up', 'Meetings', 'Calendar', 'Email', 'Inbox', 'Help Desk', 'Tickets']);
    for (const link of links) { assert.ok(link.querySelector('svg[aria-hidden="true"]')); assert.ok(link.title); }
    assert.equal(links[3].getAttribute('aria-current'), 'page');
    await act(async () => links[4].click());
    assert.deepEqual(navigated, ['email']);
    assert.equal(links[4].getAttribute('href'), '#email');
    await act(async () => root.render(h(Component, { ...props, modeDisabled: true })));
    await act(async () => links[0].click());
    assert.deepEqual(navigated, ['email']);
    assert.equal(links[0].tabIndex, -1);
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, { window: previous.window, document: previous.document, ResizeObserver: previous.ResizeObserver });
    if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    await rm(dir, { recursive: true, force: true });
  }
});
