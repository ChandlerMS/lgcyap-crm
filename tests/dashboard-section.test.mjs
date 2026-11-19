import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Bundles the dashboard section helpers and the summary card together, so they share one context.
async function load(directory) {
  const entry = `${directory}/entry.tsx`, outfile = `${directory}/bundle.cjs`;
  await writeFile(entry, `export * from '../../app/dashboard-section';\nexport { default as SummaryChips } from '../../app/summary-chips';\n`);
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], loader: { '.css': 'empty' }, logLevel: 'silent' });
  return (await import(pathToFileURL(`${process.cwd()}/${outfile}`).href)).default;
}

test('dashboard sections and summary cards collapse from a chevron at the right of their title row', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/dashboard-section-');
  try {
    const { DashboardSection, SectionToggle, CollapsibleCards, SummaryChips } = await load(directory);
    const panel = createElement('section', null, createElement('div', { className: 'heading' }, createElement('h2', null, 'Tasks'), createElement(SectionToggle)), createElement('p', null, 'Rows'));

    // In a section, the toggle names the section and starts expanded; the panel stays rendered either way.
    const open = renderToStaticMarkup(createElement(DashboardSection, { id: 'tasks', label: 'Tasks' }, panel));
    assert.match(open, /^<div id="dashboard-section-tasks" class="dashboard-section">/);
    assert.match(open, /<button type="button" class="section-toggle" aria-expanded="true" aria-controls="dashboard-section-tasks" aria-label="Collapse Tasks" title="Collapse Tasks">/);
    assert.match(open, /<p>Rows<\/p>/);
    assert.match(renderToStaticMarkup(createElement(DashboardSection, { id: 'pipeline', label: 'Pipeline', defaultCollapsed: true }, panel)), /class="dashboard-section is-collapsed"[\s\S]*aria-expanded="false"[\s\S]*aria-label="Expand Pipeline"/);
    // Outside the dashboard, such as on a full HubSpot page, there is no toggle.
    assert.doesNotMatch(renderToStaticMarkup(panel), /section-toggle/);

    // Summary cards get their own toggle only among the dashboard's collapsible cards.
    const card = createElement(SummaryChips, { id: 'task-chips-title', title: 'Tasks', note: 'Yours', chips: [], empty: 'None', more: { label: 'tasks' } });
    assert.match(renderToStaticMarkup(createElement(CollapsibleCards, null, card)), /<section id="task-chips-title-card" class="summary-chips summary-card"[\s\S]*aria-controls="task-chips-title-card" aria-label="Collapse Tasks"/);
    assert.doesNotMatch(renderToStaticMarkup(card), /section-toggle/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
