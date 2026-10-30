import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_PAGES, STAGES, TERMINAL_STAGE_IDS } from '../lib/recruiting-config.mjs';
import {
  WORKSPACE_NAV, WORKSPACE_NAV_GROUPS, HUBSPOT_TOOLS, resolveWorkspaceRoute, stagePageForRecord,
  recordsForStagePage, unmappedStageRecords,
} from '../app/recruiting-navigation.mjs';

test('canonical stages are shared while each entry path has its own sidebar order', () => {
  assert.deepEqual(WORKSPACE_NAV.slice(0, 2).map(page => page.label), ['Today', 'Add Recruits']);
  assert.deepEqual(WORKSPACE_NAV_GROUPS.find(group => group.id === 'genpop').items.map(page => page.label), ['Hiring Event', 'Application', 'Phone Interview']);
  assert.deepEqual(WORKSPACE_NAV_GROUPS.find(group => group.id === 'mass-recruiting').items.map(page => page.label), ['Application', 'Phone Interview', 'Hiring Event']);
  assert.equal(new Set(STAGE_PAGES.map(page => page.id)).size, 10);
  assert.equal(new Set(STAGE_PAGES.map(page => page.stageId)).size, 10);
  assert.equal(new Set(WORKSPACE_NAV.map(page => page.id)).size, WORKSPACE_NAV.length);
  for (const page of STAGE_PAGES) assert.equal(STAGES[page.stageId], page.label);
  assert.deepEqual(TERMINAL_STAGE_IDS, ['1416243218', '1473318773']);
  assert.equal(STAGE_PAGES.find(page => page.id === 'completed').stageId, '1416243218');
});

test('native HubSpot tools use the verified portal and exact requested order', () => {
  assert.deepEqual(HUBSPOT_TOOLS.map(tool => tool.label), ['Customer Success', 'Inbox', 'Tickets', 'Calls', 'Contacts', 'Tasks', 'Calendar', 'Meetings']);
  for (const tool of HUBSPOT_TOOLS) {
    assert.deepEqual(resolveWorkspaceRoute(`#${tool.id}`), { view: tool.id });
    assert.equal(new URL(tool.href).origin, 'https://app.hubspot.com');
    assert.match(new URL(tool.href).pathname, /(?:^|\/)50894788(?:\/|$)/);
  }
});

test('each stage page includes only its exact HubSpot stage ID', () => {
  const records = STAGE_PAGES.map((page, index) => ({ id: String(index), stageId: page.stageId, stage: page.label }));
  const unknown = { id: 'unknown', stageId: 'not-a-current-stage', stage: 'Recruits' };
  const all = [...records, unknown];
  for (let index = 0; index < STAGE_PAGES.length; index++) {
    const page = STAGE_PAGES[index];
    assert.deepEqual(recordsForStagePage(all, page.id), [records[index]]);
    assert.equal(stagePageForRecord(records[index]).stageId, page.stageId);
  }
  assert.deepEqual(recordsForStagePage(all, 'today'), []);
  assert.deepEqual(recordsForStagePage(all, 'add-recruit'), []);
  assert.deepEqual(unmappedStageRecords(all), [unknown]);
  assert.equal(stagePageForRecord(unknown), undefined);
});

test('shared early stages keep GenPop and Mass records in their selected path queues', () => {
  const stageId = STAGE_PAGES.find(page => page.id === 'phone-interview').stageId;
  const genpop = { id: 'g', stageId, recruitingPath: 'genpop' };
  const mass = { id: 'm', stageId, recruitingPath: 'mass_recruiting' };
  const legacy = { id: 'l', stageId, recruitingPath: '' };
  assert.deepEqual(recordsForStagePage([genpop, mass, legacy], 'genpop-phone-interview'), [genpop]);
  assert.deepEqual(recordsForStagePage([genpop, mass, legacy], 'mass-phone-interview'), [mass]);
  assert.deepEqual(recordsForStagePage([genpop, mass, legacy], 'phone-interview'), [genpop, mass, legacy]);
  assert.equal(stagePageForRecord(genpop).id, 'genpop-phone-interview');
  assert.equal(stagePageForRecord(mass).id, 'mass-phone-interview');
  assert.equal(stagePageForRecord(legacy).id, 'phone-interview');
});

test('Contracting branch queues use the explicit route and never infer a missing route', () => {
  const stageId = STAGE_PAGES.find(page => page.id === 'contracting').stageId;
  const licensed = { id: 'a', stageId, licenseRoute: 'licensed' };
  const notLicensed = { id: 'b', stageId, licenseRoute: 'not_licensed' };
  const legacy = { id: 'c', stageId, licenseRoute: '' };
  const records = [licensed, notLicensed, legacy];
  assert.deepEqual(recordsForStagePage(records, 'licensed-contracting'), [licensed]);
  assert.deepEqual(recordsForStagePage(records, 'unlicensed-contracting'), [notLicensed]);
  assert.deepEqual(recordsForStagePage(records, 'contracting'), records);
});

test('stage routes and shared record links remain addressable after removing old pages', () => {
  for (const page of WORKSPACE_NAV) assert.deepEqual(resolveWorkspaceRoute(`#${page.id}`), { view: page.id });
  assert.deepEqual(resolveWorkspaceRoute('#follow-up'), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#add-recruit'), { view: 'add-recruits' });
  assert.deepEqual(resolveWorkspaceRoute('#recruit/123'), { view: 'today', id: '123' });
  for (const retired of ['recruits', 'orientation', 'licensing', 'transfers']) assert.deepEqual(resolveWorkspaceRoute(`#${retired}`), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#unsupported'), { view: 'today' });
});
