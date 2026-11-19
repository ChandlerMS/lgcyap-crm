import test from 'node:test';
import assert from 'node:assert/strict';
import { readEventAttendance } from '../lib/event-attendance.mjs';
const signIn = (id, at, extra = {}) => ({ noteId: id, ticketId: '99', name: '=Synthetic', email: 'test@example.invalid', phone: '0407000000', office: 'orlando', day: at.slice(0, 10), at, heardAbout: 'Referral', license: 'Licensed', source: 'Event sign-in', imported: false, stage: 'Application', hubspotUrl: 'https://app.hubspot.com/contacts/50894788/record/0-5/99', ...extra });
test('Sign-Ins has attendance columns and preserves repeated visits in the correct Eastern month/week', async () => {
  const { buildSignInWorkbooks } = await import('../lib/sign-in-sheets-layout.mjs');
  const books = buildSignInWorkbooks({ partial: false, visits: [signIn('2', '2026-12-01T05:01:00Z'), signIn('1', '2026-12-01T04:59:00Z', { imported: true })], attendees: [{ ticketId: '99', signIns: 2, firstDay: '2026-11-30', lastDay: '2026-12-01', appliedAt: '2026-12-01T06:00:00Z' }] }, new Date('2026-12-01T14:00:00Z'));
  assert.deepEqual(books.map(book => book.title), ['11-26 Sign-Ins', '12-26 Sign-Ins']);
  const rows = books[0].tabs[5].values, headers = rows[0];
  for (const label of ['Name', 'Phone', 'Email', 'Office', 'Signed in (Eastern)', 'How they heard', 'License', 'Sign-in source', 'Current recruiting stage', 'HubSpot recruit']) assert.ok(headers.includes(label));
  assert.equal(rows[1][headers.indexOf('Name')], '=Synthetic');
  assert.equal(rows[1][headers.indexOf('Phone')], '0407000000');
  assert.equal(rows[1][headers.indexOf('Imported list')], 'Yes');
  assert.equal(rows[1][headers.indexOf('Sign-ins (person)')], '2');
  assert.equal(books[1].tabs[0].values[1][0], '2');
  assert.throws(() => buildSignInWorkbooks({ partial: true, visits: [] }, new Date()), /partial/i);
});
test('strict attendance reads all pages beyond 2,000 notes and gives every visit its note ID', async () => {
  let pages = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (new URL(url).pathname.endsWith('/notes/search')) {
      pages++;
      const last = Number(body.filterGroups[0].filters.find(filter => filter.propertyName === 'hs_object_id')?.value ?? body.after ?? 0);
      const count = Math.min(100, 2101 - last);
      return Response.json({ total: 2101 - last, results: Array.from({ length: count }, (_, i) => ({ id: String(last + i + 1), properties: { hs_timestamp: '2026-11-19T14:00:00Z', hs_note_body: '<p><strong>Hiring event sign-in</strong></p><p>Name: Synthetic Applicant</p><p>Email: test@example.invalid</p><p>Office: Orlando</p>' } })), ...(last + count < 2101 ? { paging: { next: { after: '100' } } } : {}) });
    }
    return Response.json({ status: 'COMPLETE', results: body.inputs.map(({ id }) => ({ from: { id }, to: [] })) });
  };
  const report = await readEventAttendance({ accessToken: 'synthetic', fetchImpl, strictComplete: true });
  assert.equal(report.partial, false);
  assert.equal(report.visits.length, 2101);
  assert.equal(report.visits[0].noteId, '1');
  assert.equal(pages, 22);
});
test('strict attendance refuses prematurely terminal search pages', async () => {
  await assert.rejects(readEventAttendance({ accessToken: 'synthetic', strictComplete: true, fetchImpl: async () => Response.json({ total: 2, results: [] }) }));
});
test('strict attendance rejects missing note bodies before publishing an incomplete snapshot', async () => {
  await assert.rejects(readEventAttendance({ accessToken: 'synthetic', strictComplete: true, fetchImpl: async () => Response.json({ total: 1, results: [{ id: '1', properties: { hs_timestamp: '2026-11-19T14:00:00Z' } }] }) }));
});
test('strict attendance verifies omitted associations as empty', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url); calls.push(parsed.pathname + parsed.search);
    if (parsed.pathname.endsWith('/notes/search')) return Response.json({ total: 1, results: [{ id: '1', properties: { hs_timestamp: '2026-11-19T14:00:00Z', hs_note_body: '<p><strong>Hiring event sign-in</strong></p><p>Name: Synthetic</p>' } }] });
    if (parsed.pathname.includes('/batch/read')) return Response.json({ status: 'COMPLETE', results: [] });
    if (parsed.pathname === '/crm/v4/objects/notes/1/associations/tickets') return Response.json({ results: [] });
    throw Error('Unexpected synthetic path');
  };
  const report = await readEventAttendance({ accessToken: 'synthetic', strictComplete: true, fetchImpl });
  assert.equal(report.visits.length, 1);
  assert.ok(calls.some(path => path.startsWith('/crm/v4/objects/notes/1/associations/tickets')));
});
test('one sign-in associated with multiple recruiting tickets produces one deterministic visit and person', async () => {
  const { summarizeEventAttendance } = await import('../lib/event-attendance.mjs');
  const report = summarizeEventAttendance({ notes: [{ id: '1', properties: { hs_timestamp: '2026-11-19T14:00:00Z', hs_note_body: '<p><strong>Hiring event sign-in</strong></p><p>Name: Synthetic</p>' } }], noteTickets: new Map([['1', ['20', '10']]]), tickets: new Map([['10', { pipeline: '924992938', stageId: '1473318769' }], ['20', { pipeline: '924992938', stageId: '1473318769' }]]) });
  assert.equal(report.visits.length, 1);
  assert.equal(report.attendees.length, 1);
  assert.equal(report.visits[0].ticketId, '10');
});
test('unresolved visitors retain visits without invented person totals or first/latest dates', async () => {
  const { buildSignInWorkbooks } = await import('../lib/sign-in-sheets-layout.mjs');
  const [book] = buildSignInWorkbooks({ partial: false, visits: [signIn('1', '2026-11-19T14:00:00Z', { ticketId: null })], attendees: [] }, new Date('2026-11-19T15:00:00Z'));
  const rows = book.tabs[3].values;
  for (const field of ['Sign-ins (person)', 'First sign-in', 'Latest sign-in']) assert.equal(rows[1][rows[0].indexOf(field)], '');
});
