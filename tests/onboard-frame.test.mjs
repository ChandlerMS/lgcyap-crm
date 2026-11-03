import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardFrameState, startOnboardFrame } from '../lib/onboard-frame.mjs';

function document(state) {
  return {
    URL: state === 'blank' ? 'about:blank' : 'https://crm.example.invalid/v2/app',
    readyState: 'complete',
    getElementById(id) {
      if (state === 'error' || state === 'blank') return null;
      if (id === 'main') return { childElementCount: state === 'pending' ? 0 : 1 };
      if (id === 'me') return {};
      return id === 'signOut' && state !== 'pending' ? {} : null;
    },
    querySelector() { return state === 'state-error' ? { textContent: 'not saved (HTTP 409)' } : null; },
  };
}
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const events = new Map();
  const navigations = [];
  const states = [];
  let frame;
  const createFrame = () => frame = {
    contentDocument: document('blank'),
    set src(value) { navigations.push(value); },
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name) { events.delete(name); },
  };
  const stop = startOnboardFrame(createFrame, { onState: state => states.push(state), timeoutMs: 1000 });
  const commit = state => { frame.contentDocument = document(state); events.get('load')?.(); };
  return { get frame() { return frame; }, navigations, states, stop, commit };
}

test('blank document and source shell are not treated as a loaded app', () => {
  assert.equal(onboardFrameState({ contentDocument: document('blank') }), 'loading');
  assert.equal(onboardFrameState({ contentDocument: document('pending') }), 'loading');
  assert.equal(onboardFrameState({ contentDocument: document('ready') }), 'ready');
  assert.equal(onboardFrameState({ contentDocument: document('state-error') }), 'failed');
});

test('a failed first document recovers automatically without refreshing the parent', t => {
  const f = fixture(t);
  const failedFrame = f.frame;
  f.commit('error');
  t.mock.timers.tick(500);
  assert.deepEqual(f.navigations, ['/v2/app', '/v2/app?startup=2']);
  assert.notEqual(f.frame, failedFrame);
  // The previous error document stays accessible until the new response arrives.
  t.mock.timers.tick(400);
  assert.equal(f.navigations.length, 2);
  f.commit('ready');
  assert.deepEqual(f.states, ['loading', 'ready']);
  t.mock.timers.tick(60000);
  assert.equal(f.navigations.length, 2);
});

test('the source can finish async sign-in after the frame load event', t => {
  const f = fixture(t);
  f.commit('pending');
  t.mock.timers.tick(400);
  assert.deepEqual(f.states, ['loading']);
  f.frame.contentDocument = document('ready');
  t.mock.timers.tick(200);
  assert.deepEqual(f.states, ['loading', 'ready']);
  assert.equal(f.navigations.length, 1);
});

test('a hung startup has bounded recovery and exposes a retry instead of staying blank', t => {
  const f = fixture(t);
  for (let attempt = 1; attempt <= 3; attempt++) {
    t.mock.timers.tick(1000);
    t.mock.timers.tick(500);
  }
  assert.equal(f.navigations.length, 3);
  assert.deepEqual(f.states, ['loading', 'failed']);
  t.mock.timers.tick(60000);
  assert.equal(f.navigations.length, 3);
});

test('once ready, subsequent failures never reload an app that may contain edits', t => {
  const f = fixture(t);
  f.commit('ready');
  f.commit('state-error');
  t.mock.timers.tick(60000);
  assert.equal(f.navigations.length, 1);
  assert.deepEqual(f.states, ['loading', 'ready']);
});

test('leaving Version 2 cancels pending recovery', t => {
  const f = fixture(t);
  f.commit('error');
  f.stop();
  t.mock.timers.tick(60000);
  assert.equal(f.navigations.length, 1);
  assert.deepEqual(f.states, ['loading']);
});
