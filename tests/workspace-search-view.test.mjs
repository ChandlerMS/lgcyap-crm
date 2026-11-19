import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSearchHref, normalizeSearchGroups, mergeSearchGroups, demoSearchGroups, workspaceSearchStatus } from '../app/workspace-search-view.mjs';

test('search results accept only fixed portal records and supported local record destinations', () => {
  for (const href of ['javascript:alert(1)', '//evil.invalid', 'https://evil.invalid/50894788', 'https://app.hubspot.com/contacts/999/record/0-5/1', '#inbox/thread/../../x']) assert.equal(safeSearchHref(href), null);
  assert.equal(safeSearchHref('#recruit/123'), '#recruit/123');
  assert.equal(safeSearchHref('#inbox/thread/456'), '#inbox/thread/456');
  assert.equal(safeSearchHref('https://app.hubspot.com/contacts/50894788/record/0-5/123'), 'https://app.hubspot.com/contacts/50894788/record/0-5/123');
});

test('search groups reject unknown areas and unsafe links; continuation merges without duplicates', () => {
  const groups = normalizeSearchGroups([{ id: 'inbox', status: 'available', partial: true, records: [{ id: '1', title: 'First', href: '#inbox/thread/1' }, { id: 'x', title: 'Unsafe', href: 'https://evil.invalid' }] }, { id: 'arbitrary', status: 'available', records: [] }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].records.length, 1);
  const merged = mergeSearchGroups(groups, normalizeSearchGroups([{ id: 'inbox', status: 'available', partial: false, records: [{ id: '1', title: 'First', href: '#inbox/thread/1' }, { id: '2', title: 'Next', href: '#inbox/thread/2' }] }]));
  assert.deepEqual(merged[0].records.map(row => row.id), ['1', '2']); assert.equal(merged[0].partial, false);
});

test('demo search uses only supplied fictional recruits and includes all source groups without provider calls', () => {
  const groups = demoSearchGroups([{ id: '9001', name: 'Test Ada', email: 'ada@example.invalid' }, { id: '9002', name: 'Test Lin' }], 'ADA');
  assert.equal(groups.length, 7); assert.equal(groups[0].records[0].title, 'Test Ada');
  assert.ok(groups.slice(1).every(group => group.records.length === 0));
  assert.equal(demoSearchGroups([], 'ada')[0].records.length, 0);
});

test('search status never announces a false zero during debounce or after a failed search', () => {
  assert.equal(workspaceSearchStatus({ pending: true, busy: false, error: '', demo: false, groups: [] }), 'Searching HubSpot…');
  assert.equal(workspaceSearchStatus({ pending: true, busy: false, error: 'Network failure', demo: false, groups: [] }), 'Search unavailable');
  assert.equal(workspaceSearchStatus({ pending: false, busy: false, error: '', demo: false, groups: [{ status: 'unavailable', partial: true, records: [] }] }), 'Search incomplete');
  assert.equal(workspaceSearchStatus({ pending: false, busy: false, error: '', demo: false, groups: [{ status: 'available', partial: false, records: [] }] }), '0 matching records');
  assert.equal(workspaceSearchStatus({ pending: false, busy: false, error: '', demo: false, groups: [{ status: 'available', partial: true, records: [{ id: '1' }] }] }), '1 matching record · Partial results');
});
