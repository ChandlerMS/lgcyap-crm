import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PAGES, AGENT_PORTAL_PAGES, GOOGLE_WORKSPACE_PAGES, RECRUIT_PORTAL_PAGES, KNOWLEDGE_CENTER_PAGE, externalWorkspacePage } from '../app/external-workspace-pages.mjs';
import { resolveWorkspaceRoute, sidebarViewFor } from '../app/recruiting-navigation.mjs';

test('Admin and Agents keep each requested destination and distinguish RingEX from RingCX', () => {
  assert.deepEqual(ADMIN_PAGES.map(page => [page.label, page.url]), [
    ['PolicyTek', 'https://app.policytek.com/admin'],
    ['RingEX', 'https://service.ringcentral.com/application/adminHome'],
    ['RingCX', 'https://ringcx.ringcentral.com/voice/admin/home'],
    ['HubSpot', 'https://app.hubspot.com/settings/50894788/users/active_users'],
    ['Google Admin', 'https://admin.google.com/u/1/ac/home'],
  ]);
  assert.deepEqual(AGENT_PORTAL_PAGES.map(page => [page.label, page.url]), [
    ['Lead Payments', 'https://trainerleadpayment.lgcyagent.com/'],
    ['PolicyTek Agents', 'https://app.policytek.com/agents'],
    ['PolicyTek Agent Call Plans', 'https://app.policytek.com/lead-distribution/member/agent-plans'],
  ]);
  assert.notEqual(ADMIN_PAGES[1].detail, ADMIN_PAGES[2].detail);
});
test('every embedded route resolves independently and highlights its parent menu', () => {
  for (const page of [...ADMIN_PAGES, ...AGENT_PORTAL_PAGES, ...GOOGLE_WORKSPACE_PAGES, ...RECRUIT_PORTAL_PAGES, KNOWLEDGE_CENTER_PAGE]) {
    assert.equal(resolveWorkspaceRoute(`#${page.id}`).view, page.id);
    assert.equal(externalWorkspacePage(page.id), page);
    assert.equal(sidebarViewFor(page.id), page.group === 'agents' ? 'contract-agents' : page.group);
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
    for (const page of [...ADMIN_PAGES, ...AGENT_PORTAL_PAGES, ...GOOGLE_WORKSPACE_PAGES, ...RECRUIT_PORTAL_PAGES, KNOWLEDGE_CENTER_PAGE]) {
      const html = renderToStaticMarkup(createElement(Page, { view: page.id }));
      assert.ok(html.includes(`src="${page.url}"`));
      assert.ok(html.includes(`href="${page.url}" target="_blank" rel="noopener noreferrer"`));
      assert.ok(html.includes(`title="${page.label} · ${page.detail}"`));
      if (page.id === "lead-payments") assert.match(html, /<div class="shopper-embed lead-payments-embed"><iframe[^>]*class="shopper-embed-frame"/);
      else if (page.id === "knowledge-center") assert.match(html, /<div class="shopper-embed knowledge-center-embed"><iframe[^>]*class="shopper-embed-frame"/);
      else if (page.id === "contracting-portal") assert.match(html, /<div class="shopper-embed"><iframe[^>]*class="shopper-embed-frame"/);
      else assert.match(html, /class="policytek-frame"/);
    }
    assert.equal(renderToStaticMarkup(createElement(Page, { view: 'https://evil.example' })), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Recruits Contracting opens the fixed portal without replacing the recruiting stage route', async () => {
  const { RECRUITS_CHILD_PAGES } = await import('../app/recruiting-navigation.mjs');
  assert.ok(RECRUITS_CHILD_PAGES.some(page => page.id === 'contracting-portal' && page.label === 'Contracting'));
  assert.deepEqual(resolveWorkspaceRoute('#contracting-portal'), { view: 'contracting-portal' });
  assert.equal(sidebarViewFor('contracting-portal'), 'recruits');
  assert.equal(externalWorkspacePage('contracting-portal')?.url, 'https://contracting.lgcyagent.com/');
  assert.deepEqual(resolveWorkspaceRoute('#contracting'), { view: 'contracting' });
  assert.equal(externalWorkspacePage('contracting'), undefined);
});


test('Knowledge Center is its own sidebar destination directly below Admin', async () => {
  assert.deepEqual(resolveWorkspaceRoute('#knowledge-center'), { view: 'knowledge-center' });
  assert.equal(sidebarViewFor('knowledge-center'), 'knowledge-center');
  assert.equal(externalWorkspacePage('knowledge-center')?.url, 'https://50894788.hs-sites.com/legacy-partners-knowledge');
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('app/recruiting-workspace.tsx', 'utf8');
  assert.ok(source.indexOf('href="#knowledge-center"') > source.indexOf('<SidebarFlyout id="admin-links"'));
  assert.ok(source.indexOf('href="#knowledge-center"') < source.indexOf('className="signout-link"'));
});
