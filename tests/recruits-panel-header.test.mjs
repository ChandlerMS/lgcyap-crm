import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);
test('Recruits exposes a native-style HubSpot link and refreshes only when enabled', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/recruits-header-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.test' });
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let root;
  try {
    await build({ entryPoints: ['app/recruits-panel.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Panel = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    root = createRoot(document.getElementById('app')); let refreshes = 0;
    const render = async props => act(async () => root.render(createElement(Panel, { records: [], onRefresh: () => refreshes++, ...props })));
    await render({});
    const link = [...document.querySelectorAll('a')].find(item => item.textContent.startsWith('Open in HubSpot'));
    assert.equal(link.href, 'https://app.hubspot.com/contacts/50894788/objects/0-5');
    assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
    assert.ok(link.querySelector('svg'), 'native HubSpot link includes the external-link icon');
    const refresh = () => [...document.querySelectorAll('button')].find(item => ['Refresh', 'Loading…'].includes(item.textContent));
    assert.ok(refresh()); await act(async () => refresh().click()); assert.equal(refreshes, 1);
    await render({ refreshing: true }); assert.equal(refresh().disabled, true); assert.equal(refresh().textContent, 'Loading…');
    await act(async () => refresh().click()); assert.equal(refreshes, 1);
    await render({ refreshDisabled: true }); assert.equal(refresh().disabled, true);
    await render({ onRefresh: undefined, showHubSpotLink: false }); assert.equal(refresh(), undefined);
    assert.equal([...document.querySelectorAll('a')].some(item => item.textContent.startsWith('Open in HubSpot')), false);
    const records = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1), name: `Earlier ${i}`, createdAt: '2026-11-18T20:00:00Z' })),
      { id: '20', name: 'Midnight recruit', office: 'Orlando', stage: 'Training', createdAt: '2026-11-19T05:00:00Z' },
      { id: '21', name: 'Previous Eastern day', createdAt: '2026-11-19T04:59:59Z' },
      { id: '22', name: 'Last second recruit', office: 'Tampa', stage: 'Contracting', createdAt: '2026-11-20T04:59:59Z' },
      { id: '23', name: 'Next day recruit', createdAt: '2026-11-20T05:00:00Z' },
      { id: '24', name: 'Unknown date', createdAt: 'invalid' },
    ];
    await render({ records });
    const click = async text => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === text || text === 'Next' && item.textContent.startsWith('Next')); assert.ok(button, text); await act(async () => button.click()); };
    await click('Next');
    const field = document.querySelector('input[type="date"]'); assert.ok(field);
    field.value = '2026-11-19';
    await act(async () => field.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    assert.match(document.querySelector('tbody').textContent, /Midnight recruit/);
    assert.match(document.querySelector('tbody').textContent, /Last second recruit/);
    assert.doesNotMatch(document.querySelector('tbody').textContent, /Previous Eastern day|Next day recruit|Unknown date/);
    field.value = '2026-11-21';
    await act(async () => field.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(document.body.textContent, /No loaded recruits were added on this date/);
    await click('Clear date');
    assert.equal(field.value, ''); assert.equal(document.querySelectorAll('tbody tr').length, 10);
    assert.match(document.body.textContent, /16 loaded recruits/);
    const form = field.form;
    assert.ok(form.querySelector('[name="office"]')); assert.ok(form.querySelector('[name="stage"]')); assert.ok(form.querySelector('[name="name"]'));
    field.value = '2026-11-19'; form.elements.namedItem('office').value = 'Orlando'; form.elements.namedItem('stage').value = 'Training'; form.elements.namedItem('name').value = 'MIDNIGHT';
    await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    assert.match(document.querySelector('tbody').textContent, /Midnight recruit/);
    await click('Clear date'); assert.equal(document.querySelectorAll('tbody tr').length, 1);
    await click('Clear filters'); assert.equal(form.elements.namedItem('office').value, ''); assert.equal(form.elements.namedItem('stage').value, ''); assert.equal(form.elements.namedItem('name').value, '');
    assert.equal(document.querySelectorAll('tbody tr').length, 10);
    field.value = '2026-11-19';
    await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    const sort = form.elements.namedItem('sort');
    await act(async () => { sort.value = 'office:desc'; sort.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.match(document.querySelector('tbody tr td').textContent, /Last second recruit/);
    await act(async () => { sort.value = 'name:desc'; sort.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.match(document.querySelector('tbody tr td').textContent, /Midnight recruit/);
    form.elements.namedItem('name').value = 'No such recruit';
    await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(document.body.textContent, /No loaded recruits match these filters/);
  } finally {
    if (root) await act(async () => root.unmount()); Object.assign(globalThis, old); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
