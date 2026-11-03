import test from 'node:test';
import assert from 'node:assert/strict';
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

test('local and preview builds remain available; production target cannot masquerade as preview', () => {
  const unexpected = () => { throw new Error('Should not contact GitHub'); };
  assert.deepEqual(verifyProductionSource({ env: {}, readMainSha: unexpected }), { production: false });
  assert.deepEqual(verifyProductionSource({ env: { VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview' }, readMainSha: unexpected }), { production: false });
  assert.throws(() => verifyProductionSource({ env: { VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'production' }, readMainSha: () => current }), /Production deployment blocked/);
});
