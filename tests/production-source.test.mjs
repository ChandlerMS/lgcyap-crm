import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyProductionSource } from '../scripts/verify-production-source.mjs';

const current = 'a'.repeat(40);
const env = {
  VERCEL: '1', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production',
  VERCEL_PROJECT_ID: 'prj_tAhuHcbCr3HXxant1EGPbaFLjc6E',
  VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'ChandlerMS',
  VERCEL_GIT_REPO_SLUG: 'lgcyap-crm', VERCEL_GIT_REPO_ID: '1439230490',
  VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: current,
};

test('production requires the exact repository, main branch and current remote commit', () => {
  assert.deepEqual(verifyProductionSource({ env, readMainSha: () => current }), { production: true, sha: current });
  for (const overrides of [
    { VERCEL: undefined }, { VERCEL_PROJECT_ID: 'wrong-project' },
    { VERCEL_GIT_PROVIDER: undefined }, { VERCEL_GIT_REPO_OWNER: 'other' },
    { VERCEL_GIT_REPO_SLUG: 'other' }, { VERCEL_GIT_REPO_ID: 'other' },
    { VERCEL_GIT_COMMIT_REF: 'older-branch' }, { VERCEL_GIT_COMMIT_REF: 'HEAD' },
    { VERCEL_GIT_COMMIT_SHA: undefined }, { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) },
  ]) assert.throws(() => verifyProductionSource({ env: { ...env, ...overrides }, readMainSha: () => current }), /Production deployment blocked/);
});

test('production fails closed when main HEAD cannot be verified', () => {
  for (const readMainSha of [() => { throw new Error('Network error'); }, () => '', () => 'refs/heads/main']) assert.throws(() => verifyProductionSource({ env, readMainSha }), /Production deployment blocked/);
});

test('production cannot remove Legacy Bot or switch its HubSpot account', () => {
  const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const withoutBot = source.replace(/<Script\b[\s\S]*?\/>/g, '');
  const wrongAccount = source.replace('50894788', '123');
  for (const altered of [withoutBot, wrongAccount]) {
    assert.throws(() => verifyProductionSource({ env, readMainSha: () => current, readBotSource: () => altered }), /Legacy Bot embed is missing or uses the wrong HubSpot account/);
  }
  assert.throws(() => verifyProductionSource({ env, readMainSha: () => current, readBotSource: () => { throw new Error('Missing source'); } }), /Legacy Bot embed could not be checked/);
});

test('local and preview builds remain available; production target cannot masquerade as preview', () => {
  const unexpected = () => { throw new Error('Should not contact GitHub'); };
  assert.deepEqual(verifyProductionSource({ env: {}, readMainSha: unexpected }), { production: false });
  assert.deepEqual(verifyProductionSource({ env: { VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview' }, readMainSha: unexpected }), { production: false });
  assert.throws(() => verifyProductionSource({ env: { VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'production' }, readMainSha: () => current }), /Production deployment blocked/);
});
