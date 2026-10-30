import test from 'node:test';
import assert from 'node:assert/strict';
import { stageIdForKey } from '../lib/recruiting-config.mjs';
import { stageTransitionChoices, saveRecruitStage, stageSnapshotAvailable, StageSaveError } from '../app/recruit-stage-save.mjs';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function recruitAt(stageKey, recruitingPath = 'genpop', licenseRoute = '') {
  const stageId = stageIdForKey(stageKey);
  assert.ok(stageId, `A verified stage binding is required for ${stageKey}.`);
  return { id: '123', name: 'Synthetic Recruit', stageId, stageKey, recruitingPath, licenseRoute,
    updatedAt: '2026-10-29T12:00:00.000Z', editValues: { hs_pipeline_stage: stageId, recruiting_path: recruitingPath, licensing_branch: licenseRoute } };
}
function savedAt(before, stageKey, licenseRoute = before.licenseRoute) {
  const next = recruitAt(stageKey, before.recruitingPath, licenseRoute);
  return { ...next, updatedAt: '2026-10-29T12:01:00.000Z' };
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('controls follow path-specific choices and retain explicit branching rather than array adjacency', () => {
  assert.deepEqual(stageTransitionChoices(recruitAt('phone-interview', 'genpop'), 'forward').map(choice => choice.stageKey), ['offer']);
  assert.deepEqual(stageTransitionChoices(recruitAt('phone-interview', 'mass_recruiting'), 'forward').map(choice => choice.stageKey), ['hiring-event']);
  assert.deepEqual(stageTransitionChoices(recruitAt('phone-interview', ''), 'forward'), []);
  assert.deepEqual(stageTransitionChoices(recruitAt('phone-interview', ''), 'back').map(choice => choice.stageKey), ['application']);
  assert.deepEqual(stageTransitionChoices(recruitAt('offer'), 'forward').map(choice => [choice.stageKey, choice.flowChanges]), [
    ['contracting', { licensing_branch: 'licensed' }], ['licensing-reminders', { licensing_branch: 'not_licensed' }],
  ]);
  assert.deepEqual(stageTransitionChoices(recruitAt('contracting', ''), 'back').map(choice => [choice.stageKey, choice.flowChanges]), [
    ['offer', { licensing_branch: 'licensed' }], ['licensed-npn', { licensing_branch: 'not_licensed' }],
  ]);
  assert.deepEqual(stageTransitionChoices(recruitAt('training', ''), 'forward').map(choice => choice.stageKey), ['completed', 'withdrawn']);
  for (const key of ['completed', 'withdrawn']) {
    assert.deepEqual(stageTransitionChoices(recruitAt(key, ''), 'back').map(choice => choice.stageKey), ['training']);
    assert.deepEqual(stageTransitionChoices(recruitAt(key, ''), 'forward'), []);
  }
  assert.deepEqual(stageTransitionChoices(recruitAt('training'), 'other'), []);
});

test('stage save sends one sparse reviewed POST and accepts only matching confirmed metadata', async () => {
  const recruit = recruitAt('training', ''), target = stageIdForKey('completed'), saved = savedAt(recruit, 'completed');
  const calls = [], controller = new AbortController();
  const result = await saveRecruitStage(recruit, target, { requestId, signal: controller.signal, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return json({ status: 'saved', requestId, recruit: saved, replayed: true });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/recruits/123');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(JSON.parse(calls[0].options.body), { expectedUpdatedAt: recruit.updatedAt, requestId, changes: { hs_pipeline_stage: target }, expectedValues: { hs_pipeline_stage: recruit.stageId } });
  assert.deepEqual(result, { recruit: saved, replayed: true });
});

test('an explicit Offer branch is sent atomically with its captured expected value and never overwrites source', async () => {
  const recruit = recruitAt('offer'), saved = savedAt(recruit, 'contracting', 'licensed'), calls = [];
  await saveRecruitStage(recruit, saved.stageId, { requestId, flowChanges: { licensing_branch: 'licensed' }, fetchImpl: async (url, options) => {
    calls.push(JSON.parse(options.body)); return json({ status: 'saved', requestId, recruit: saved });
  } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].changes, { hs_pipeline_stage: saved.stageId, licensing_branch: 'licensed' });
  assert.deepEqual(calls[0].expectedValues, { hs_pipeline_stage: recruit.stageId, licensing_branch: '' });
  const alreadyClassified = recruitAt('offer', 'genpop', 'licensed');
  await saveRecruitStage(alreadyClassified, saved.stageId, { requestId, flowChanges: { licensing_branch: 'licensed' }, fetchImpl: async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).changes, { hs_pipeline_stage: saved.stageId });
    assert.deepEqual(JSON.parse(options.body).expectedValues, { hs_pipeline_stage: alreadyClassified.stageId });
    return json({ status: 'saved', requestId, recruit: saved });
  } });
});

test('illegal skips, absent decisions and unsupported flow fields fail before any request', async () => {
  let calls = 0;
  const options = { requestId, fetchImpl: async () => { calls++; assert.fail('Invalid stage action reached the server.'); } };
  const training = recruitAt('training');
  for (const [before, target, flowChanges] of [
    [training, training.stageId], [training, 'foreign'], [recruitAt('application'), stageIdForKey('contracting')],
    [recruitAt('phone-interview', 'mass_recruiting'), stageIdForKey('offer')],
    [recruitAt('phone-interview', ''), stageIdForKey('offer')], [recruitAt('offer'), stageIdForKey('contracting')],
    [recruitAt('offer'), stageIdForKey('licensing-reminders'), { licensing_branch: 'licensed' }],
    [recruitAt('contracting', ''), stageIdForKey('offer')],
    [training, stageIdForKey('completed'), { recruiting_path: 'mass_recruiting' }],
    [training, stageIdForKey('completed'), { licensing_branch: '' }],
    [training, stageIdForKey('completed'), { licensing_branch: 'constructor' }],
    [training, stageIdForKey('completed'), { licensing_branch: true }],
    [training, stageIdForKey('completed'), null],
  ]) await assert.rejects(saveRecruitStage(before, target, { ...options, flowChanges }), { code: 'INVALID_STAGE_CHANGE' });
  assert.equal(calls, 0);
});

test('a chosen legacy Contracting predecessor and terminal Back save without classifying the source', async () => {
  for (const [before, key, route, flowChanges] of [
    [recruitAt('contracting', ''), 'licensed-npn', 'not_licensed', { licensing_branch: 'not_licensed' }],
    [recruitAt('withdrawn', ''), 'training', '', undefined],
  ]) {
    const saved = savedAt(before, key, route); let calls = 0;
    await saveRecruitStage(before, saved.stageId, { requestId, flowChanges, fetchImpl: async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(Object.hasOwn(body.changes, 'recruiting_path'), false);
      assert.equal(body.changes.hs_pipeline_stage, saved.stageId);
      if (flowChanges) {
        assert.equal(body.changes.licensing_branch, 'not_licensed');
        assert.equal(body.expectedValues.licensing_branch, '');
      }
      return json({ status: 'saved', requestId, recruit: saved });
    } });
    assert.equal(calls, 1);
  }
});

test('inconsistent identity, stage, metadata or versions disable controls and prevent submission', async () => {
  const recruit = recruitAt('training'), target = stageIdForKey('completed'); let count = 0;
  const options = { requestId, fetchImpl: async () => { count++; assert.fail('Invalid snapshot reached the server.'); } };
  for (const broken of [
    { ...recruit, stageId: 'unknown' }, { ...recruit, stageKey: 'completed' }, { ...recruit, id: '../123' },
    { ...recruit, updatedAt: null }, { ...recruit, updatedAt: 'invalid' }, { ...recruit, editValues: {} },
    { ...recruit, recruitingPath: undefined }, { ...recruit, licenseRoute: undefined },
    { ...recruit, editValues: { ...recruit.editValues, recruiting_path: 'mass_recruiting' } },
    { ...recruit, editValues: { ...recruit.editValues, licensing_branch: 'licensed' } },
  ]) {
    assert.equal(stageSnapshotAvailable(broken), false);
    assert.deepEqual(stageTransitionChoices(broken, 'forward'), []);
    await assert.rejects(saveRecruitStage(broken, target, options), { code: 'INVALID_STAGE_CHANGE' });
  }
  await assert.rejects(saveRecruitStage(recruit, target, { ...options, requestId: 'not-a-uuid' }), { code: 'INVALID_STAGE_CHANGE' });
  assert.equal(stageSnapshotAvailable(recruit), true); assert.equal(count, 0);
});

test('conflict, unauthorized, disabled and rate-limited responses remain distinct without automatic retries', async () => {
  const recruit = recruitAt('training'), target = stageIdForKey('completed');
  for (const [status, body, code] of [
    [401, {}, 'UNAUTHORIZED'], [409, { error: { code: 'RECORD_CHANGED' } }, 'RECORD_CHANGED'],
    [403, {}, 'SAVE_UNAVAILABLE'], [429, { retryAfterSeconds: 30 }, 'RATE_LIMITED'],
  ]) {
    let calls = 0;
    await assert.rejects(saveRecruitStage(recruit, target, { requestId, fetchImpl: async () => { calls++; return json(body, status); } }), error => {
      assert.ok(error instanceof StageSaveError); assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.uncertain, false);
      if (status === 429) assert.equal(error.retryAfterSeconds, 30);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('network or unconfirmed stage, source or branch results stay uncertain and never retry', async () => {
  const recruit = recruitAt('offer'), saved = savedAt(recruit, 'contracting', 'licensed');
  for (const respond of [
    () => { throw new Error('Synthetic transport failure'); }, () => json({ error: { code: 'SAVE_UNCERTAIN' } }, 502),
    () => new Response('<html>unconfirmed</html>'),
    () => json({ status: 'saved', requestId: 'different-request', recruit: saved }),
    () => json({ status: 'saved', requestId, recruit }),
    () => json({ status: 'saved', requestId, recruit: { ...saved, updatedAt: null } }),
    () => json({ status: 'saved', requestId, recruit: { ...saved, stageKey: 'training' } }),
    () => json({ status: 'saved', requestId, recruit: savedAt(recruitAt('offer', 'mass_recruiting'), 'contracting', 'licensed') }),
    () => json({ status: 'saved', requestId, recruit: savedAt(recruit, 'contracting', 'not_licensed') }),
  ]) {
    let calls = 0;
    await assert.rejects(saveRecruitStage(recruit, saved.stageId, { requestId, flowChanges: { licensing_branch: 'licensed' }, fetchImpl: async () => { calls++; return respond(); } }), error => error.code === 'SAVE_UNCERTAIN' && error.uncertain === true);
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(saveRecruitStage(recruit, saved.stageId, { requestId, signal: controller.signal, flowChanges: { licensing_branch: 'licensed' }, fetchImpl: async () => { calls++; return json({}); } }), { code: 'SAVE_CANCELLED' });
  assert.equal(calls, 0);
});
