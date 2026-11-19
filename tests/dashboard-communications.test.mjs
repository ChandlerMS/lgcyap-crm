import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);
test('Email composes through the existing provider and compact Inbox retains refresh and collapse controls', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/dashboard-communications-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.test' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let root; const requests = [];
  try {
    await writeFile(`${dir}/entry.tsx`, `export {default as Email} from '../../app/recruit-email-panel'; export {RecruitEmailProvider} from '../../app/recruit-email'; export {default as Inbox} from '../../app/inbox-workspace'; export {DashboardSection} from '../../app/dashboard-section';`);
    await build({ entryPoints: [`${dir}/entry.tsx`], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const { Email, RecruitEmailProvider, Inbox, DashboardSection } = require(`${process.cwd()}/${dir}/bundle.cjs`);
    globalThis.fetch = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return Response.json({ status: 'available', tool: 'inbox', records: [], complete: true, continuation: null }); };
    let refreshed = 0;
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(RecruitEmailProvider, { recruits: [{ id: '123', name: 'Alex', email: 'alex@example.test' }], disabled: false }, h(DashboardSection, { id: 'email', label: 'Email' }, h(Email, { recruits: [{ id: '123', name: 'Alex', email: 'alex@example.test' }, { id: 'demo', name: 'Test', email: 'test@example.test', isDemo: true }], onRefresh: () => refreshed++ })))));
    const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text);
    assert.match(document.querySelector('table').textContent, /alex@example.test/); assert.doesNotMatch(document.querySelector('table').textContent, /test@example.test/);
    await act(async () => button('Refresh').click()); assert.equal(refreshed, 1);
    await act(async () => button('New Email').click()); assert.equal(document.querySelector('dialog').open, true);
    assert.ok(button('Collapse Email'));
    await act(async () => root.render(h(DashboardSection, { id: 'inbox', label: 'Inbox' }, h(Inbox, { compact: true, pageHref: '#inbox', onUnauthorized() {} }))));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(document.querySelector('h1'), null); assert.equal(document.querySelector('h2 a').getAttribute('href'), '#inbox');
    assert.ok(document.querySelector('[data-section-heading]'));
    assert.ok(button('Collapse Inbox'));
    const before = requests.length;
    await act(async () => button('Refresh').click()); assert.ok(requests.length > before);
    await act(async () => button('Collapse Inbox').click());
    assert.equal(document.querySelector('.dashboard-section').classList.contains('is-collapsed'), true);
    assert.ok(button('Refresh'), 'header remains mounted when collapsed');
  } finally {
    if (root) await act(async () => root.unmount()); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
