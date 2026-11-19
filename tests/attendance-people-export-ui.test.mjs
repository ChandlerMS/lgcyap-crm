import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);
test('attendance CSV and XLS buttons download their respective formats using the current rows', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/attendance-export-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://crm.test' });
  const before = { window: globalThis.window, document: globalThis.document, flag: globalThis.IS_REACT_ACT_ENVIRONMENT, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const blobs = [], names = [];
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:synthetic'; }; URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
  let root;
  try {
    await build({ entryPoints: ['app/event-attendance/people-export.tsx'], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const Export = require(`${process.cwd()}/${dir}/bundle.cjs`).default;
    root = createRoot(document.getElementById('app'));
    const render = rows => root.render(createElement(Export, { title: 'Everyone who signed in', rows }));
    await act(async () => render([{ name: 'Attendee A', email: 'qa@example.test', signIns: 2 }]));
    const click = async label => act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === label).click(); await new Promise(resolve => setTimeout(resolve, 25)); });
    await click('Export CSV');
    assert.match(names[0], /\.csv$/); assert.match(await blobs[0].text(), /Attendee A/);
    await act(async () => render([{ name: 'Filtered attendee', email: 'filtered@example.test', signIns: 1 }]));
    await click('Export XLS');
    assert.match(names[1], /\.xlsx$/);
    assert.equal(blobs[1].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const readXlsx = (await import('read-excel-file/node')).default;
    const [{ data }] = await readXlsx(Buffer.from(await blobs[1].arrayBuffer()));
    assert.equal(data.length, 2); assert.equal(data[1][0], 'Filtered attendee');
    await act(async () => render([]));
    assert.ok([...document.querySelectorAll('button')].every(button => button.disabled));
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = before.window; globalThis.document = before.document; globalThis.IS_REACT_ACT_ENVIRONMENT = before.flag; URL.createObjectURL = before.create; URL.revokeObjectURL = before.revoke;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
