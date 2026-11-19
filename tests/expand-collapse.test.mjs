import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
const require = createRequire(import.meta.url);

test('bulk controls coordinate sections, summary cards, explicit toggles and native disclosures; individual toggles stay independent', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/expand-collapse-');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://example.test' });
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    await writeFile(`${dir}/entry.tsx`, `export * from '../../app/expand-collapse'; export * from '../../app/dashboard-section'; export { default as SummaryChips } from '../../app/summary-chips';`);
    await build({ entryPoints: [`${dir}/entry.tsx`], outfile: `${dir}/bundle.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const { ExpandCollapseProvider, ExpandCollapseControls, DashboardSection, SectionToggle, CollapsibleCards, SummaryChips } = require(`${process.cwd()}/${dir}/bundle.cjs`);
    const css = await readFile('app/globals.css', 'utf8');
    const collapseRule = css.match(/\.dashboard-section\.is-collapsed > \* > [^{]+\{ display: none; \}/)[0];
    const style = document.createElement('style'); style.textContent = collapseRule; document.head.append(style);
    const panel = id => h(DashboardSection, { id, label: id }, h('section', null, h('header', { 'data-section-heading': true }, h('h2', null, id), h(SectionToggle)), h('p', null, 'Panel contents'), h('div', { className: 'nested-table' }, h(SectionToggle, { collapsed: false, onToggle: () => {}, label: 'Nested table' }))));
    root = createRoot(document.getElementById('app'));
    await act(async () => root.render(h(ExpandCollapseProvider, null, h(ExpandCollapseControls), panel('Tasks'), panel('Meetings'), h(CollapsibleCards, null, h(SummaryChips, { id: 'summary', title: 'Summary', count: '3', note: 'Yours', chips: [], empty: 'None', more: { label: 'items' }, lead: h('button', null, '+') })), h('nav', null, h('details', { id: 'navigation' }, h('summary', null, 'Navigation'))), h('main', null, h('details', { id: 'pipeline' }, h('summary', null, 'Pipeline'), h('p', null, 'Stages'))))));
    const click = async text => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text); assert.ok(button, text); await act(async () => button.click()); };
    const summaryHead = document.querySelector('.summary-card-head');
    const count = summaryHead.querySelector('.summary-card-count');
    const plus = [...summaryHead.querySelectorAll('button')].find(button => button.textContent === '+');
    const toggle = summaryHead.querySelector('.section-toggle');
    assert.ok(count.compareDocumentPosition(plus) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(plus.compareDocumentPosition(toggle) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    await click('Collapse All');
    assert.equal(document.querySelectorAll('.dashboard-section.is-collapsed').length, 2);
    assert.ok(document.querySelector('.summary-card.is-collapsed'));
    assert.equal(window.getComputedStyle(document.querySelector('.nested-table')).display, 'none');
    assert.notEqual(window.getComputedStyle(document.querySelector('[data-section-heading]')).display, 'none');
    assert.equal(document.querySelector('#pipeline').open, false);
    assert.equal(JSON.parse(window.localStorage.getItem('crm:dashboard-collapsed')).Tasks, true);
    await click('Expand Tasks');
    assert.equal(document.querySelector('#dashboard-section-Tasks .section-toggle').getAttribute('aria-expanded'), 'true');
    assert.ok(document.querySelector('#dashboard-section-Meetings').classList.contains('is-collapsed'));
    await click('Expand All'); await click('Expand All');
    assert.equal(document.querySelectorAll('.is-collapsed').length, 0);
    assert.equal(document.querySelector('#pipeline').open, true);
    assert.equal(document.querySelector('#navigation').open, false);
    await click('Collapse All'); await click('Collapse All');
    assert.equal(document.querySelectorAll('.dashboard-section.is-collapsed').length, 2);
    assert.equal(document.querySelector('#pipeline').open, false);
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); await rm(dir, { recursive: true, force: true });
  }
});
