import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_PAGES, STAGES, TERMINAL_STAGE_IDS } from '../lib/recruiting-config.mjs';
import {
  WORKSPACE_NAV, resolveWorkspaceRoute, stagePageForRecord,
  recordsForStagePage, unmappedStageRecords,
} from '../app/recruiting-navigation.mjs';

test('navigation follows the eight recruiting stages in the requested order', () => {
  assert.deepEqual(WORKSPACE_NAV.map(page => page.label), [
    'Today', 'Add Recruits', 'Recruits', 'Phone Interview', 'Orientation', 'Licensing',
    'Contracting', 'Transfers', 'Training', 'Completed',
  ]);
  assert.equal(new Set(STAGE_PAGES.map(page => page.id)).size, 8);
  assert.equal(new Set(STAGE_PAGES.map(page => page.stageId)).size, 8);
  for (const page of STAGE_PAGES) assert.equal(STAGES[page.stageId], page.label);
  assert.deepEqual(TERMINAL_STAGE_IDS, [STAGE_PAGES.find(page => page.id === 'completed').stageId]);
});

test('each stage page includes only its exact HubSpot stage ID', () => {
  const records = STAGE_PAGES.map((page, index) => ({ id: String(index), stageId: page.stageId, stage: page.label }));
  const unknown = { id: 'unknown', stageId: 'not-a-current-stage', stage: 'Recruits' };
  const all = [...records, unknown];
  for (let index = 0; index < STAGE_PAGES.length; index++) {
    const page = STAGE_PAGES[index];
    assert.deepEqual(recordsForStagePage(all, page.id), [records[index]]);
    assert.equal(stagePageForRecord(records[index]), page);
  }
  assert.deepEqual(recordsForStagePage(all, 'today'), []);
  assert.deepEqual(recordsForStagePage(all, 'add-recruit'), []);
  assert.deepEqual(unmappedStageRecords(all), [unknown]);
  assert.equal(stagePageForRecord(unknown), undefined);
});

test('stage routes and shared record links remain addressable after removing old pages', () => {
  for (const page of WORKSPACE_NAV) assert.deepEqual(resolveWorkspaceRoute(`#${page.id}`), { view: page.id });
  assert.deepEqual(resolveWorkspaceRoute('#follow-up'), { view: 'today' });
  assert.deepEqual(resolveWorkspaceRoute('#add-recruit'), { view: 'add-recruits' });
  assert.deepEqual(resolveWorkspaceRoute('#recruit/123'), { view: 'recruits', id: '123' });
  assert.deepEqual(resolveWorkspaceRoute('#unsupported'), { view: 'today' });
});
