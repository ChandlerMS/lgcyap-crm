import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PAGES, AGENT_PORTAL_PAGES, externalWorkspacePage } from '../app/external-workspace-pages.mjs';
import { resolveWorkspaceRoute, sidebarViewFor } from '../app/recruiting-navigation.mjs';

test('Admin and Agents keep each requested destination and distinguish the two RingCX consoles', () => {
  assert.deepEqual(ADMIN_PAGES.map(page => [page.label, page.url]), [
    ['PolicyTek Admin', 'https://app.policytek.com/admin'],
    ['RingCX Admin', 'https://service.ringcentral.com/application/adminHome'],
    ['RingCX Admin', 'https://ringcx.ringcentral.com/voice/admin/home'],
    ['HubSpot Admin', 'https://app.hubspot.com/settings/50894788/users/active_users'],
  ]);
  assert.deepEqual(AGENT_PORTAL_PAGES.map(page => [page.label, page.url]), [
    ['PolicyTek Agents', 'https://app.policytek.com/agents'],
    ['PolicyTek Agent Call Plans', 'https://app.policytek.com/lead-distribution/member/agent-plans'],
  ]);
  assert.notEqual(ADMIN_PAGES[1].detail, ADMIN_PAGES[2].detail);
});
test('every embedded route resolves independently and highlights its parent menu', () => {
  for (const page of [...ADMIN_PAGES, ...AGENT_PORTAL_PAGES]) {
    assert.equal(resolveWorkspaceRoute(`#${page.id}`).view, page.id);
    assert.equal(externalWorkspacePage(page.id), page);
    assert.equal(sidebarViewFor(page.id), page.group === 'admin' ? 'admin' : 'contract-agents');
  }
  for (const value of ['https://evil.example', '//evil.example', 'javascript:alert(1)', 'admin/unknown']) assert.equal(externalWorkspacePage(value), undefined);
});

test('each console renders its exact iframe and a working external fallback', async () => {
  const { build } = await import('esbuild');
  const { mkdir, mkdtemp, rm } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp('work/external-workspace-');
  try {
    await build({ entryPoints: ['app/external-workspace.tsx'], outfile: `${dir}/page.cjs`, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/*'], logLevel: 'silent' });
    const Page = createRequire(import.meta.url)(`${process.cwd()}/${dir}/page.cjs`).default;
    for (const page of [...ADMIN_PAGES, ...AGENT_PORTAL_PAGES]) {
      const html = renderToStaticMarkup(createElement(Page, { view: page.id }));
      assert.ok(html.includes(`src="${page.url}"`));
      assert.ok(html.includes(`href="${page.url}" target="_blank" rel="noopener noreferrer"`));
      assert.ok(html.includes(`title="${page.label} · ${page.detail}"`));
    }
    assert.equal(renderToStaticMarkup(createElement(Page, { view: 'https://evil.example' })), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
