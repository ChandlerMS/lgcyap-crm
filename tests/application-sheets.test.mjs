import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../lib/application-sheets-layout.mjs');
const app = (id, at, extra = {}) => ({ id, at, name: '=IMPORTXML("bad")', email: 'test@example.invalid', sections: [{ title: 'Your information', rows: [{ label: 'Full legal name', value: 'Synthetic Applicant' }, { label: 'Private answer', value: 'line one\nline two' }] }], flags: [], missed: [], ...extra });

test('uses Eastern month at UTC midnight and clips Monday–Sunday weeks to each month', async () => {
  const { buildApplicationWorkbooks } = await load();
  const books = buildApplicationWorkbooks({ applications: [app('1', '2026-12-01T04:59:00Z'), app('2', '2026-12-01T05:00:00Z')], partial: false }, new Date('2026-12-01T05:00:00Z'));
  assert.deepEqual(books.map(book => book.title), ['11-26 Applications', '12-26 Applications']);
  assert.deepEqual(books[0].tabs.map(tab => tab.title), ['Week 1 (01-01)', 'Week 2 (02-08)', 'Week 3 (09-15)', 'Week 4 (16-22)', 'Week 5 (23-29)', 'Week 6 (30-30)']);
  assert.equal(books[0].tabs[5].values[1][0], '1');
  assert.equal(books[1].tabs[0].values[1][0], '2');
});
test('keeps repeated applicants as separate submissions and exports every question as literal strings', async () => {
  const { buildApplicationWorkbooks } = await load();
  const [book] = buildApplicationWorkbooks({ applications: [app('2', '2026-11-19T15:00:00Z'), app('1', '2026-11-19T14:00:00Z')], partial: false }, new Date('2026-11-19T16:00:00Z'));
  const rows = book.tabs[3].values;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(1).map(row => row[0]), ['1', '2']);
  assert.equal(rows[1][rows[0].indexOf('Your information — Private answer')], 'line one\nline two');
  assert.equal(rows[1][rows[0].indexOf('Name')], '=IMPORTXML("bad")');
  assert.ok(rows.slice(1).every(row => row.every(cell => typeof cell === 'string')));
});
test('creates the empty current month with every week and rejects partial data and duplicate IDs', async () => {
  const { buildApplicationWorkbooks } = await load();
  const [book] = buildApplicationWorkbooks({ applications: [], partial: false }, new Date('2027-02-01T14:00:00Z'));
  assert.equal(book.title, '02-27 Applications');
  assert.equal(book.tabs.length, 4);
  assert.throws(() => buildApplicationWorkbooks({ applications: [], partial: true }, new Date()), /partial/i);
  const record = app('1', '2026-11-19T14:00:00Z');
  assert.throws(() => buildApplicationWorkbooks({ applications: [record, record], partial: false }, new Date()), /duplicate/i);
});
test('daily reconciliation follows 9 am Eastern in both DST seasons', async () => {
  const { easternSyncTime } = await load();
  assert.deepEqual(easternSyncTime(new Date('2026-11-19T14:00:00Z')), { day: '2026-11-19', daily: true });
  assert.deepEqual(easternSyncTime(new Date('2026-07-19T13:00:00Z')), { day: '2026-07-19', daily: true });
  assert.equal(easternSyncTime(new Date('2026-11-19T13:00:00Z')).daily, false);
  assert.equal(easternSyncTime(new Date('2026-07-19T14:00:00Z')).daily, true);
});
