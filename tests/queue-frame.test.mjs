import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../next.config.ts';
import { resolveWorkspaceRoute } from '../app/recruiting-navigation.mjs';

test('Queue stays addressable inside workspace navigation', () => {
  assert.deepEqual(resolveWorkspaceRoute('#queue'), { view: 'queue' });
  assert.deepEqual(resolveWorkspaceRoute('#ringcx'), { view: 'ringcx' });
  assert.deepEqual(resolveWorkspaceRoute('#today'), { view: 'today' });
});

test('Queue permits same-origin framing while private pages retain their embedding restrictions', async () => {
  const rules = await config.headers();
  function effective(path) {
    const values = new Map();
    for (const rule of rules) if (rule.source === '/:path*' || rule.source === path) for (const header of rule.headers) values.set(header.key.toLowerCase(), header.value);
    return values;
  }
  const queue = effective('/queue');
  assert.equal(queue.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(queue.get('content-security-policy'), /frame-ancestors 'self';/);
  assert.doesNotMatch(queue.get('content-security-policy'), /frame-ancestors \*|https?:/);
  assert.match(queue.get('cache-control'), /private, no-store/);
  assert.equal(effective('/ringcx').get('x-frame-options'), 'SAMEORIGIN');
  assert.match(effective('/ringcx').get('content-security-policy'), /frame-ancestors 'self';/);
  assert.match(effective('/ringcx').get('cache-control'), /private, no-store/);
  for (const path of ['/', '/sign-in', '/sign-out', '/other']) {
    assert.equal(effective(path).get('x-frame-options'), 'DENY');
    assert.match(effective(path).get('content-security-policy'), /frame-ancestors 'none';/);
  }
});
