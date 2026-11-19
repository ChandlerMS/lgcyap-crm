import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_PAGES, PIPELINE_ID, stageIdForKey } from '../lib/recruiting-config.mjs';
import { CUSTOM_RECRUIT_PIPELINES as P, SYNC_FIELDS, CustomRecruitMappingError, ticketCanonical, recruitCanonical, ticketPatch, recruitPatch, createRecruitProperties, APPROVED_RECRUIT_PROPERTIES } from '../lib/custom-recruit-model.mjs';
const ticket = (stage = 'application', path = 'genpop', branch = '') => ({ hs_pipeline: PIPELINE_ID, hs_pipeline_stage: stageIdForKey(stage), recruiting_path: path, licensing_branch: branch });
test('every ticket stage and route round-trips with each license branch', () => {
  for (const stage of STAGE_PAGES) for (const path of ['genpop', 'mass_recruiting']) for (const branch of ['', 'licensed', 'not_licensed']) {
    const source = ticket(stage.id, path, branch);
    if (branch === 'licensed' && ['licensing-reminders', 'licensed-npn'].includes(stage.id)) {
      assert.throws(() => ticketCanonical(source), CustomRecruitMappingError);
      continue;
    }
    const custom = createRecruitProperties(source, '123');
    assert.deepEqual(recruitCanonical(custom), ticketCanonical(source));
    assert.equal(custom.crm_ticket_id, '123');
  }
});
test('custom terminal reasons preserve semantics and specific existing reason', () => {
  for (const reason of ['withdrawn', 'not_selected', 'offer_declined', 'unresponsive', 'other']) {
    const custom = { hs_pipeline: P.onboarding.id, hs_pipeline_stage: P.onboarding.stages['closed-not-completed'], recruiting_path: 'referrals', closed_reason: reason };
    assert.equal(recruitCanonical(custom).hs_pipeline_stage, stageIdForKey(reason === 'not_selected' ? 'rejected' : 'withdrawn'));
    assert.deepEqual(recruitPatch({ recruiting_path: 'mass_recruiting' }, custom), { recruiting_path: 'recruiters' });
  }
});
test('Licensed is an explicit route selection; intake statements never invent verification', () => {
  const custom = { hs_pipeline: P.onboarding.id, hs_pipeline_stage: P.onboarding.stages.licensed, recruiting_path: 'recruiters' };
  assert.equal(recruitCanonical(custom).licensing_branch, 'licensed');
  assert.equal(recruitCanonical(custom).hs_pipeline_stage, stageIdForKey('offer'));
  assert.throws(() => recruitCanonical({ ...custom, licensing_branch: 'needs_licensing' }), CustomRecruitMappingError);
  const created = createRecruitProperties({ ...ticket('offer'), intake_license_status: 'already_licensed' }, '1');
  assert.equal(created.hs_pipeline_stage, P.onboarding.stages.offer);
  assert.ok(!Object.hasOwn(created, 'licensed_at_offer'));
  assert.ok(!Object.hasOwn(created, 'license_verified'));
});
test('unknown stages, pipelines, paths, routes and closed reasons fail safely', () => {
  for (const source of [{ ...ticket(), hs_pipeline: 'secret-name' }, { ...ticket(), hs_pipeline_stage: 'unknown' }, { ...ticket(), recruiting_path: 'secret-name' }, { ...ticket(), licensing_branch: 'secret-name' }]) {
    assert.throws(() => ticketCanonical(source), e => e instanceof CustomRecruitMappingError && !e.message.includes('secret-name'));
  }
  const valid = createRecruitProperties(ticket(), '1');
  for (const source of [{ ...valid, hs_pipeline: 'unknown' }, { ...valid, hs_pipeline_stage: P.onboarding.stages.offer }, { ...valid, recruiting_path: 'recruiters' }, { ...valid, licensing_branch: 'unknown' }, { hs_pipeline: P.onboarding.id, hs_pipeline_stage: P.onboarding.stages.offer }, { hs_pipeline: P.onboarding.id, hs_pipeline_stage: P.onboarding.stages['closed-not-completed'], recruiting_path: 'referrals', closed_reason: '' }]) assert.throws(() => recruitCanonical(source), CustomRecruitMappingError);
});
test('intake pipelines derive missing paths and office alias only fills blanks', () => {
  const custom = { hs_pipeline: P.referrals.id, hs_pipeline_stage: P.referrals.stages.application, lgcy_office: 'Miami' };
  assert.equal(recruitCanonical(custom).recruiting_path, 'genpop');
  assert.equal(recruitCanonical(custom).orientation_office, 'miami');
  assert.equal(recruitCanonical({ ...custom, orientation_office: 'tampa' }).orientation_office, 'tampa');
});
test('patches normalize typed fields and preserve unrelated values and alias stages', () => {
  const source = { ...ticket('offer', 'genpop', 'licensed'), orientation_registered: false, orientation_date: null, unrelated: 'keep', licensed_at_offer: 'false' };
  const custom = { ...createRecruitProperties(source, '1'), hs_pipeline_stage: P.onboarding.stages.offer, unrelated: 'keep' };
  assert.deepEqual(recruitPatch({ orientation_checked_in: true, subject: 'Updated ticket' }, custom), { orientation_checked_in: 'true', subject: 'Updated ticket' });
  assert.deepEqual(ticketPatch({ orientation_checked_in: false, hs_pipeline: 'ignored', unrelated: 'bad' }, source), { orientation_checked_in: 'false' });
  assert.equal(ticketCanonical(source).orientation_registered, 'false');
  assert.equal(ticketCanonical(source).orientation_date, '');
  assert.equal(custom.unrelated, 'keep');
  assert.deepEqual(recruitPatch({ licensing_branch: 'licensed' }, custom), {});
  const changed = recruitPatch({ hs_pipeline_stage: stageIdForKey('application'), recruiting_path: 'mass_recruiting' }, custom);
  assert.equal(changed.hs_pipeline, P.recruiters.id);
  assert.equal(changed.hs_pipeline_stage, P.recruiters.stages.application);
  assert.ok(SYNC_FIELDS.every(key => typeof ticketCanonical(source)[key] === 'string'));
});
test('approved schema declares exact property types and safe unique linkage', () => {
  assert.equal(APPROVED_RECRUIT_PROPERTIES.length, 15);
  assert.equal(APPROVED_RECRUIT_PROPERTIES.find(p => p.name === 'crm_ticket_id').hasUniqueValue, true);
  for (const p of APPROVED_RECRUIT_PROPERTIES.filter(p => p.type === 'bool')) assert.deepEqual(p.options.map(o => o.value), ['true', 'false']);
  assert.deepEqual(APPROVED_RECRUIT_PROPERTIES.find(p => p.name === 'orientation_office').options.map(o => o.value), ['orlando', 'miami', 'tampa']);
});

test('shared field values reject invalid types, enums and unsafe names', () => {
  const cases = {
    orientation_office: ['Orlando', 'unknown'], intake_license_status: ['licensed'], recruit_type: ['other'],
    orientation_registered: ['yes', '1'], orientation_checked_in: ['TRUE'], licensing_started: ['no'],
    contracting_registered: ['0'], appointments_created: ['yes'], hubspot_owner_id: ['0', '-1', '123456789012345678901', 'abc'],
    subject: ['a'.repeat(181), 'bad\nname'],
    recruit_name: ['a'.repeat(181), 'private\nname', 'private\u007fname'],
    orientation_date: ['2026-02-30', '2026-13-01', '2026-1-01', '2026-11-19T12:00:00Z', '1', 'Infinity'],
  };
  for (const [key, invalidValues] of Object.entries(cases)) for (const value of invalidValues) {
    const source = { ...ticket(), [key]: value };
    assert.throws(() => ticketCanonical(source), CustomRecruitMappingError, key);
    assert.throws(() => createRecruitProperties(source, '1'), CustomRecruitMappingError, key);
    assert.throws(() => ticketPatch({ [key]: value }, ticket()), CustomRecruitMappingError, key);
    assert.throws(() => recruitPatch({ [key]: value }, createRecruitProperties(ticket(), '1')), CustomRecruitMappingError, key);
    assert.throws(() => recruitCanonical({ ...createRecruitProperties(ticket(), '1'), [key]: value }), CustomRecruitMappingError, key);
  }
});
test('HubSpot midnight millis and calendar dates have stable canonical dates and patches', () => {
  for (const day of ['2026-11-19', '2024-02-29', '1970-01-01', '1969-12-31']) {
    const milliseconds = String(Date.parse(`${day}T00:00:00Z`));
    const source = { ...ticket(), orientation_date: milliseconds, hubspot_owner_id: '12345678901234567890', recruit_name: 'Valid name' };
    const custom = createRecruitProperties(source, '1');
    assert.equal(custom.orientation_date, day);
    assert.deepEqual(recruitCanonical(custom), ticketCanonical(source));
    assert.equal(recruitCanonical({ ...custom, orientation_date: milliseconds }).orientation_date, day);
    assert.deepEqual(ticketPatch({ orientation_date: milliseconds }, ticket()), { orientation_date: day });
    assert.deepEqual(recruitPatch({ orientation_date: milliseconds }, createRecruitProperties(ticket(), '1')), { orientation_date: day });
  }
});
