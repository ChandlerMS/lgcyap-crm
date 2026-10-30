import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoRecruits, applyDemoStage, applyDemoDetails, isDemoRecruit, validateDemoDetails } from '../app/recruit-demo.mjs';
import { STAGE_PAGES, stageIdForKey } from '../lib/recruiting-config.mjs';
import { EDIT_FIELDS } from '../lib/recruit-edit-config.mjs';
import { stageSnapshotAvailable } from '../app/recruit-stage-save.mjs';
import { communicationAction } from '../app/recruit-communication-links.mjs';

const NOW = Date.parse('2026-10-30T16:30:00.000Z');
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

test('demo factory creates exactly six isolated fictional recruits in every canonical stage', () => {
  const records = createDemoRecruits(NOW);
  assert.equal(records.length, 60);
  for (const field of ['id', 'phone', 'email', 'firstName']) assert.equal(new Set(records.map(record => record[field])).size, 60, field);
  assert.equal(records[0].id, '900000000000001'); assert.equal(records.at(-1).id, '900000000000060');
  for (const stage of STAGE_PAGES) assert.equal(records.filter(record => record.stageId === stage.stageId).length, 6);
  for (const record of records) {
    assert.equal(record.lastName, 'Test'); assert.equal(record.name, `${record.firstName} Test`);
    assert.equal(record.hubspotUrl, ''); assert.equal(isDemoRecruit(record), true); assert.equal(stageSnapshotAvailable(record), true);
    assert.match(record.phone, /^\+120255501\d\d$/); assert.match(record.email, /@example\.invalid$/);
    assert.deepEqual(Object.keys(record.editValues), EDIT_FIELDS.map(field => field.property));
    assert.equal(Object.keys(record.editValues).length, 14);
  }
  assert.equal(records.filter(record => record.lastContactedAt).length, 30);
  assert.deepEqual(createDemoRecruits(NOW), records);
});

test('all created dates stay in the agency day across UTC, midnight, and daylight saving boundaries', () => {
  for (const instant of ['2026-10-30T03:59:59.999Z', '2026-10-30T04:00:00.000Z', '2026-10-30T04:00:00.001Z', '2026-11-01T05:59:59.999Z', '2026-11-01T06:00:00.000Z', '2026-03-08T06:59:59.999Z', '2026-03-08T07:00:00.000Z']) {
    const now = Date.parse(instant);
    for (const record of createDemoRecruits(now)) {
      assert.equal(DAY.format(new Date(record.createdAt)), DAY.format(new Date(now)), instant);
      assert.ok(Date.parse(record.createdAt) <= Date.parse(record.enteredStageAt));
      assert.ok(Date.parse(record.enteredStageAt) <= now);
      if (record.lastContactedAt) assert.ok(Date.parse(record.enteredStageAt) <= Date.parse(record.lastContactedAt) && Date.parse(record.lastContactedAt) <= now);
      assert.equal(record.updatedAt, new Date(now).toISOString());
    }
  }
});

test('demo stage changes use the real graph and preserve the input snapshot', () => {
  const source = createDemoRecruits(NOW).find(record => record.stageKey === 'application' && record.recruitingPath === 'genpop');
  const before = structuredClone(source);
  const changed = applyDemoStage(source, stageIdForKey('phone-interview'), {}, NOW + 1000);
  assert.equal(changed.stageKey, 'phone-interview'); assert.equal(changed.stage, 'Phone Interview');
  assert.equal(changed.editValues.hs_pipeline_stage, stageIdForKey('phone-interview'));
  assert.equal(changed.enteredStageAt, new Date(NOW + 1000).toISOString());
  assert.equal(stageSnapshotAvailable(changed), true); assert.notEqual(changed.editValues, source.editValues);
  assert.deepEqual(source, before);
  assert.throws(() => applyDemoStage(source, stageIdForKey('completed'), {}, NOW + 1000), /connected/);
  assert.throws(() => applyDemoStage({ ...source, isDemo: false }, stageIdForKey('phone-interview'), {}, NOW + 1000), /isolated/);
  assert.throws(() => applyDemoStage({ ...source, id: '123' }, stageIdForKey('phone-interview'), {}, NOW + 1000), /isolated/);
  assert.throws(() => applyDemoStage(source, stageIdForKey('phone-interview'), { recruiting_path: 'mass_recruiting' }, NOW + 1000), /different connected/);
});

test('demo Offer requires an explicit licensing branch and terminal moves stay connected', () => {
  const records = createDemoRecruits(NOW), offer = records.find(record => record.stageKey === 'offer');
  assert.throws(() => applyDemoStage(offer, stageIdForKey('contracting'), {}, NOW + 1000), /license route/);
  const changed = applyDemoStage(offer, stageIdForKey('contracting'), { licensing_branch: 'licensed' }, NOW + 1000);
  assert.equal(changed.licenseRoute, 'licensed'); assert.equal(changed.editValues.licensing_branch, 'licensed');
  const completed = records.find(record => record.stageKey === 'completed');
  assert.equal(applyDemoStage(completed, stageIdForKey('training'), {}, NOW + 1000).stageKey, 'training');
  assert.throws(() => applyDemoStage(completed, stageIdForKey('offer'), {}, NOW + 1000), /connected/);
});

test('local demo edits validate contact fields and keep communication tools disconnected', () => {
  const source = createDemoRecruits(NOW)[0], before = structuredClone(source);
  const fields = { firstName: 'Demo', lastName: 'Test', phone: '(202) 555-0199', email: 'demo.test@example.invalid', recruiter: 'Demo Trainer' };
  const changed = applyDemoDetails(source, fields, NOW + 1000);
  assert.equal(changed.name, 'Demo Test'); assert.equal(changed.phone, '+12025550199'); assert.equal(changed.editValues.recruit_name, changed.name);
  assert.equal(changed.hubspotUrl, ''); assert.equal(changed.isDemo, true); assert.deepEqual(source, before);
  assert.throws(() => validateDemoDetails({ ...fields, firstName: '', email: 'invalid' }), error => Boolean(error.fieldErrors.firstName && error.fieldErrors.email));
  assert.throws(() => validateDemoDetails({ ...fields, phone: 'call me' }), error => Boolean(error.fieldErrors.phone));
  assert.throws(() => applyDemoDetails(source, fields, NOW - 1), /clock cannot move backward/);
});

test('demo code contains no network or persistence operations', () => {
  for (const file of ['app/recruit-demo.mjs', 'app/demo-recruit-editor.tsx']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\/api\//);
  }
});

test('demo contact actions stay inactive even if a valid HubSpot URL is supplied', () => {
  const recruit = createDemoRecruits(NOW)[0];
  const validUrl = `https://app.hubspot.com/contacts/50894788/record/0-5/${recruit.id}`;
  assert.equal(communicationAction(recruit.id, validUrl, 'call', false).href, validUrl);
  for (const action of ['call', 'text', 'email']) {
    const result = communicationAction(recruit.id, validUrl, action, recruit.isDemo);
    assert.equal(result.href, null);
    assert.match(result.reason, /Demo contact tools are inactive/);
  }
});
