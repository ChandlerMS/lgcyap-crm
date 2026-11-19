import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);

test('Event Attendance renders as its own page and as a section of the Recruiting Dashboard', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/attendance-render-');
  try {
    const outfile = `${directory}/board.cjs`;
    await build({
      entryPoints: ['./app/event-attendance/event-attendance-board.tsx'], outfile, bundle: true,
      platform: 'node', format: 'cjs',
      external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
      loader: { '.css': 'empty' }, logLevel: 'silent',
      // The real Next Image component, with its CJS default export normalized for this direct Node renderer.
      plugins: [{
        name: 'next-image-cjs-interop',
        setup(builder) {
          builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next-image', namespace: 'interop' }));
          builder.onLoad({ filter: /.*/, namespace: 'interop' }, () => ({
            contents: `export { Image as default } from ${JSON.stringify(require.resolve('next/dist/client/image-component.js'))}`,
            loader: 'js', resolveDir: process.cwd(),
          }));
        },
      }],
    });
    const imported = await import(pathToFileURL(`${process.cwd()}/${outfile}`).href);
    const Board = imported.default.default;

    const page = renderToStaticMarkup(createElement(Board));
    // The logo's preload link comes first, then the page's main landmark.
    assert.match(page, /^(?:<link [^>]*\/>)*<main\b/);
    assert.match(page, /<h1 id="event-attendance-title">Event Attendance<\/h1>/);
    assert.match(page, /legacy-logo\.png/);

    // On the dashboard: no second main landmark or h1, no logo, and the section is named by its heading.
    const section = renderToStaticMarkup(createElement(Board, { section: true }));
    assert.match(section, /^<section [^>]*aria-labelledby="event-attendance-title"/);
    assert.match(section, /<h2 id="event-attendance-title">Event Attendance<\/h2>/);
    assert.doesNotMatch(section, /<main\b|<h1\b|legacy-logo\.png|>Legacy Agency Partners</);
    assert.match(section, /Loading hiring event attendance from HubSpot/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
