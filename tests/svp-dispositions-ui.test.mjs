import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { queryDispositions, validateDispositionQuery } from '../lib/svp-dispositions.mjs';
const require = createRequire(import.meta.url);
test('Calls and Dispositions modes filter source buttons and preserve source selection; the dispositions view applies filters and renders safe call links', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/dispositions-ui-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.test' });
  const before = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, flag: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const snapshot = { version: 1, source: 'Test.xlsx', importedAt: '2026-11-19T12:00:00Z', appliedFilters: ['Final IN (Yes)'], rows: [
    ['2026-11-18', 'Ana', '+15550000001', 'FL', 'Sold', 'note', 'https://example.test/record', 'javascript:alert(1)', 'Connected', '12:00:00 US/Eastern', '60s', '50s', '70s', '20s', '0'],
    ['2026-11-17', 'Bo', '+15550000002', 'NJ', 'Not Interested', '', '', 'N/A', 'Connected', '11:00:00 US/Eastern', '1s', '1s', '1s', '0', '0'],
  ] };
  let root, current = 'shopper'; const requests = [];
  try {
    await build({ entryPoints: ['app/calls-page.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'hubspot-boundary', setup(builder) { builder.onResolve({ filter: /^\.\/hubspot-workspace$/ }, () => ({ path: 'hubspot', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default function HubSpot(){return null}', loader: 'js' })); } }] });
    const CallsPage = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    globalThis.fetch = async (_url, options) => { const input = JSON.parse(options.body); requests.push(input); return Response.json(queryDispositions(snapshot, validateDispositionQuery(input))); };
    root = createRoot(document.getElementById('app'));
    const render = () => root.render(createElement(CallsPage, { view: current, onSourceChange: value => { current = value; render(); }, onUnauthorized: () => assert.fail('unexpected sign-out'), onBusyChange() {}, onDirtyChange() {} }));
    await act(async () => render());
    const modes = () => [...document.querySelector('[aria-label="Calls view"]').querySelectorAll('button')];
    const sources = () => [...document.querySelector(`[aria-label="${current.endsWith('-dispositions') ? 'Dispositions' : 'Calls'} source"]`).querySelectorAll('button')];
    assert.deepEqual(modes().map(button => button.textContent), ['Calls', 'Dispositions']);
    assert.equal(modes()[0].getAttribute('aria-pressed'), 'true');
    assert.deepEqual(sources().map(button => button.textContent), ['Shopper', 'Standard vs Preferred']);
    const originalClass = document.querySelector('iframe').className;
    await act(async () => modes()[1].click());
    assert.equal(current, 'shopper-dispositions');
    assert.deepEqual(sources().map(button => button.textContent), ['Shopper Dispositions', 'Standard vs Preferred Dispositions']);
    assert.equal(document.querySelector('iframe').src, 'https://app.policytek.com/leads');
    assert.equal(document.querySelector('iframe').className, originalClass);
    await act(async () => modes()[0].click());
    assert.equal(current, 'shopper');
    assert.equal(document.querySelector('iframe').src, 'https://app.policytek.com/calls');
    await act(async () => sources()[1].click());
    assert.equal(current, 'standard');
    await act(async () => { modes()[1].click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(current, 'standard-dispositions');
    assert.equal(modes()[1].getAttribute('aria-pressed'), 'true');
    assert.deepEqual(sources().map(button => button.textContent), ['Shopper Dispositions', 'Standard vs Preferred Dispositions']);
    assert.equal(sources()[1].getAttribute('aria-pressed'), 'true');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    assert.match(document.body.textContent, /does not update automatically/);
    assert.equal(document.querySelector('a[href^="javascript:"]'), null);
    assert.equal(document.querySelector('a[href="https://example.test/record"]').rel, 'noopener noreferrer');
    const select = [...document.querySelectorAll('label')].find(label => label.firstChild.textContent === 'Disposition').querySelector('select');
    await act(async () => { select.value = 'Sold'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    assert.equal(requests.at(-1).disposition, 'Sold');
    assert.match(document.querySelector('tbody').textContent, /Ana/);
    assert.equal(document.querySelectorAll('thead th').length, 15);
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Reset').click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    await act(async () => modes()[0].click());
    assert.equal(current, 'standard');
    assert.deepEqual(sources().map(button => button.textContent), ['Shopper', 'Standard vs Preferred']);
    assert.equal(sources()[1].getAttribute('aria-pressed'), 'true');
    await act(async () => { current = 'shopper-dispositions'; render(); });
    assert.equal(modes()[1].getAttribute('aria-pressed'), 'true', 'saved disposition routes select the matching mode');
    assert.equal(sources()[0].getAttribute('aria-pressed'), 'true');
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = before.window; globalThis.document = before.document; globalThis.fetch = before.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = before.flag;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
