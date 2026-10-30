import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_PAGES } from '../lib/recruiting-config.mjs';
import { adjacentStageId, saveRecruitStage, stageSnapshotAvailable, StageSaveError } from '../app/recruit-stage-save.mjs';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const recruit = { id: '123', name: 'Synthetic Recruit', stageId: STAGE_PAGES[2].stageId, updatedAt: '2026-10-29T12:00:00.000Z', editValues: { hs_pipeline_stage: STAGE_PAGES[2].stageId } };
const target = STAGE_PAGES[3].stageId;
const saved = { ...recruit, stageId: target, updatedAt: '2026-10-29T12:01:00.000Z', editValues: { hs_pipeline_stage: target } };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('up/back and down/forward follow the requested stage order and stop at boundaries', () => {
  for (let index = 0; index < STAGE_PAGES.length; index++) {
    assert.equal(adjacentStageId(STAGE_PAGES[index].stageId, 'back'), STAGE_PAGES[index - 1]?.stageId ?? null);
    assert.equal(adjacentStageId(STAGE_PAGES[index].stageId, 'forward'), STAGE_PAGES[index + 1]?.stageId ?? null);
  }
  assert.equal(adjacentStageId('unknown', 'forward'), null);
  assert.equal(adjacentStageId(STAGE_PAGES[0].stageId, 'other'), null);
});

test('stage save sends exactly one sparse reviewed POST and accepts only confirmed saved state', async () => {
  const calls = [];
  const controller = new AbortController();
  const result = await saveRecruitStage(recruit, target, { requestId, signal: controller.signal, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json({ status: 'saved', requestId, recruit: saved, replayed: true });
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

test('invalid, unchanged, unversioned or inconsistent stage requests never make a provider-facing request', async () => {
  let count = 0;
  const options = { requestId, fetchImpl: async () => { count++; throw new Error('Must not run'); } };
  for (const [snapshot, stageId] of [
    [recruit, recruit.stageId], [recruit, 'foreign'], [{ ...recruit, stageId: 'unknown' }, target],
    [{ ...recruit, id: '../123' }, target], [{ ...recruit, updatedAt: null }, target],
    [{ ...recruit, updatedAt: 'invalid' }, target], [{ ...recruit, editValues: {} }, target],
  ]) await assert.rejects(saveRecruitStage(snapshot, stageId, options), { code: 'INVALID_STAGE_CHANGE' });
  await assert.rejects(saveRecruitStage(recruit, target, { ...options, requestId: 'not-a-uuid' }), { code: 'INVALID_STAGE_CHANGE' });
  assert.equal(count, 0);
  assert.equal(stageSnapshotAvailable(recruit), true);
  assert.equal(stageSnapshotAvailable({ ...recruit, editValues: { hs_pipeline_stage: target } }), false);
});

test('conflict, unauthorized, disabled and rate-limited responses remain distinct without automatic retries', async () => {
  for (const [status, body, code] of [
    [401, {}, 'UNAUTHORIZED'], [409, { error: { code: 'RECORD_CHANGED' } }, 'RECORD_CHANGED'],
    [403, {}, 'SAVE_UNAVAILABLE'], [429, { retryAfterSeconds: 30 }, 'RATE_LIMITED'],
  ]) {
    let calls = 0;
    await assert.rejects(saveRecruitStage(recruit, target, { requestId, fetchImpl: async () => { calls++; return json(body, status); } }), error => {
      assert.ok(error instanceof StageSaveError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.uncertain, false);
      if (status === 429) assert.equal(error.retryAfterSeconds, 30);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('network failures, server uncertainty and unconfirmed success never retry or report a saved stage', async () => {
  for (const respond of [
    () => { throw new Error('Synthetic transport failure'); },
    () => json({ error: { code: 'SAVE_UNCERTAIN' } }, 502),
    () => new Response('<html>unconfirmed</html>'),
    () => json({ status: 'saved', requestId: 'different-request', recruit: saved }),
    () => json({ status: 'saved', requestId, recruit }),
    () => json({ status: 'saved', requestId, recruit: { ...saved, updatedAt: null } }),
  ]) {
    let calls = 0;
    await assert.rejects(saveRecruitStage(recruit, target, { requestId, fetchImpl: async () => { calls++; return respond(); } }), error => error.code === 'SAVE_UNCERTAIN' && error.uncertain === true);
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(saveRecruitStage(recruit, target, { requestId, signal: controller.signal, fetchImpl: async () => { calls++; return json({}); } }), { code: 'SAVE_CANCELLED' });
  assert.equal(calls, 0);
});
