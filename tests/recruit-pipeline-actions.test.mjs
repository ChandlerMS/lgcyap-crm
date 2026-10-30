import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselDragSteps, carouselIndex, carouselSectionDelta, pipelineAge, pipelineDropChoice } from '../app/recruit-pipeline-actions.mjs';
import { stageIdForKey } from '../lib/recruiting-config.mjs';

function recruit(stageKey, path = 'genpop', route = '') {
  return { id: '123', stageKey, stageId: stageIdForKey(stageKey), recruitingPath: path, licenseRoute: route,
    updatedAt: '2026-10-30T12:00:00.000Z', editValues: { hs_pipeline_stage: stageIdForKey(stageKey), recruiting_path: path, licensing_branch: route } };
}
test('record drops obey source order and cannot reassign a path or skip stages', () => {
  const record = recruit('phone-interview');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('offer') })?.stageKey, 'offer');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('hiring-event') }), null);
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('application'), recruitingPath: 'mass_recruiting' }), null);
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('completed') }), null);
  assert.equal(pipelineDropChoice({ ...record, updatedAt: null }, { stageId: stageIdForKey('offer') }), null);
});
test('license branch drops require a named branch and carry exactly its edge metadata', () => {
  const record = recruit('offer');
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('contracting') }), null);
  assert.deepEqual(pipelineDropChoice(record, { stageId: stageIdForKey('contracting'), licenseRoute: 'licensed' })?.flowChanges, { licensing_branch: 'licensed' });
  assert.deepEqual(pipelineDropChoice(record, { stageId: stageIdForKey('licensing-reminders'), licenseRoute: 'not_licensed' })?.flowChanges, { licensing_branch: 'not_licensed' });
  assert.equal(pipelineDropChoice(record, { stageId: stageIdForKey('contracting'), licenseRoute: 'not_licensed' }), null);
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
test('3D carousel wraps sections without reversing a full revolution', () => {
  assert.equal(carouselIndex(-1), 4);
  assert.equal(carouselIndex(5), 0);
  assert.equal(carouselSectionDelta(4, 0), 1);
  assert.equal(carouselSectionDelta(0, 4), -1);
  assert.equal(carouselSectionDelta(0, 3), -2);
});
test('3D carousel requires a deliberate drag and snaps to a bounded number of panels', () => {
  assert.equal(carouselDragSteps(25), 0);
  assert.equal(carouselDragSteps(-160), 1);
  assert.equal(carouselDragSteps(160), -1);
  assert.equal(carouselDragSteps(-3000), 2);
  assert.equal(carouselDragSteps(Infinity), 0);
});
