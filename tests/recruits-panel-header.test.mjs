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
  } finally {
    if (root) await act(async () => root.unmount()); Object.assign(globalThis, old); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
