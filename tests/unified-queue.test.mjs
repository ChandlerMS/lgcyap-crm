import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);

test('Queue renders both named live dashboards at once without nested main landmarks', async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp('work/queue-render-');
  try {
    const outfile = `${directory}/page.cjs`;
    await build({
      entryPoints: ['./app/queue/unified-queue.tsx'], outfile, bundle: true,
      platform: 'node', format: 'cjs',
      external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
      loader: { '.css': 'empty' }, logLevel: 'silent',
      // Use the real Next Image component, normalizing its CJS default export
      // for this direct Node renderer rather than replacing it with a mock.
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
    const Page = imported.default.default;
    const html = renderToStaticMarkup(createElement(Page));
    assert.match(html, /<h1[^>]*>Queue<\/h1>/);
    assert.match(html, /<h2[^>]*>Shopper<\/h2>/);
    assert.match(html, /<h2[^>]*>Standard vs Preferred<\/h2>/);
    assert.match(html, /Connecting to PolicyTek/);
    assert.match(html, /Connecting to RingCX/);
    assert.equal((html.match(/<h3>Total Calls<\/h3>/g) || []).length, 2);
    assert.match(html, /Answered today/);
    assert.doesNotMatch(html, /Today’s calls|Today’s inbound calls|<footer/);
    assert.equal((html.match(/<main\b/g) || []).length, 1);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
