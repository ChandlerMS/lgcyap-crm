import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTrainingClasses, canManageClasses } from '../lib/training-class-request.mjs';
const user = { userId: 'verified', email: 'editor@example.test' };
const env = { RECRUITING_EDITOR_EMAILS: user.email, RECRUITING_WRITES_ENABLED: 'true', VERCEL: '1', VERCEL_ENV: 'production', BETTER_AUTH_URL: 'https://crm.example.test' };
const request = (body = { action: 'save', name: 'Class' }, origin = env.BETTER_AUTH_URL) => new Request('https://crm.example.test/api/training-classes', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('unsigned and unauthorized users cannot read or write, and cross-origin or preview writes fail before persistence', async () => {
  let reads = 0, writes = 0;
  const deps = { getUser: async () => user, env, list: async () => { reads++; return []; }, save: async () => { writes++; return {}; } };
  const read = () => new Request('https://crm.example.test/api/training-classes');
  assert.equal((await handleTrainingClasses(read(), { ...deps, getUser: async () => null })).status, 401);
  assert.equal((await handleTrainingClasses(read(), { ...deps, getUser: async () => ({ userId: 'x', email: 'outsider@example.test' }) })).status, 403);
  assert.equal(reads, 0);
  const response = await handleTrainingClasses(read(), deps);
  assert.deepEqual(await response.json(), { classes: [], canManage: true });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  for (const changed of [{ VERCEL_ENV: 'preview' }, { RECRUITING_WRITES_ENABLED: 'false' }, { VERCEL: undefined }]) {
    assert.equal(canManageClasses(user, { ...env, ...changed }), false);
    assert.equal((await handleTrainingClasses(request(), { ...deps, env: { ...env, ...changed } })).status, 403);
  }
  assert.equal((await handleTrainingClasses(request(undefined, 'https://attacker.test'), deps)).status, 403);
  assert.equal(writes, 0);
  assert.equal((await handleTrainingClasses(request(), deps)).status, 200);
  assert.equal(writes, 1);
});
test('invalid and oversized bodies cannot write; conflicts survive but internal errors stay private', async () => {
  const deps = { getUser: async () => user, env, save: async () => { throw Object.assign(new Error('Refresh the schedule.'), { status: 409 }); }, list: async () => { throw new Error('credential secret'); } };
  assert.equal((await handleTrainingClasses(request({ action: 'delete' }), deps)).status, 400);
  assert.equal((await handleTrainingClasses(request({ action: 'save', notes: 'x'.repeat(20000) }), deps)).status, 413);
  assert.equal((await handleTrainingClasses(request(), deps)).status, 409);
  const result = await handleTrainingClasses(new Request('https://crm.example.test/api/training-classes'), deps);
  assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(await result.json()), /credential|secret/);
  const canceled = await handleTrainingClasses(request({ action: 'cancel', id: 'id', version: 1 }), { ...deps, cancel: async (input, actor) => ({ ...input, actor, status: 'canceled' }) });
  assert.equal((await canceled.json()).class.status, 'canceled');
});
