import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);

test('provider buttons open separate windows securely and offer a fallback when blocked', async () => {
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
    const urls = ['https://gemini.google.com/app', 'https://claude.ai/', 'https://chatgpt.com/', 'https://grok.com/'];
    const buttons = [...document.querySelectorAll('.ai-provider-launcher')];
    const opened = [];
    window.open = (...args) => {
      const popup = { opener: window, location: { replace(url) {
        assert.equal(popup.opener, null);
        popup.url = url;
      } }, focus() { popup.focused = true; } };
      opened.push({ args, popup });
      return popup;
    };
    for (const [index, button] of buttons.entries()) {
      await act(async () => button.click());
      assert.equal(opened[index].args[0], 'about:blank');
      assert.equal(opened[index].args[1], '_blank');
      assert.match(opened[index].args[2], /popup=yes/);
      assert.equal(opened[index].popup.url, urls[index]);
      assert.equal(opened[index].popup.focused, true);
    }
    assert.equal(document.querySelectorAll('iframe').length, 0);
    window.open = () => null;
    await act(async () => buttons[1].click());
    const fallback = document.querySelector('[role="status"] a');
    assert.equal(fallback.href, urls[1]);
    assert.equal(fallback.target, '_blank');
    assert.equal(fallback.rel, 'noopener noreferrer');
    await act(async () => document.querySelector('[aria-label="Dismiss popup notice"]').click());
    assert.equal(document.querySelector('[role="status"]'), null);
  } finally {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
