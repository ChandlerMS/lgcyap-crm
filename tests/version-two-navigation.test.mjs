import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Exercise the real page and Next redirect implementation, with only the sign-in boundary isolated.
test('Version 2 requires CRM sign-in, then navigates directly to Onboard outside an iframe', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/version-two-navigation-');
  try {
    await build({ stdin: { contents: 'export { default as Page } from "./app/v2/page"; export { calls } from "./app/app-auth";', resolveDir: process.cwd(), loader: 'tsx' }, outfile: `${dir}/page.cjs`, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/*', 'next/navigation'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'test-sign-in', setup(builder) {
      builder.onResolve({ filter: /app-auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const calls=[]; export async function requireAppUser(path) { calls.push(path); if (globalThis.__denyVersionTwo) throw new Error("SIGN_IN_REQUIRED"); }' }));
    } }] });
    const { Page, calls } = createRequire(import.meta.url)(`${process.cwd()}/${dir}/page.cjs`);
    globalThis.__denyVersionTwo = true;
    await assert.rejects(Page(), /SIGN_IN_REQUIRED/);
    globalThis.__denyVersionTwo = false;
    await assert.rejects(Page(), error => error.digest === 'NEXT_REDIRECT;replace;https://lgcy-onboard.carlos-831.workers.dev/;307;');
    assert.deepEqual(calls, ['/v2', '/v2']);
  } finally {
    delete globalThis.__denyVersionTwo;
    await rm(dir, { recursive: true, force: true });
  }
});
