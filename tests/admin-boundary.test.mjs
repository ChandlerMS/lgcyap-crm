import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('admin HTTP boundary rejects anonymous, ordinary and cross-origin callers before any permission operation', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/admin-boundary-');
  const originalOrigin = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = 'https://crm.example.test';
  try {
    await build({ entryPoints: ['app/api/admin/admin-auth.ts'], outfile: `${dir}/boundary.cjs`, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'verified-session-boundary', setup(builder) { builder.onResolve({ filter: /^@\/app\/app-auth$/ }, () => ({ path: 'session', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export async function getAppUser() { return globalThis.__adminBoundarySession; }', loader: 'js' })); } }] });
    const { adminRequest, inputJson } = require(`${process.cwd()}/${dir}/boundary.cjs`);
    const request = origin => new Request('https://crm.example.test/api/admin/access', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    globalThis.__adminBoundarySession = null;
    await assert.rejects(adminRequest(request('https://crm.example.test'), true), error => error.status === 401);
    globalThis.__adminBoundarySession = { userId: 'ordinary', email: 'editor@lgcyap.com' };
    await assert.rejects(adminRequest(request('https://crm.example.test'), true), error => error.status === 403);
    globalThis.__adminBoundarySession = { userId: 'admin', email: 'chandler@lgcyap.com' };
    await assert.rejects(adminRequest(request('https://evil.example'), true), error => error.status === 403);
    assert.equal((await adminRequest(request('https://crm.example.test'), true)).email, 'chandler@lgcyap.com');
    for (const body of ['null', '[]', '{invalid']) await assert.rejects(inputJson(new Request('https://crm.example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })), error => error.status === 400);
    await assert.rejects(inputJson(new Request('https://crm.example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) })), error => error.status === 413);
  } finally {
    if (originalOrigin === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = originalOrigin;
    delete globalThis.__adminBoundarySession;
    await rm(dir, { recursive: true, force: true });
  }
});
