import test from 'node:test';
import assert from 'node:assert/strict';
import { activityRecruits, upcomingMeetingChips, weekMeetingChips } from '../app/dashboard-activity.mjs';
import { pageNumbers } from '../app/panel-pager.mjs';

const now = Date.parse('2026-11-18T17:00:00Z'); // Wednesday, Nov 18, 12:00 PM Eastern

test('Add Task lists live recruits by name; Add Follow-Up puts the longest waiting first', () => {
  const records = [
    { id: '3', firstName: 'Cara', lastName: 'Lane', stage: 'Offer', lastContactedAt: '2026-11-17T12:00:00Z' },
    { id: '1', name: 'Ava Moss', stage: 'Application', lastContactedAt: '2026-10-01T12:00:00Z' },
    { id: '2', name: 'Ben Ray', stage: 'Training', createdAt: '2026-10-20T12:00:00Z' },
    { id: '9', name: 'Demo Person', isDemo: true, createdAt: '2026-01-01T12:00:00Z' },
    { id: '3', firstName: 'Cara', lastName: 'Lane', stage: 'Offer', lastContactedAt: '2026-11-17T12:00:00Z' },
  ];
  assert.deepEqual(activityRecruits(records), [
    { id: '1', name: 'Ava Moss', detail: 'Application' }, { id: '2', name: 'Ben Ray', detail: 'Training' }, { id: '3', name: 'Cara Lane', detail: 'Offer' },
  ]);
  assert.deepEqual(activityRecruits(records, { now, followUpFirst: true }), [
    { id: '1', name: 'Ava Moss', detail: '48 days waiting' }, { id: '2', name: 'Ben Ray', detail: '29 days waiting' }, { id: '3', name: 'Cara Lane', detail: 'Offer' },
  ]);
  assert.deepEqual(activityRecruits([]), []);
});

test('Meetings shows today and later; Calendar shows this week, both on the Eastern calendar', () => {
  const records = [
    { id: 'late', title: 'Next month', scheduledAt: '2026-12-10T15:00:00Z', hubspotUrl: 'https://app.hubspot.com/contacts/1/record/0-47/late' },
    { id: 'past', title: 'Last week', scheduledAt: '2026-11-11T15:00:00Z' },
    { id: 'early', title: 'This morning', scheduledAt: '2026-11-18T14:00:00Z', status: 'Scheduled' },
    // 11:30 PM Eastern on Nov 24 is still within the week, though it is Nov 25 in UTC.
    { id: 'edge', title: 'Late call', scheduledAt: '2026-11-25T04:30:00Z', hubspotUrl: 'https://evil.example/x' },
    { id: 'none', title: 'Undated' },
  ];
  const upcoming = upcomingMeetingChips(records, now);
  assert.deepEqual(upcoming.map(item => [item.id, item.badge]), [['early', 'Nov 18'], ['edge', 'Nov 24'], ['late', 'Dec 10']]);
  assert.equal(upcoming[0].previewDetail, 'Wed, Nov 18, 9:00 AM · Scheduled');
  assert.equal(upcoming[1].href, undefined, 'Only HubSpot links are kept.');
  assert.equal(upcoming[2].href, 'https://app.hubspot.com/contacts/1/record/0-47/late');
  assert.deepEqual(weekMeetingChips(records, now).map(item => [item.id, item.badge]), [['early', 'Wed 9:00 AM'], ['edge', 'Tue 11:30 PM']]);
  assert.deepEqual(upcomingMeetingChips(records, 0), []);
  assert.deepEqual(weekMeetingChips(records, NaN), []);
});

test('pagers number every page when there are few and keep the ends and neighbors when there are many', () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(5, 9), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageNumbers(12, 1), [1, 2, 3, 4, null, 12]);
  assert.deepEqual(pageNumbers(12, 4), [1, 2, 3, 4, 5, null, 12]);
  assert.deepEqual(pageNumbers(12, 6), [1, null, 5, 6, 7, null, 12]);
  assert.deepEqual(pageNumbers(12, 12), [1, null, 9, 10, 11, 12]);
  assert.deepEqual(pageNumbers(0, 0), [1]);
});
