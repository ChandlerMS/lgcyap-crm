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
      return Response.json({ ...input, status: 'available', source: 'Synthetic', partial: false, rows: [{ name: 'Agent A', sales: 3, annualPremium: 1000, inboundCalls: 20, soldPerInboundLog: .15, submitted: 7, premium: 2000, leads: 40, connectedCalls: 22, abandonedCalls: 2 }] });
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
    assert.ok([...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Sort by Sales'));
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = before.window; globalThis.document = before.document; globalThis.fetch = before.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = before.flag;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
