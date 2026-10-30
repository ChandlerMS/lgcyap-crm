import test from 'node:test';
import assert from 'node:assert/strict';
import { currentHubspotMonth, filterHubspotRows, hubspotDateKey, hubspotMonthDays, hubspotRetryDeadline, safeHubspotViewLink, shiftHubspotMonth } from '../app/hubspot-workspace-view.mjs';

test('meeting calendar places start instants in the Eastern agency date', () => {
  assert.equal(hubspotDateKey('2026-11-01T03:59:59Z'), '2026-10-31');
  assert.equal(hubspotDateKey('2026-11-01T04:00:00Z'), '2026-11-01');
  assert.equal(hubspotDateKey(null), null);
  assert.equal(hubspotDateKey('invalid'), null);
  assert.equal(currentHubspotMonth(new Date('2026-11-01T03:00:00Z')), '2026-10');
});

test('month navigation and grid handle leap years and December rollover', () => {
  assert.equal(shiftHubspotMonth('2026-12', 1), '2027-01');
  assert.equal(shiftHubspotMonth('2027-01', -1), '2026-12');
  assert.equal(shiftHubspotMonth('invalid', 1), 'invalid');
  assert.equal(shiftHubspotMonth('9999-12', 1), '9999-12');
  assert.equal(hubspotMonthDays('2028-02').filter(Boolean).length, 29);
  assert.equal(hubspotMonthDays('2027-02').filter(Boolean).length, 28);
  assert.equal(hubspotMonthDays('2026-11')[0].day, 1);
  assert.equal(hubspotMonthDays('2026-10').length % 7, 0);
  assert.deepEqual(hubspotMonthDays('2026-13'), []);
});

test('calendar deduplicates meetings and does not invent missing or out-of-month events', () => {
  const days = hubspotMonthDays('2026-10', [
    { id: '1', title: 'Old', scheduledAt: '2026-10-31T15:00:00Z' },
    { id: '1', title: 'Current', scheduledAt: '2026-10-31T16:00:00Z' },
    { id: '2', scheduledAt: '2026-11-01T03:59:59Z' },
    { id: '3', scheduledAt: '2026-11-01T04:00:00Z' },
    { id: '4', scheduledAt: null },
  ]);
  const last = days.find(day => day?.day === 31);
  assert.deepEqual(last.records.map(record => record.id), ['1', '2']);
  assert.equal(last.records[0].title, 'Current');
  assert.equal(days.filter(Boolean).reduce((total, day) => total + day.records.length, 0), 2);
});

test('local search uses displayed fields, handles case and ignores hidden link strings', () => {
  const rows = [{ id: '1', title: 'Person One', email: 'one@example.com' }, { id: '2', title: 'Company', owner: 'Alex Smith', hubspotUrl: 'https://example.com/secret' }];
  assert.deepEqual(filterHubspotRows(rows, ' EXAMPLE.COM ').map(row => row.id), ['1']);
  assert.deepEqual(filterHubspotRows(rows, 'smith').map(row => row.id), ['2']);
  assert.deepEqual(filterHubspotRows(rows, 'secret'), []);
  assert.equal(filterHubspotRows(rows, ''), rows);
});

test('record links remain within the fixed HubSpot portal', () => {
  const valid = 'https://app.hubspot.com/contacts/50894788/record/0-1/123';
  assert.equal(safeHubspotViewLink(valid), valid);
  for (const value of ['javascript:alert(1)', 'https://evil.example/50894788', 'https://app.hubspot.com.evil.example/50894788', 'https://app.hubspot.com/contacts/999/record/0-1/123', 'https://evil@app.hubspot.com/50894788', 'https://app.hubspot.com:444/50894788', '/contacts/50894788']) assert.equal(safeHubspotViewLink(value), null, value);
});

test('read cooldown accepts unavailable envelopes and caps delays without retrying', () => {
  assert.equal(hubspotRetryDeadline(25, true, 1000), 26000);
  assert.equal(hubspotRetryDeadline('12', false, 1000), 13000);
  assert.equal(hubspotRetryDeadline(undefined, true, 1000), 61000);
  assert.equal(hubspotRetryDeadline('invalid', true, 1000), 61000);
  assert.equal(hubspotRetryDeadline(999999999, true, 1000), 86401000);
  assert.equal(hubspotRetryDeadline(null, false, 1000), null);
  assert.equal(hubspotRetryDeadline(-1, false, 1000), null);
});
