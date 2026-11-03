import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelineAge, pipelineDropChoice, sortPipelineRecruits } from '../app/recruit-pipeline-actions.mjs';
import { stageIdForKey } from '../lib/recruiting-config.mjs';

function recruit(stageKey, path = 'genpop', route = '') {
  return { id: '123', stageKey, stageId: stageIdForKey(stageKey), recruitingPath: path, licenseRoute: route,
    updatedAt: '2026-10-30T12:00:00.000Z', editValues: { hs_pipeline_stage: stageIdForKey(stageKey), recruiting_path: path, licensing_branch: route } };
}

test('every compatible stage pair supports direct drops in both source paths and licensing branches', () => {
  const stages = ['hiring-event', 'application', 'phone-interview', 'offer', 'licensing-reminders', 'licensed-npn', 'contracting', 'training', 'completed'];
  const early = new Set(['hiring-event', 'application', 'phone-interview']);
  const branchStages = new Set(['licensing-reminders', 'licensed-npn', 'contracting']);
  let checked = 0;
  for (const path of ['genpop', 'mass_recruiting']) for (const route of ['licensed', 'not_licensed']) {
    const compatible = stages.filter(key => route !== 'licensed' || !['licensing-reminders', 'licensed-npn'].includes(key));
    for (const from of compatible) for (const to of compatible) {
      if (from === to) continue;
      const before = recruit(from, path, route);
      const target = { stageId: stageIdForKey(to), ...(early.has(to) ? { recruitingPath: path } : {}), ...(branchStages.has(to) ? { licenseRoute: route } : {}) };
      const choice = pipelineDropChoice(before, target);
      assert.equal(choice?.stageKey, to, `${path}/${route}: ${from} → ${to}`);
      assert.equal(choice.flowChanges, undefined, 'A direct move must preserve its recorded branch.');
      checked++;
    }
  }
  assert.equal(checked, 228);
});
test('record drops allow direct forward and backward moves without reassigning a path', () => {
  const record = recruit('phone-interview');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('offer') })?.stageKey, 'offer');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('hiring-event') })?.stageKey, 'hiring-event');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('application'), recruitingPath: 'mass_recruiting' }), null);
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('completed') })?.stageKey, 'completed');
  assert.equal(pipelineDropChoice(recruit('completed'), { stageId: stageIdForKey('application'), recruitingPath: 'genpop' })?.stageKey, 'application');
  assert.equal(pipelineDropChoice({ ...record, updatedAt: null }, { stageId: stageIdForKey('offer') }), null);
});
test('license branch drops require a named branch and carry exactly its edge metadata', () => {
  const record = recruit('offer');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('contracting') }), null);
  assert.deepEqual(pipelineDropChoice(record, { stageId: stageIdForKey('contracting'), licenseRoute: 'licensed' })?.flowChanges, { licensing_branch: 'licensed' });
  assert.deepEqual(pipelineDropChoice(record, { stageId: stageIdForKey('licensing-reminders'), licenseRoute: 'not_licensed' })?.flowChanges, { licensing_branch: 'not_licensed' });
  assert.deepEqual(pipelineDropChoice(record, { stageId: stageIdForKey('contracting'), licenseRoute: 'not_licensed' })?.flowChanges, { licensing_branch: 'not_licensed' });
  assert.equal(pipelineDropChoice(recruit('offer', 'genpop', 'licensed'), { stageId: stageIdForKey('licensing-reminders'), licenseRoute: 'not_licensed' }), null);
});
test('blank legacy sources stay blank while shared edges remain usable', () => {
  assert.equal(pipelineDropChoice(recruit('phone-interview', ''), { stageId: stageIdForKey('offer') }), null);
  assert.equal(pipelineDropChoice(recruit('completed', ''), { stageId: stageIdForKey('training') })?.stageKey, 'training');
  assert.equal(pipelineDropChoice(recruit('training'), { stageId: stageIdForKey('withdrawn') })?.stageKey, 'withdrawn');
});
test('supplemental unassigned cards reject drops without disabling canonical branch destinations', () => {
  const early = recruit('phone-interview');
  assert.equal(pipelineDropChoice(early, { stageId: stageIdForKey('application'), allowDrop: false }), null);
  const licensed = recruit('training', 'genpop', 'licensed');
  assert.equal(pipelineDropChoice(licensed, { stageId: stageIdForKey('contracting'), allowDrop: false }), null);
  assert.equal(pipelineDropChoice(licensed, { stageId: stageIdForKey('contracting'), licenseRoute: 'licensed' })?.stageKey, 'contracting');
  assert.equal(pipelineDropChoice(recruit('offer'), { stageId: stageIdForKey('licensing-reminders'), licenseRoute: 'not_licensed' })?.stageKey, 'licensing-reminders');
});
test('stage age is truthful for missing and future dates', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(pipelineAge(null, now), 'Not recorded');
  assert.equal(pipelineAge('2026-11-01T12:00:00Z', now), 'Not recorded');
  assert.equal(pipelineAge('2026-10-30T11:40:00Z', now), 'Less than an hour');
  assert.equal(pipelineAge('2026-10-29T12:00:00Z', now), '1 day');
});
test('stage prospect sorting is stable, leaves unknowns last, and never mutates the source', () => {
  const records = [{ id: '1', firstName: 'Alex', recruiter: null }, { id: '2', firstName: 'bella', recruiter: 'Morgan' }, { id: '3', firstName: null, recruiter: 'Alex' }, { id: '4', firstName: 'Alex', recruiter: 'Morgan' }];
  assert.deepEqual(sortPipelineRecruits(records).map(row => row.id), ['1', '4', '2', '3']);
  assert.deepEqual(sortPipelineRecruits(records, 'firstName', 'desc').map(row => row.id), ['2', '1', '4', '3']);
  assert.deepEqual(sortPipelineRecruits(records, 'recruiter', 'asc').map(row => row.id), ['3', '2', '4', '1']);
  assert.deepEqual(records.map(row => row.id), ['1', '2', '3', '4']);
});
test('stage-age and last-contact sorting compare dates rather than formatted labels', () => {
  const records = [{ id: 'old', enteredStageAt: '2026-01-01T00:00:00Z', lastContactedAt: '2026-10-29T00:00:00Z' }, { id: 'new', enteredStageAt: '2026-10-01T00:00:00Z', lastContactedAt: '2026-09-01T00:00:00Z' }, { id: 'missing', enteredStageAt: null, lastContactedAt: null }];
  assert.deepEqual(sortPipelineRecruits(records, 'timeInStage', 'asc').map(row => row.id), ['new', 'old', 'missing']);
  assert.deepEqual(sortPipelineRecruits(records, 'timeInStage', 'desc').map(row => row.id), ['old', 'new', 'missing']);
  assert.deepEqual(sortPipelineRecruits(records, 'lastContactedAt', 'desc').map(row => row.id), ['old', 'new', 'missing']);
});
