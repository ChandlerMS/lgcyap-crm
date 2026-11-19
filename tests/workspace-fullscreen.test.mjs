import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, Fragment, act } from 'react';

test('workspace chrome hides and restores without replacing embedded work or resetting sidebar preferences', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/workspace-fullscreen-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.test/#google-docs', pretendToBeVisual: true });
  const observers = new Set();
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {} disconnect() { observers.delete(this); }
  }
  const replacements = {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle, ResizeObserver,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    fetch: async () => Response.json({ recruits: [], total: 0, loadedCount: 0, partial: false, fetchedAt: '2026-11-19T12:00:00Z', portalId: '50894788', pipelineId: '924992938', capabilities: { canEdit: false }, records: [], unreadCounts: {} }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, replacements);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.closest('[data-workspace-chrome="title"]') ? (document.documentElement.dataset.workspaceFullscreen ? 0 : 96) : 48;
    return { left: 0, right: 232, top: 0, bottom: height, width: 232, height };
  };
  window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  const wait = () => new Promise(resolve => setTimeout(resolve, 15));
  let root;
  try {
    // Next's image loader needs its framework runtime; image loading is outside this interaction.
    const nativeImage = { name: 'native-image', setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'native-image' }));
      builder.onLoad({ filter: /.*/, namespace: 'native-image' }, () => ({ contents: 'import { createElement } from "react"; export default function Image({ unoptimized, ...props }) { return createElement("img", props); }', resolveDir: process.cwd() }));
    } };
    await build({ stdin: { contents: 'export { default as Workspace } from "./app/recruiting-workspace"; export { default as VersionSwitch } from "./app/version-switch";', resolveDir: process.cwd(), loader: 'tsx' }, outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], plugins: [nativeImage], logLevel: 'silent' });
    const style = document.createElement('style');
    style.textContent = `${await readFile('app/globals.css', 'utf8')}\n${await readFile(`${dir}/bundle.css`, 'utf8')}`;
    document.head.append(style);
    const require = createRequire(import.meta.url);
    const { Workspace, VersionSwitch } = require(`${process.cwd()}/${dir}/bundle.cjs`);
    const { createRoot } = require('react-dom/client');
    root = createRoot(document.getElementById('app'));
    await act(async () => { root.render(h(Fragment, null, h(VersionSwitch, { version: 1 }), h(Workspace, { ringCentralClientId: '' }))); await wait(); });
    await act(wait);
    const button = document.querySelector('button[aria-label="Hide sidebar and title bar"]');
    assert.ok(button, 'every CRM hash page exposes the gold hide/restore control');
    const chrome = document.querySelector('[data-workspace-chrome="title"]');
    const sidebar = document.getElementById('main-sidebar');
    const workspace = document.querySelector('.workspace');
    const frame = document.querySelector('.external-workspace iframe');
    frame.contentDocument.write('<!doctype html><body><input value="Unsaved embedded draft"></body>');
    const frameWindow = frame.contentWindow;
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(document.documentElement.hasAttribute('data-workspace-fullscreen'), false);
    assert.equal(document.documentElement.style.getPropertyValue('--crm-titlebar-height'), '96px');
    await act(async () => document.querySelector('[aria-label="Collapse sidebar"]').click());
    assert.equal(document.querySelector('.app-shell').classList.contains('sidebar-collapsed'), true);
    await act(async () => button.click());
    assert.equal(document.documentElement.dataset.workspaceFullscreen, 'true');
    assert.equal(button.getAttribute('aria-label'), 'Restore sidebar and title bar');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.closest('[inert]'), null, 'restore stays outside the mobile inert workspace');
    assert.equal(getComputedStyle(chrome).display, 'none', 'both title navigation and its spacer disappear');
    assert.equal(getComputedStyle(sidebar).display, 'none');
    assert.equal(getComputedStyle(workspace).marginLeft, '0px');
    assert.equal(document.querySelector('.external-workspace iframe'), frame);
    assert.equal(frame.contentWindow, frameWindow);
    assert.equal(frame.contentDocument.querySelector('input').value, 'Unsaved embedded draft');
    await act(async () => { for (const observer of observers) observer.callback(); });
    assert.equal(document.documentElement.style.getPropertyValue('--crm-titlebar-height'), '0px');
    await act(async () => button.click());
    await act(async () => { for (const observer of observers) observer.callback(); });
    assert.equal(document.documentElement.hasAttribute('data-workspace-fullscreen'), false);
    assert.equal(document.querySelector('.app-shell').classList.contains('sidebar-collapsed'), true, 'restore keeps the previous collapsed preference');
    assert.equal(document.documentElement.style.getPropertyValue('--crm-titlebar-height'), '96px');
    assert.notEqual(getComputedStyle(chrome).display, 'none');
    assert.equal(frame.contentDocument.querySelector('input').value, 'Unsaved embedded draft');
    await act(async () => document.querySelector('[aria-label="Expand sidebar"]').click());
    await act(async () => document.querySelector('[aria-label="Open navigation"]').click());
    await act(async () => document.querySelector('[aria-label="Show admin destinations"]').click());
    assert.ok(document.getElementById('admin-links'));
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(workspace.hasAttribute('inert'), true);
    await act(async () => button.click());
    assert.equal(document.body.style.overflow, '');
    assert.equal(workspace.hasAttribute('inert'), false);
    assert.equal(document.querySelector('.mobile-backdrop'), null);
    assert.equal(document.getElementById('admin-links'), null);
    assert.equal(sidebar.classList.contains('is-open'), false);
    assert.equal(getComputedStyle(sidebar).display, 'none', 'fullscreen hides an expanded sidebar too');
    assert.equal(document.activeElement, button);
    await act(async () => { window.location.hash = '#google-sheets'; window.dispatchEvent(new window.HashChangeEvent('hashchange')); await wait(); });
    assert.equal(document.documentElement.dataset.workspaceFullscreen, 'true', 'the choice survives hash navigation');
    assert.ok(document.querySelector('iframe[title^="Google Sheets"]'));
    await act(async () => document.querySelector('[aria-label="Open PolicyTek dialer"]').click());
    const phoneHeading = document.getElementById('policytek-title');
    await act(async () => phoneHeading.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(document.getElementById('policytek-panel').hidden, true);
    assert.equal(document.documentElement.dataset.workspaceFullscreen, 'true', 'floating communication panels keep their own Escape behavior');
    await act(async () => { window.location.hash = '#email'; window.dispatchEvent(new window.HashChangeEvent('hashchange')); await wait(); });
    assert.equal(getComputedStyle(workspace.querySelector(':scope > .source-bar')).display, 'none', 'Email has no residual outer status bar in fullscreen');
    const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); document.body.append(dialog);
    await act(async () => button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(document.documentElement.dataset.workspaceFullscreen, 'true', 'Escape belongs to an open dialog first');
    dialog.remove();
    await act(async () => button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(document.documentElement.hasAttribute('data-workspace-fullscreen'), false);
    assert.equal(document.querySelector('.app-shell').classList.contains('sidebar-collapsed'), false, 'expanded preference also survives');
    await act(async () => button.click());
    await act(async () => root.unmount()); root = null;
    assert.equal(document.documentElement.hasAttribute('data-workspace-fullscreen'), false, 'leaving the CRM clears its document state');
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await rm(dir, { recursive: true, force: true });
  }
});
