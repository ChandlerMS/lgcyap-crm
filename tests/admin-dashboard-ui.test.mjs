import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);

test('dashboard hides permission controls from denied users and saves a confirmed CRM revocation', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/admin-ui-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.example.test' });
  const before = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.confirm = () => true;
  let root;
  try {
    await build({ entryPoints: ['app/admin/admin-dashboard.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'oauth-boundary', setup(builder) { builder.onResolve({ filter: /^@\/lib\/auth-client$/ }, () => ({ path: 'auth-client', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const authClient = { linkSocial: async () => ({}) };', loader: 'js' })); } }] });
    const Dashboard = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    globalThis.fetch = async () => Response.json({ error: 'Only Chandler and Sarah can manage access.' }, { status: 403 });
    root = createRoot(document.getElementById('app'));
    await act(async () => { root.render(createElement(Dashboard)); await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.match(document.body.textContent, /Only Chandler and Sarah/);
    assert.equal(document.querySelector('input'), null);
    await act(async () => root.unmount());
    let allowed = true; const writes = [];
    globalThis.fetch = async (path, options = {}) => {
      if (options.method === 'POST') { const input = JSON.parse(options.body); writes.push({ path, input }); allowed = input.allowed; return Response.json({ status: 'saved' }); }
      if (path === '/api/admin/access') return Response.json({ viewer: 'chandler@lgcyap.com', users: [{ email: 'editor@lgcyap.com', allowed, administrator: false, user: { id: 'u', name: 'Editor' } }, { email: 'chandler@lgcyap.com', allowed: true, administrator: true, user: { id: 'admin', name: 'Chandler' } }], audit: [] });
      return Response.json({ error: 'Connect Google Workspace to allow directory and administrator role management.' }, { status: 403 });
    };
    root = createRoot(document.getElementById('app'));
    await act(async () => { root.render(createElement(Dashboard)); await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.match(document.body.textContent, /Connect Google Workspace/);
    const revoke = [...document.querySelectorAll('button')].find(button => button.textContent === 'Revoke access' && !button.disabled);
    assert.ok(revoke);
    await act(async () => revoke.click());
    assert.deepEqual(writes, [{ path: '/api/admin/access', input: { email: 'editor@lgcyap.com', allowed: false } }]);
    assert.match(document.body.textContent, /Revoked/);
    assert.match(document.body.textContent, /Permission change saved/);
    assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === 'Revoke access').disabled, true);
  } finally { if (root) await act(async () => root.unmount()); Object.assign(globalThis, before); delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close(); await rm(dir, { recursive: true, force: true }); }
});
