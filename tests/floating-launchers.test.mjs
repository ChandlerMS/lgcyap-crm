import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';

async function fixture(run) {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/launchers-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.lgcyap.com/', pretendToBeVisual: true });
  const globals = ['window', 'document', 'HTMLElement', 'ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: dom.window.MutationObserver, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let root;
  try {
    await build({ stdin: { contents: 'export { default as Panel, useRingCentral } from "./app/ringcentral-panel"; export { default as Bot } from "./app/legacy-bot-launcher"; export { default as Launcher } from "./app/floating-launcher";', resolveDir: process.cwd(), loader: 'tsx' }, outfile: `${dir}/components.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], logLevel: 'silent' });
    const components = createRequire(import.meta.url)(`${process.cwd()}/${dir}/components.cjs`);
    const handlers = new Map();
    let opens = 0, closes = 0;
    window.HubSpotConversations = { widget: { status: () => ({ loaded: true }), open: () => { opens++; }, close: () => { closes++; handlers.get('widgetClosed')?.(); } }, on: (event, fn) => handlers.set(event, fn), off: event => handlers.delete(event) };
    root = createRoot(document.getElementById('app'));
    function CallAction() { const rc = components.useRingCentral(); return h('button', { id: 'call-recruit', onClick: () => rc.open({ action: 'call', phone: '5551234567', name: 'Test Recruit' }) }, 'Call recruit'); }
    function FutureLauncher() { const [open, setOpen] = useState(false); return h(components.Launcher, { id: 'future-launcher', expanded: open, onExpand: () => setOpen(true), onCollapse: () => setOpen(false) }, 'Future tool'); }
    await act(async () => root.render(h(components.Panel, { clientId: 'test-client', isDemo: false }, h(components.Bot), h(CallAction), h(FutureLauncher))));
    const click = async selector => { const button = document.querySelector(selector); assert.ok(button, selector); await act(async () => button.click()); return button; };
    await run({ click, opens: () => opens, closes: () => closes });
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await rm(dir, { recursive: true, force: true });
  }
}

test('PolicyTek toggles without replacing its signed-in iframe', () => fixture(async ({ click }) => {
  await click('.policytek-launcher');
  const frame = document.querySelector('#policytek-panel iframe');
  assert.equal(document.querySelector('#policytek-panel').hidden, false);
  await click('.policytek-launcher');
  assert.equal(document.querySelector('#policytek-panel').hidden, true);
  await click('.policytek-launcher');
  assert.equal(document.querySelector('#policytek-panel iframe'), frame);
  assert.equal(document.querySelector('#policytek-panel').hidden, false);
}));
test('RingCentral remains reachable and toggles without losing its iframe or call intent', () => fixture(async ({ click }) => {
  await click('#call-recruit');
  const frame = document.querySelector('#ringcentral-panel iframe');
  const launcher = document.querySelector('.rc-launcher');
  assert.equal(launcher.hidden, false);
  await click('.rc-launcher');
  assert.equal(document.querySelector('#ringcentral-panel').hidden, true);
  await click('.rc-launcher');
  assert.equal(document.querySelector('#ringcentral-panel').hidden, false);
  assert.equal(document.querySelector('#ringcentral-panel iframe'), frame);
  assert.match(document.querySelector('.rc-recipient').textContent, /Test Recruit/);
}));
test('Legacy Bot repeats open, collapse and reopen through the HubSpot API', () => fixture(async ({ click, opens, closes }) => {
  const before = closes();
  const button = await click('.legacy-bot-control button');
  assert.equal(opens(), 1);
  await click('.legacy-bot-control button');
  assert.equal(closes(), before + 1);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  await click('.legacy-bot-control button');
  assert.equal(opens(), 2);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const css = await readFile('app/globals.css', 'utf8');
  assert.doesNotMatch(css, /data-open="true"\]\s+\.legacy-bot-launcher\s*\{\s*visibility:\s*hidden/);
}));

test('future bottom buttons inherit the shared toggle contract', () => fixture(async ({ click }) => {
  const button = await click('#future-launcher');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  await click('#future-launcher');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
}));
test('WhatsApp repeats open, close and reopen for its separate popup', () => fixture(async ({ click }) => {
  let opened = 0;
  let popup;
  window.open = () => { opened++; popup = { closed: false, focus() {}, close() { this.closed = true; }, location: { replace() {} } }; return popup; };
  const button = await click('.whatsapp-launcher');
  assert.equal(opened, 1);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  await click('.whatsapp-launcher');
  assert.equal(popup.closed, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  await click('.whatsapp-launcher');
  assert.equal(opened, 2);
}));

test('Support follows Legacy Bot in the right dock and Gemini is absent', () => fixture(async () => {
  await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); });
  assert.equal(document.querySelector('.floating-actions-ai'), null);
  const right = document.querySelector('.floating-actions-communications');
  assert.deepEqual([...right.querySelectorAll('button')].map(button => button.textContent), ['WhatsApp', 'PolicyTek', 'RingCentral', 'Legacy Bot', 'Support']);
  assert.match(right.querySelector('.legacy-bot-control .launcher-brand-icon').style.backgroundImage, /hubspot\.ico/);
  assert.doesNotMatch(document.body.textContent, /Gemini/);
}));

test('Support sits after Legacy Bot and preserves its ticket iframe when collapsed', () => fixture(async ({ click }) => {
  // The portal attaches on the next animation frame.
  await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); });
  const bot = document.querySelector('.legacy-bot-control');
  const button = document.querySelector('.support-launcher');
  assert.ok(button);
  assert.ok(bot.compareDocumentPosition(button) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(button.querySelector('svg'), 'life-ring icon');
  assert.equal(button.textContent, 'Support');
  await click('.support-launcher');
  const panel = document.getElementById('support-panel');
  const frame = panel.querySelector('iframe');
  assert.equal(frame.src, 'https://50894788.hs-sites.com/legacy-partners-knowledge/kb-tickets/new');
  assert.equal(panel.hidden, false);
  await click('.support-launcher');
  assert.equal(panel.hidden, true);
  await click('.support-launcher');
  assert.equal(panel.querySelector('iframe'), frame);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  await act(async () => panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, button);
  await click('.support-launcher');
  await click('[aria-label="Close Support"]');
  assert.equal(panel.hidden, true);
}));
