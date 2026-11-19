import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

test('sidebar flyouts center on the highlighted row, retain internal focus and dismiss on selection or lost focus', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/sidebar-flyout-');
  const dom = new JSDOM('<div id="app"></div><button id="outside">Outside</button>', { url: 'https://crm.example.test', pretendToBeVisual: true });
  const keys = ['window', 'document', 'getComputedStyle', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle, ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  let rowTop = 350;
  window.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList.contains('sidebar') ? { left: 20, right: 260, top: 0, bottom: 800, width: 240, height: 800 } : { left: 20, right: 260, top: rowTop, bottom: rowTop + 56, width: 240, height: 56 }; };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return 240; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return 180; } });
  let root;
  try {
    await build({ entryPoints: ['app/sidebar-flyout.tsx'], outfile: `${dir}/component.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], logLevel: 'silent' });
    const Flyout = createRequire(import.meta.url)(`${process.cwd()}/${dir}/component.cjs`).default;
    function Fixture() {
      const [open, setOpen] = useState(false);
      const dismiss = useCallback(() => setOpen(false), []);
      return h('aside', { className: 'sidebar' }, h('div', { className: 'nav-group', onMouseEnter: () => setOpen(true) }, h('button', { id: 'trigger', 'aria-controls': 'flyout', onClick: () => setOpen(true) }, 'Menu'), h(Flyout, { id: 'flyout', hidden: !open, layoutKey: '', onDismiss: dismiss, onEnter: () => {}, onLeave: () => {} }, h('a', { href: '#chosen' }, 'Choose'), h('a', { href: '#other' }, 'Other'))));
    }
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(Fixture)));
    const trigger = document.getElementById('trigger');
    const open = async (y = 390) => { await act(async () => { trigger.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, clientX: 200, clientY: y, relatedTarget: document.body })); trigger.click(); }); return document.getElementById('flyout'); };
    let panel = await open();
    assert.equal(panel.style.top, '288px');
    assert.equal(Number.parseFloat(panel.style.top) + 90, rowTop + 28, 'popup and row share the same vertical center');
    assert.equal(panel.style.left, '260px');
    await act(async () => panel.querySelector('a').focus());
    assert.ok(document.getElementById('flyout'), 'moving focus into the menu keeps it open');
    await act(async () => document.getElementById('outside').focus());
    assert.equal(document.getElementById('flyout'), null, 'focus leaving closes the menu');
    rowTop = window.innerHeight - 30;
    panel = await open(790);
    assert.ok(Number.parseFloat(panel.style.top) + 180 <= window.innerHeight - 8, 'bottom edge stays within the viewport');
    await act(async () => panel.querySelector('a').click());
    assert.equal(document.getElementById('flyout'), null, 'selection closes the menu');
    rowTop = 350;
    await open();
    await act(async () => window.dispatchEvent(new window.Event('blur')));
    assert.equal(document.getElementById('flyout'), null, 'switching windows closes the menu');
    await act(async () => { trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); trigger.click(); });
    panel = document.getElementById('flyout');
    assert.equal(panel.style.top, '288px', 'keyboard and mouse openings share the row-centered position');
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.getElementById('flyout'), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await rm(dir, { recursive: true, force: true });
  }
});
