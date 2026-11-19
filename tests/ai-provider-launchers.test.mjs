import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);

test('only Gemini remains and toggles its persistent iframe with close and Escape support', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/ai-providers-');
  const dom = new JSDOM('<div id="app"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    await build({ entryPoints: ['app/ai-provider-launchers.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], logLevel: 'silent' });
    const Component = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(createElement(Component)));
    assert.equal(document.querySelectorAll('iframe').length, 0);
    const urls = ['https://gemini.google.com/app'];
    const buttons = [...document.querySelectorAll('.ai-provider-launcher')];
    assert.deepEqual(buttons.map(button => button.textContent), ['Gemini']);
    window.open = () => { throw new Error('Gemini should embed, not open a popup'); };
    for (const [index, button] of buttons.entries()) {
      await act(async () => button.click());
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      assert.equal(panel.hidden, false);
      assert.equal(panel.querySelector('iframe').src, urls[index]);
      assert.equal(panel.querySelector('a').href, urls[index]);
      assert.equal(document.activeElement, panel.querySelector('h2'));
      assert.equal([...document.querySelectorAll('[role="dialog"]')].filter(item => !item.hidden).length, 1);
      const frame = panel.querySelector('iframe');
      await act(async () => button.click());
      assert.equal(panel.hidden, true);
      await act(async () => button.click());
      assert.equal(panel.hidden, false);
      assert.equal(panel.querySelector('iframe'), frame);
      await act(async () => panel.querySelector('button').click());
      assert.equal(panel.hidden, true);
      assert.equal(document.activeElement, button);
    }
    const frame = document.querySelector('iframe');
    await act(async () => buttons[0].click());
    assert.equal(document.querySelector('iframe'), frame);
    await act(async () => document.querySelector('[role="dialog"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(buttons[0].getAttribute('aria-expanded'), 'false');
  } finally {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
