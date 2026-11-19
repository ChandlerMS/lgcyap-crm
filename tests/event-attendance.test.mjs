import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_ATTENDANCE_SINCE, easternDay, noteKind, readEventAttendance, summarizeEventAttendance } from '../lib/event-attendance.mjs';
import { eventReviewBody, eventReviewHtml, parseEventReview, newerEventReview } from '../lib/event-review.mjs';
import { handleRecruitRequest } from '../lib/hubspot.mjs';

const PIPELINE = '924992938';
const HIRING_EVENT = '1473318768';
const APPLICATION = '1473318769';
const COMPLETED = '1416243218';
const signIn = (id, time, office = 'Orlando', existing = false) => ({ id, properties: {
  hs_timestamp: time,
  hs_note_body: `<p><strong>Hiring event sign-in${existing ? ' (this person already had an open recruiting ticket, so no new ticket was created)' : ''}</strong></p><p><strong>Signed in:</strong> today</p><p><strong>Signed in from:</strong> Conference room screen (QR)</p><p><strong>Name:</strong> Test Person ${id}</p><p><strong>Email:</strong> person${id}@example.invalid</p><p><strong>Phone:</strong> (407) 555-01${id.padStart(2, '0')}</p>${office ? `<p><strong>Office:</strong> ${office}</p>` : ''}<p><strong>How they heard about us:</strong> Job posting: Indeed</p><p><strong>License:</strong> Unlicensed</p><p><strong>Photo ID (building security):</strong> Attached to the sign-in note (private file)</p>`,
} });
const application = (id, time, met = true) => ({ id, properties: { hs_timestamp: time, hs_note_body: `<p><strong>Agent application (v3.1) submitted online, ${time}</strong></p><p><strong>Required items:</strong> ${met ? 'Meets all required items' : 'Did not meet: Secret required item'}</p><p><strong>YOUR INFORMATION</strong></p><ul><li><strong>Full legal name</strong><br>Test Applicant ${id}</li><li><strong>Email address</strong><br>applicant${id}@example.invalid</li><li><strong>Mobile phone</strong><br>(407) 555-02${id.padStart(2, '0')}</li><li><strong>Which office are you applying for?</strong><br>Orlando</li></ul><p><strong>ELIGIBILITY</strong></p><ul><li><strong>Private answer</strong><br>Sensitive answer text</li></ul>` } });
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
    application('8', '2026-11-18T13:20:00Z', false), // no ticket: did not meet a required item
    application('9', '2026-11-18T14:00:00Z'), // ticket moved to another pipeline
    other('10', '2026-11-18T15:00:00Z'),
  ];
  const noteTickets = new Map([['1', ['101']], ['2', ['102']], ['3', ['101']], ['4', ['103']], ['5', ['103']], ['6', ['101']], ['7', ['105']], ['8', []], ['9', ['106']]]);
  const tickets = new Map([
    ['101', { pipeline: PIPELINE, stageId: COMPLETED, office: 'orlando', name: 'Ticket Name 101', email: '', phone: '' }],
    ['102', { pipeline: PIPELINE, stageId: HIRING_EVENT, office: 'miami', name: 'Ticket Name 102', email: '', phone: '' }],
    ['103', { pipeline: PIPELINE, stageId: APPLICATION, office: 'miami', name: 'Ticket Name 103', email: '', phone: '' }],
    ['105', { pipeline: PIPELINE, stageId: APPLICATION, office: 'orlando', name: 'Ticket Name 105', email: '', phone: '' }],
    ['106', { pipeline: '0', stageId: '1', office: 'orlando', name: 'Ticket Name 106', email: '', phone: '' }],
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
  assert.deepEqual(report.offices, [{ key: 'orlando', label: 'Orlando' }, { key: 'miami', label: 'Miami' }, { key: 'tampa', label: 'Tampa' }]);
  assert.deepEqual(report.days, [
    { day: '2026-11-18', offices: { orlando: 1, miami: 1 }, signIns: 2, applications: 3 },
    { day: '2026-11-17', offices: { orlando: 1, miami: 1 }, signIns: 2, applications: 2 },
  ]);
  assert.equal(report.since, '2026-11-10');
  assert.equal(report.partial, false);
  // Application answers, the missed required item and unrelated notes never leave the server.
  assert.doesNotMatch(JSON.stringify(report), /Sensitive answer|Secret required item|voicemail|Photo ID/);
});

test('every count has the people behind it, with the same office and day as the table', () => {
  const report = summarizeEventAttendance({ ...fixture(), fetchedAt: '2026-11-18T22:00:00.000Z' });
  // People who signed in: latest sign-in details, current stage and first application.
  assert.deepEqual(report.attendees.map(person => [person.ticketId, person.name, person.office, person.stage, person.signIns, person.firstDay, person.lastDay, person.appliedAt]), [
    ['101', 'Test Person 3', 'orlando', 'Completed', 2, '2026-11-17', '2026-11-18', '2026-11-18T00:05:00.000Z'],
    ['103', 'Test Person 4', 'miami', 'Application', 1, '2026-11-18', '2026-11-18', '2026-11-17T12:00:00.000Z'],
    ['102', 'Test Person 2', 'miami', 'Hiring Event', 1, '2026-11-17', '2026-11-17', null],
  ]);
  const first = report.attendees[0];
  assert.equal(first.email, 'person3@example.invalid');
  assert.equal(first.phone, '(407) 555-0103');
  assert.equal(first.hubspotUrl, 'https://app.hubspot.com/contacts/50894788/record/0-5/101');
  // Every sign-in, newest first, with the answers from that sign-in.
  assert.equal(report.visits.length, report.signIns);
  assert.deepEqual(report.visits.map(visit => [visit.day, visit.office, visit.name]), [
    ['2026-11-18', 'miami', 'Test Person 4'], ['2026-11-18', 'orlando', 'Test Person 3'],
    ['2026-11-17', 'miami', 'Test Person 2'], ['2026-11-17', 'orlando', 'Test Person 1'],
  ]);
  assert.deepEqual({ heardAbout: report.visits[0].heardAbout, license: report.visits[0].license, source: report.visits[0].source, imported: report.visits[0].imported, stage: report.visits[0].stage },
    { heardAbout: 'Job posting: Indeed', license: 'Unlicensed', source: 'Conference room screen (QR)', imported: false, stage: 'Application' });
  // Each table cell's count matches the people listed for that day and office.
  for (const row of report.days) for (const [office, count] of Object.entries(row.offices)) {
    assert.equal(report.visits.filter(visit => visit.day === row.day && visit.office === office).length, count);
  }
  // Applications: name and contact details, and only whether required items were met.
  assert.deepEqual(report.applicants.map(item => [item.name, item.requirementsMet, item.fromAttendee, item.ticketId]), [
    ['Test Applicant 9', true, false, null], ['Test Applicant 8', false, false, null], ['Test Applicant 7', true, false, '105'],
    ['Test Applicant 6', true, true, '101'], ['Test Applicant 5', true, true, '103'],
  ]);
  assert.deepEqual([report.applicants[2].email, report.applicants[2].phone, report.applicants[2].office], ['applicant7@example.invalid', '(407) 555-0207', 'orlando']);
});

test('an imported sign-in is marked, and the ticket fills in a missing name', () => {
  const imported = { id: '1', properties: { hs_timestamp: '2026-11-17T17:00:00Z', hs_note_body: '<p><strong>Hiring event sign-in (imported from a sign-in list)</strong></p><p><strong>Event date:</strong> Tue, Nov 17, 2026</p><p><strong>Office:</strong> Tampa</p>' } };
  const report = summarizeEventAttendance({ notes: [imported], noteTickets: new Map([['1', ['101']]]), tickets: new Map([['101', { pipeline: PIPELINE, stageId: HIRING_EVENT, office: 'tampa', name: 'Ticket Name', email: 'ticket@example.invalid', phone: '+14075550100' }]]), fetchedAt: '2026-11-18T22:00:00.000Z' });
  assert.deepEqual([report.visits[0].imported, report.visits[0].name, report.visits[0].email, report.visits[0].office], [true, 'Ticket Name', 'ticket@example.invalid', 'tampa']);
  assert.deepEqual(report.days[0].offices, { tampa: 1 });
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


test('review reader joins decisions by recruiting ticket across signed-in and applied lists', async () => {
  const {notes,noteTickets,tickets}=fixture();
  const secret='event-review-test-secret-32-characters';
  const review=(id,status,at)=>({id,properties:{hs_note_body:eventReviewHtml({ticketId:id==='23'?'106':id==='24'?'102':'101',status,requestId:`00000000-0000-4000-8000-${(id==='24'?'22':id).padStart(12,'0')}`,reviewedAt:new Date(at).toISOString(),secret}),hs_timestamp:at}});
  const decisions=[review('21','approved','2026-11-18T21:00:00Z'),review('22','denied','2026-11-18T22:00:00Z'),review('23','approved','2026-11-18T22:00:00Z'),review('24','approved','2026-11-18T22:00:00Z')];
  const links=new Map([...noteTickets,['21',['101']],['22',['101']],['23',['106']],['24',['102']]]);
  let partial=false, associationFailure=false;
  const {fetchImpl:baseFetch}=hubspot({
    '/crm/v3/objects/notes/search': body=>[200,{total:body.filterGroups[0].filters.some(f=>f.propertyName==='hs_note_body')?(partial?2001:decisions.length):notes.length,results:body.filterGroups[0].filters.some(f=>f.propertyName==='hs_note_body')?decisions:notes}],
    '/crm/v4/associations/notes/tickets/batch/read':body=>[207,{status:'COMPLETE',...(associationFailure && body.inputs.some(({id})=>id==='22')?{numErrors:1,errors:[{category:'OBJECT_NOT_FOUND'}]}:{}),results:body.inputs.map(({id})=>({from:{id},to:(links.get(id)??[]).map(ticket=>({toObjectId:Number(ticket),associationTypes:[]}))}))}],
    '/crm/v3/objects/tickets/batch/read':body=>[200,{results:body.inputs.map(({id})=>({id,properties:{hs_pipeline:tickets.get(id).pipeline,hs_pipeline_stage:tickets.get(id).stageId}}))}],
  });
  const fetchImpl=async(url,init)=>{const path=new URL(url).pathname;const match=path.match(/^\/crm\/v4\/objects\/tickets\/(\d+)\/associations\/notes$/);if(match)return new Response(JSON.stringify({results:decisions.filter(note=>links.get(note.id)?.includes(match[1])).map(note=>({toObjectId:Number(note.id)}))}));if(path==='/crm/v3/objects/notes/batch/read'){const ids=JSON.parse(init.body).inputs.map(row=>row.id);return new Response(JSON.stringify({status:'COMPLETE',results:decisions.filter(note=>ids.includes(note.id))}));}return baseFetch(url,init);};
  const report=await readEventAttendance({accessToken:'test-token',fetchImpl,includeReviews:true,reviewSecrets:[secret],now:()=>Date.parse('2026-11-18T23:00:00Z')});
  assert.equal(report.reviews['101'].status,'denied');assert.equal(report.reviews['101'].noteId,'22');assert.equal(report.reviews['106'],undefined);assert.equal(report.reviewComplete,true);assert.equal(report.reviews['102'].status,'approved');
  assert.ok(report.attendees.some(row=>row.ticketId==='101'&&row.appliedAt));assert.deepEqual(report.people,{signedIn:3,applied:2,hired:1});
  assert.equal(parseEventReview({id:'24',properties:{hs_note_body:'A quick note mentioning LGCYEventReview',hs_timestamp:'2026-11-18T22:00:00Z'}}),null);
  partial=true;
  const fallback=await readEventAttendance({accessToken:'test-token',fetchImpl,includeReviews:true,reviewSecrets:[secret],now:()=>Date.parse('2026-11-18T23:00:00Z')});
  assert.equal(fallback.reviewComplete,true);assert.equal(fallback.reviews['101'].status,'denied');assert.equal(fallback.reviews['102'].status,'approved');
  partial=false;associationFailure=true;
  const incomplete=await readEventAttendance({accessToken:'test-token',fetchImpl,includeReviews:true,reviewSecrets:[secret]});
  assert.equal(incomplete.reviewComplete,false);assert.deepEqual(incomplete.reviews,{});assert.match(incomplete.reviewNotice,/could not refresh/);
  assert.equal(newerEventReview({...report.reviews['101'],noteId:'20'},{...report.reviews['101'],noteId:'22'}).noteId,'22');
});
