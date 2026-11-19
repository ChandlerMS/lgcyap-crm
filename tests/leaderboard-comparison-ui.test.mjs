import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const require = createRequire(import.meta.url);
const pause = () => new Promise(resolve => setTimeout(resolve, 15));

function result(input, overrides = {}) {
  const rows = input.board === 'shopper' ? [{ name: 'Alex Agent', submitted: 7, premium: 2000, leads: 40 }]
    : input.board === 'whatsapp' || input.board === 'whatsapp-sp' ? [{ name: 'Alex Agent', sales: input.board === 'whatsapp-sp' ? 8 : 2, production: 500 }, { name: 'Blair Agent', sales: 1, production: 250 }]
      : [{ name: 'Alex Agent', sales: 4, annualPremium: 1000, inboundCalls: 20, soldPerInboundLog: .2 }];
  return { ...input, startDate: input.from ?? '2026-11-19', endDate: input.to ?? '2026-11-19', status: 'available', source: `Saved ${input.board}`, partial: false, stale: false, fetchedAt: '2026-11-19T12:00:00Z', rows,
    ...(input.board === 'sp' ? { calls: { status: 'available', basis: 'ringcx', total: 20, soldPerInboundLog: .2 }, callNotice: 'Report call coverage caveat.' } : {}),
    ...(input.board === 'all' ? { combinedTotals: { sales: 19, annualPremium: 9100, calls: 90, closeRate: 19 / 90 } } : {}),
    ...(input.board === 'shopper' ? { reportTotals: { submitted: 9, premium: 2500, leads: 50, spend: 0 } } : {}), ...overrides };
}

async function withLeaderboard(run, fetcher, initialBoard = 'whatsapp') {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/leaderboard-comparison-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.test' });
  const before = Object.fromEntries(['window', 'document', 'fetch', 'FormData', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  let root;
  const requests = [];
  try {
    await build({ entryPoints: ['app/leaderboard.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'image-boundary', setup(builder) { builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default function Image(){return null}', loader: 'js' })); } }] });
    const Leaderboard = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    globalThis.fetch = async (url, options) => { assert.equal(url, '/api/leaderboard'); const input = JSON.parse(options.body); requests.push(input); return fetcher ? fetcher(input, options) : Response.json(result(input)); };
    root = createRoot(document.getElementById('app'));
    await act(async () => { root.render(createElement(Leaderboard, { initialBoard, onUnauthorized() { assert.fail('Unexpected sign-out'); } })); await pause(); });
    await act(pause);
    const click = async text => { const button = [...document.querySelectorAll('button')].find(value => value.textContent === text); assert.ok(button, `Missing ${text} button`); await act(async () => { button.click(); await pause(); }); await act(pause); };
    await run({ dom, requests, click });
  } finally {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, before); dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
}

test('All precedes Shopper and displays authoritative combined totals and mixed activity labels', async () => {
  await withLeaderboard(async ({ click }) => {
    assert.deepEqual([...document.querySelector('[aria-label="Leaderboard"]').querySelectorAll('button')].map(button => button.textContent).slice(0, 2), ['All', 'Shopper']);
    await click('All');
    const totals = document.querySelector('dl[aria-label="All totals"]');
    assert.ok(totals);
    assert.deepEqual([...totals.querySelectorAll('dd')].map(value => value.textContent), ['19', '$9,100', '21.1%', '90']);
    assert.match(totals.textContent, /Calls \/ leads/);
    assert.match(totals.textContent, /Sales \/ activity/);
    assert.deepEqual([...document.querySelector('[aria-label="Rank by"]').querySelectorAll('button')].map(button => button.textContent), ['Policies sold', 'Annual premium']);
  }, null, 'sp');
});

test('comparison tabs request the specified sources and keep available rows beside unavailable WhatsApp SP', async () => {
  await withLeaderboard(async ({ click, requests }) => {
    for (const [tab, left, right, label] of [['vs HubSpot', 'sp', 'whatsapp-sp', 'HubSpot · Standard vs Preferred'], ['vs PolicyTek', 'shopper', 'whatsapp-sp', 'PolicyTek · Shopper'], ['vs All', 'all', 'whatsapp', 'All · Shopper + Standard vs Preferred']]) {
      await click(tab);
      assert.deepEqual(requests.slice(-2).map(value => value.board), [left, right]);
      assert.ok(document.querySelector(`section[aria-label="${label}"]`));
      const table = document.querySelector('table[aria-label="Agent comparison"]');
      assert.ok(table);
      assert.match(table.textContent, /Alex Agent/);
      assert.match(table.textContent, /Policies sold/);
      assert.match(table.textContent, /Annual premium/);
      if (right === 'whatsapp-sp') {
        const side = document.querySelector('section[aria-label="WhatsApp · Standard vs Preferred"]');
        assert.match(side.textContent, /Standard vs Preferred WhatsApp sales have not been imported yet/);
        assert.ok([...side.querySelectorAll('dd')].every(value => value.textContent === '—'));
        assert.ok([...table.querySelectorAll('tbody tr')].every(row => [...row.children].slice(3).every(cell => cell.textContent === '—')));
      }
    }
    assert.match(document.body.textContent, /2026-11-19/);
    assert.match(document.body.textContent, /Updated/);
  }, input => Response.json(result(input, input.board === 'whatsapp-sp' ? { status: 'unavailable', rows: [], notice: 'Standard vs Preferred WhatsApp sales have not been imported yet.' } : {})));
});

test('paired rows share a magnitude scale and common metric, sort, search, and Custom date controls', async () => {
  await withLeaderboard(async ({ click, requests, dom }) => {
    await click('vs HubSpot');
    const table = () => document.querySelector('table[aria-label="Agent comparison"]');
    const bars = () => [...table().querySelectorAll('[data-comparison-bar]')];
    assert.deepEqual(bars().map(bar => bar.style.width), ['100%', '50%', '25%']);
    await click('Policies sold');
    assert.deepEqual(bars().map(bar => bar.style.width), ['50%', '100%', '12.5%']);
    await click('Alphabetical');
    assert.match(table().querySelector('tbody tr').textContent, /^Alex Agent/);
    await act(async () => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith('Sort alphabetically')).click());
    assert.match(table().querySelector('tbody tr').textContent, /^Blair Agent/);
    await act(async () => { const search = document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'Blair'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    assert.equal(table().querySelectorAll('tbody tr').length, 1);
    assert.match(table().querySelector('tbody tr').textContent, /^Blair Agent/);
    await click('Weekly');
    assert.deepEqual(requests.slice(-2).map(value => [value.board, value.period]), [['sp', 'custom'], ['whatsapp-sp', 'custom']]);
    assert.equal(requests.at(-1).from, requests.at(-2).from);
    assert.equal(requests.at(-1).to, requests.at(-2).to);
    await click('Custom');
    await act(async () => {
      document.querySelector('[name="from"]').value = '2026-09-01';
      document.querySelector('[name="to"]').value = '2026-09-14';
      document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause();
    });
    await act(pause);
    assert.deepEqual(requests.slice(-2).map(value => [value.board, value.period, value.from, value.to]), [['sp', 'custom', '2026-09-01', '2026-09-14'], ['whatsapp-sp', 'custom', '2026-09-01', '2026-09-14']]);
    assert.match(document.querySelector('[aria-label="HubSpot · Standard vs Preferred"]').textContent, /2026-09-01 – 2026-09-14/);
    assert.match(document.body.textContent, /Report call coverage caveat/);
  });
});

test('late comparison responses cannot replace the selected view or period', async () => {
  const pending = [];
  await withLeaderboard(async ({ click }) => {
    await click('vs HubSpot');
    await click('vs All');
    assert.match(document.querySelector('table').textContent, /Alex Agent/);
    await act(async () => { for (const resolve of pending.splice(0)) resolve(); await pause(); });
    assert.ok(document.querySelector('section[aria-label="All · Shopper + Standard vs Preferred"]'));
    assert.equal(document.querySelector('section[aria-label="HubSpot · Standard vs Preferred"]'), null);
    assert.doesNotMatch(document.querySelector('table').textContent, /Late Agent/);
  }, input => input.board === 'sp' || input.board === 'whatsapp-sp' ? new Promise(resolve => pending.push(() => resolve(Response.json(result(input, { rows: [{ name: 'Late Agent', sales: 100, annualPremium: 999999, production: 999999 }] }))))) : Response.json(result(input)));
});

test('one failed comparison source preserves the other source and applies rate limit cooldown', async () => {
  await withLeaderboard(async ({ click }) => {
    await click('vs HubSpot');
    assert.match(document.querySelector('table').textContent, /Alex Agent/);
    assert.match(document.querySelector('section[aria-label="WhatsApp · Standard vs Preferred"]').textContent, /Try after cooldown/);
    assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh').disabled, true);
    assert.match(document.body.textContent, /Refresh is available after/);
  }, input => input.board === 'whatsapp-sp' ? Response.json({ error: { code: 'HUBSPOT_RATE_LIMITED', message: 'Try after cooldown' }, retryAfterSeconds: 60 }, { status: 429 }) : Response.json(result(input)));
});


test('mismatched response bounds leave that source unavailable and preserve the matching source', async () => {
  await withLeaderboard(async ({ click }) => {
    await click('vs HubSpot');
    assert.match(document.querySelector('table').textContent, /Alex Agent/);
    assert.ok([...document.querySelector('section[aria-label="WhatsApp · Standard vs Preferred"]').querySelectorAll('dd')].every(value => value.textContent === '—'));
    assert.doesNotMatch(document.querySelector('table').textContent, /Wrong Range Agent/);
    assert.match(document.querySelector('section[aria-label="WhatsApp · Standard vs Preferred"]').textContent, /could not be loaded/);
  }, input => Response.json(result(input, input.board === 'whatsapp-sp' ? { startDate: '2025-01-01', endDate: '2025-01-02', rows: [{ name: 'Wrong Range Agent', sales: 100, production: 99999 }] } : {})));
});

test('comparison sources expose their own partial, stale, import coverage, and update information', async () => {
  await withLeaderboard(async ({ click }) => {
    await click('vs HubSpot');
    const left = document.querySelector('section[aria-label="HubSpot · Standard vs Preferred"]');
    const right = document.querySelector('section[aria-label="WhatsApp · Standard vs Preferred"]');
    assert.match(left.textContent, /Saved · stale/);
    assert.match(left.textContent, /Incomplete results/);
    assert.match(left.textContent, /Report call coverage caveat/);
    assert.match(right.textContent, /Activity through 2026-11-18/);
    assert.match(right.textContent, /Right import caveat/);
    assert.doesNotMatch(right.textContent, /Saved · stale/);
    assert.match(left.textContent, /Updated/); assert.match(right.textContent, /Updated/);
  }, input => Response.json(result(input, input.board === 'sp' ? { partial: true, stale: true } : input.board === 'whatsapp-sp' ? { dataThrough: '2026-11-18', notice: 'Right import caveat.' } : {})));
});
