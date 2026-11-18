import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_ATTENDANCE_SINCE, easternDay, noteKind, readEventAttendance, summarizeEventAttendance } from '../lib/event-attendance.mjs';
import { handleRecruitRequest } from '../lib/hubspot.mjs';

const PIPELINE = '924992938';
const HIRING_EVENT = '1473318768';
const APPLICATION = '1473318769';
const COMPLETED = '1416243218';
const signIn = (id, time, office = 'Orlando', existing = false) => ({ id, properties: {
  hs_timestamp: time,
  hs_note_body: `<p><strong>Hiring event sign-in${existing ? ' (this person already had an open recruiting ticket, so no new ticket was created)' : ''}</strong></p><p><strong>Signed in:</strong> today</p><p><strong>Name:</strong> Test Person ${id}</p>${office ? `<p><strong>Office:</strong> ${office}</p>` : ''}`,
} });
const application = (id, time) => ({ id, properties: { hs_timestamp: time, hs_note_body: `<p><strong>Agent application (v3.1) submitted online, ${time}</strong></p><p>Full legal name Test Applicant ${id}</p>` } });
const other = (id, time) => ({ id, properties: { hs_timestamp: time, hs_note_body: '<p>Left a voicemail about the Hiring event sign-in</p>' } });

function fixture() {
  const notes = [
    signIn('1', '2026-11-17T23:07:00Z'), // Nov 17 Eastern, new ticket 101
    signIn('2', '2026-11-18T03:30:00Z', 'Miami'), // still Nov 17 Eastern
    signIn('3', '2026-11-18T21:20:00Z', 'Orlando', true), // Nov 18, ticket 101 again (repeat visit)
    signIn('4', '2026-11-18T21:25:00Z', null), // office falls back to the ticket
    application('5', '2026-11-17T12:00:00Z'), // applied before signing in, on ticket 103
    application('6', '2026-11-18T00:05:00Z'), // attendee 101
    application('7', '2026-11-18T13:11:00Z'), // new applicant ticket 105
    application('8', '2026-11-18T13:20:00Z'), // no ticket: did not meet a required item
    application('9', '2026-11-18T14:00:00Z'), // ticket moved to another pipeline
    other('10', '2026-11-18T15:00:00Z'),
  ];
  const noteTickets = new Map([['1', ['101']], ['2', ['102']], ['3', ['101']], ['4', ['103']], ['5', ['103']], ['6', ['101']], ['7', ['105']], ['8', []], ['9', ['106']]]);
  const tickets = new Map([
    ['101', { pipeline: PIPELINE, stageId: COMPLETED, office: 'orlando' }],
    ['102', { pipeline: PIPELINE, stageId: HIRING_EVENT, office: 'miami' }],
    ['103', { pipeline: PIPELINE, stageId: APPLICATION, office: 'miami' }],
    ['105', { pipeline: PIPELINE, stageId: APPLICATION, office: 'orlando' }],
    ['106', { pipeline: '0', stageId: '1', office: 'orlando' }],
  ]);
  return { notes, noteTickets, tickets };
}

test('notes are classified by their fixed heading only', () => {
  assert.equal(noteKind(signIn('1', '2026-11-18T12:00:00Z').properties.hs_note_body), 'sign-in');
  assert.equal(noteKind('<p><strong>Hiring event sign-in (this person already had an open recruiting ticket)</strong></p>'), 'sign-in');
  assert.equal(noteKind('<div><p><strong>Agent application (v3.2) submitted online, Nov 18</strong></p></div>'), 'application');
  assert.equal(noteKind('<p>Left a voicemail about the Hiring event sign-in</p>'), null);
  assert.equal(noteKind(''), null);
  assert.equal(noteKind(undefined), null);
});

test('days are Eastern calendar days', () => {
  assert.equal(easternDay('2026-11-18T03:30:00Z'), '2026-11-17');
  assert.equal(easternDay('2026-11-18T05:00:00Z'), '2026-11-18');
  assert.equal(easternDay(EVENT_ATTENDANCE_SINCE), '2026-11-10');
  assert.equal(easternDay('not a date'), null);
});

test('people, the funnel, stages, days and applications come from sign-in and application notes', () => {
  const report = summarizeEventAttendance({ ...fixture(), fetchedAt: '2026-11-18T22:00:00.000Z' });
  assert.deepEqual(report.people, { signedIn: 3, applied: 2, hired: 1 });
  assert.equal(report.signIns, 4);
  assert.deepEqual(report.applications, { total: 5, fromAttendees: 2, otherTickets: 2, noTicket: 1 });
  assert.deepEqual(report.stages, [
    { stageId: HIRING_EVENT, label: 'Hiring Event', count: 1 },
    { stageId: APPLICATION, label: 'Application', count: 1 },
    { stageId: COMPLETED, label: 'Completed', count: 1 },
  ]);
  assert.deepEqual(report.offices, [{ key: 'orlando', label: 'Orlando' }, { key: 'miami', label: 'Miami' }]);
  assert.deepEqual(report.days, [
    { day: '2026-11-18', offices: { orlando: 1, miami: 1 }, signIns: 2, applications: 3 },
    { day: '2026-11-17', offices: { orlando: 1, miami: 1 }, signIns: 2, applications: 2 },
  ]);
  assert.equal(report.since, '2026-11-10');
  assert.equal(report.partial, false);
  // Counts only: no names or answers leave the server.
  assert.doesNotMatch(JSON.stringify(report), /Test (Person|Applicant)|voicemail/);
});

test('a sign-in with no office anywhere is shown as not recorded', () => {
  const report = summarizeEventAttendance({ notes: [signIn('1', '2026-11-18T15:00:00Z', null)], noteTickets: new Map([['1', []]]), tickets: new Map(), fetchedAt: '2026-11-18T22:00:00.000Z' });
  assert.deepEqual(report.people, { signedIn: 0, applied: 0, hired: 0 });
  assert.deepEqual(report.offices.at(-1), { key: 'other', label: 'Office not recorded' });
  assert.deepEqual(report.days[0].offices, { other: 1 });
});

function hubspot(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body, init });
    const reply = routes[path];
    if (!reply) return new Response('{}', { status: 404 });
    const [status, payload] = reply(body, calls.filter(call => call.path === path).length);
    return new Response(JSON.stringify(payload), { status });
  };
  return { calls, fetchImpl };
}

test('reads form notes since the sign-in page went live, then their tickets, with fixed endpoints', async () => {
  const { notes, noteTickets, tickets } = fixture();
  const { calls, fetchImpl } = hubspot({
    '/crm/v3/objects/notes/search': (body, n) => n === 1
      ? [200, { total: notes.length, results: notes.slice(0, 6), paging: { next: { after: '6' } } }]
      : [200, { total: notes.length, results: notes.slice(6) }],
    '/crm/v4/associations/notes/tickets/batch/read': body => [207, {
      status: 'COMPLETE',
      results: body.inputs.filter(({ id }) => noteTickets.get(id)?.length).map(({ id }) => ({ from: { id }, to: noteTickets.get(id).map(ticket => ({ toObjectId: Number(ticket), associationTypes: [] })) })),
      errors: body.inputs.filter(({ id }) => !noteTickets.get(id)?.length).map(({ id }) => ({ status: 'error', category: 'OBJECT_NOT_FOUND', context: { fromObjectId: [id] } })),
    }],
    '/crm/v3/objects/tickets/batch/read': body => [200, { status: 'COMPLETE', results: body.inputs.map(({ id }) => ({ id, archived: false, properties: { hs_pipeline: tickets.get(id).pipeline, hs_pipeline_stage: tickets.get(id).stageId, orientation_office: tickets.get(id).office } })) }],
  });
  const report = await readEventAttendance({ accessToken: 'test-token', fetchImpl, now: () => Date.parse('2026-11-18T22:00:00Z') });
  assert.deepEqual(report.people, { signedIn: 3, applied: 2, hired: 1 });
  assert.equal(report.fetchedAt, '2026-11-18T22:00:00.000Z');
  assert.deepEqual(calls.map(call => call.path), ['/crm/v3/objects/notes/search', '/crm/v3/objects/notes/search', '/crm/v4/associations/notes/tickets/batch/read', '/crm/v3/objects/tickets/batch/read']);
  const [first, second, links, read] = calls;
  assert.deepEqual(first.body.filterGroups, [{ filters: [
    { propertyName: 'hs_object_source_label', operator: 'EQ', value: 'INTEGRATION' },
    { propertyName: 'hs_createdate', operator: 'GTE', value: String(Date.parse('2026-11-10T05:00:00Z')) },
  ] }]);
  assert.equal(first.body.after, undefined);
  assert.equal(second.body.after, '6');
  // Only sign-in and application notes are looked up; other integration notes are not.
  assert.deepEqual(links.body.inputs.map(input => input.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(read.body.inputs.map(input => input.id).sort(), ['101', '102', '103', '105', '106']);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers.Authorization, 'Bearer test-token');
  }
});

test('no form notes means no association or ticket reads', async () => {
  const { calls, fetchImpl } = hubspot({ '/crm/v3/objects/notes/search': () => [200, { total: 0, results: [] }] });
  const report = await readEventAttendance({ accessToken: 'test-token', fetchImpl });
  assert.equal(calls.length, 1);
  assert.deepEqual(report.people, { signedIn: 0, applied: 0, hired: 0 });
  assert.deepEqual(report.days, []);
});

test('HubSpot failures become safe recruiting errors', async () => {
  await assert.rejects(readEventAttendance({ accessToken: '' }), { code: 'CONNECTION_NOT_CONFIGURED', status: 503 });
  await assert.rejects(readEventAttendance({ accessToken: 'test-token', fetchImpl: hubspot({ '/crm/v3/objects/notes/search': () => [403, {}] }).fetchImpl }), { code: 'HUBSPOT_ACCESS_REQUIRED' });
  await assert.rejects(readEventAttendance({ accessToken: 'test-token', fetchImpl: hubspot({ '/crm/v3/objects/notes/search': () => [500, {}] }).fetchImpl }), { code: 'HUBSPOT_UNAVAILABLE' });
  await assert.rejects(readEventAttendance({ accessToken: 'test-token', fetchImpl: hubspot({ '/crm/v3/objects/notes/search': () => [200, { results: 'nope' }] }).fetchImpl }), { code: 'HUBSPOT_RESPONSE_INVALID' });
  const repeated = hubspot({ '/crm/v3/objects/notes/search': () => [200, { total: 9, results: [signIn('1', '2026-11-18T15:00:00Z')], paging: { next: { after: '1' } } }] });
  await assert.rejects(readEventAttendance({ accessToken: 'test-token', fetchImpl: repeated.fetchImpl }), { code: 'HUBSPOT_RESPONSE_INVALID' });
});

test('the API keeps the workspace sign-in, editor and origin checks', async () => {
  const origin = 'https://crm.example.test';
  const request = (headers = {}) => new Request(`${origin}/api/event-attendance`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: '{}' });
  const readData = async () => ({ people: { signedIn: 1, applied: 0, hired: 0 } });
  const base = { readData, allowedOrigin: origin, authorizeUser: user => user.email === 'editor@example.test' };
  assert.equal((await handleRecruitRequest(request(), { ...base, getUser: async () => null })).status, 401);
  assert.equal((await handleRecruitRequest(request(), { ...base, getUser: async () => ({ email: 'viewer@example.test' }) })).status, 403);
  assert.equal((await handleRecruitRequest(request({ Origin: 'https://other.example.test' }), { ...base, getUser: async () => ({ email: 'editor@example.test' }) })).status, 403);
  const ok = await handleRecruitRequest(request(), { ...base, getUser: async () => ({ email: 'editor@example.test' }) });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('Cache-Control'), /private, no-store/);
  assert.deepEqual(await ok.json(), { people: { signedIn: 1, applied: 0, hired: 0 } });
});
