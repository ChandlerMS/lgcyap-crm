import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { NextRequest } from 'next/server.js';
const require = createRequire(import.meta.url);
test('public website domains preserve the source path and assets without sending CRM credentials upstream', async () => {
  await mkdir('work', { recursive: true }); const dir = await mkdtemp('work/domain-routing-');
  try {
    await build({ entryPoints: ['proxy.ts'], outfile: `${dir}/proxy.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['next/server'], logLevel: 'silent' });
    const { proxy } = require(`${process.cwd()}/${dir}/proxy.cjs`);
    for (const host of ['lgcyap.com', 'www.lgcyap.com']) {
      for (const path of ['/', '/home.css', '/home.js', '/assets/logo.png', '/about?source=public', '//evil.example/private']) {
        const response = proxy(new NextRequest(`https://${host}${path}`, { headers: { cookie: 'better-auth.session_token=private', authorization: 'Bearer private', 'proxy-authorization': 'private' } }));
        assert.equal(response.headers.get('x-middleware-rewrite'), `https://lgcyap.vercel.app${path}`);
        assert.equal(response.headers.get('x-middleware-request-cookie'), null);
        assert.equal(response.headers.get('x-middleware-request-authorization'), null);
        assert.equal(response.headers.get('x-middleware-request-proxy-authorization'), null);
      }
      for (const path of ['/sign-in?return_to=%2F', '/api/auth/callback/google?state=state&code=code', '/admin']) {
        const response = proxy(new NextRequest(`https://${host}${path}`));
        assert.equal(response.status, 307); assert.equal(response.headers.get('location'), `https://crm.lgcyap.com${path}`);
      }
    }
    for (const host of ['crm.lgcyap.com', 'queue.lgcyap.com', 'leaderboard.lgcyap.com', 'lgcyap-crm.vercel.app', 'evil-lgcyap.com']) {
      const response = proxy(new NextRequest(`https://${host}/api/auth/callback/google`));
      assert.equal(response.headers.get('x-middleware-next'), '1');
      assert.equal(response.headers.get('x-middleware-rewrite'), null);
      assert.equal(response.headers.get('location'), null);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
