import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);
test('Shopper and Standard vs Preferred show Sales before Calls with their own sales counts', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/leaderboard-sales-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.test' });
  const before = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, flag: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    await build({ entryPoints: ['app/leaderboard.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'image-boundary', setup(builder) { builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default function Image(){return null}', loader: 'js' })); } }] });
    const Leaderboard = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    globalThis.fetch = async (_url, options) => {
      const input = JSON.parse(options.body);
      return Response.json({ ...input, status: 'available', source: 'Synthetic', partial: false, rows: Array.from({ length: input.board === 'shopper' ? 61 : 1 }, (_, index) => ({ name: `Agent ${String(index + 1).padStart(2, '0')}`, sales: 3, annualPremium: 1000, inboundCalls: 20, soldPerInboundLog: .15, submitted: 7, premium: 2000 - index, leads: 40, connectedCalls: 22, abandonedCalls: 2 })) });
    };
    root = createRoot(document.getElementById('app'));
    const wait = () => new Promise(resolve => setTimeout(resolve, 30));
    await act(async () => { root.render(createElement(Leaderboard, { onUnauthorized() { assert.fail('Unexpected sign-out'); } })); await wait(); });
    await act(wait);
    const verify = (sales, calls) => {
      const list = document.querySelector('ol[aria-label^="Ranked by"]');
      assert.ok(list);
      const headings = [...list.previousElementSibling.children].map(element => element.textContent);
      assert.deepEqual(headings.slice(1, 4), ['Agent', 'Sales', 'Calls']);
      const cells = [...list.querySelector('li').children];
      assert.equal(cells[2].textContent, `Sales: ${sales}`);
      assert.equal(cells[3].textContent, `Calls: ${calls}`);
    };
    verify(3, 20);
    await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === 'Shopper').click(); await wait(); });
    verify(7, 40);
    const agents = () => [...document.querySelectorAll('ol[aria-label^="Ranked by"] > li')];
    const pager = () => document.querySelector('nav[aria-label="Shopper leaderboard pages"]');
    assert.equal(agents().length, 25);
    assert.ok(pager());
    const previous = () => [...pager().querySelectorAll('button')].find(button => button.textContent === 'Previous');
    const next = () => [...pager().querySelectorAll('button')].find(button => button.textContent === 'Next');
    assert.equal(previous().disabled, true);
    await act(async () => next().click());
    assert.equal(agents().length, 25);
    assert.match(agents()[0].textContent, /Agent 26/);
    assert.equal(agents()[0].querySelector('[aria-label="Rank 26"]').textContent, '26');
    await act(async () => { const select = pager().querySelector('select'); select.value = '3'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.equal(agents().length, 11);
    assert.match(agents()[0].textContent, /Agent 51/);
    assert.equal(next().disabled, true);
    await act(async () => previous().click());
    assert.match(agents()[0].textContent, /Agent 26/);
    await act(async () => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Sort by Sales').click());
    assert.match(agents()[0].textContent, /Agent 01/);
    assert.equal(pager().querySelector('select').value, '1');
    assert.ok([...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label')?.startsWith('Sort by Sales')));
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = before.window; globalThis.document = before.document; globalThis.fetch = before.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = before.flag;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
