import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { attendeeEventDay, attendeeOffice, attendeeRowIssues, normalizeAttendeeRow, validateAttendeeImportInput } from '../lib/event-attendee-input.mjs';
import { handleAttendeeImportRequest, importAttendee, importedSignInNote } from '../lib/event-attendee-import.mjs';
import { createRecruitIntake, createRecruitIntakePostgresLedger } from '../lib/recruit-intake.mjs';
import { attendanceCsv, attendanceCsvFilename, attendeeRowsFromCells, HUBSPOT_SOURCE_URL, parseAttendeeFile } from '../app/event-attendance/attendance-files.mjs';

const migration = await readFile(new URL('../migrations/0003_recruit_intake.sql', import.meta.url), 'utf8');
const TODAY = '2026-11-18';
const clock = () => Date.parse('2026-11-18T22:00:00Z');
const secret = 'synthetic-only-recruit-intake-hmac-key-0123456789';
const user = { userId: 'synthetic-user', email: 'editor@example.invalid', displayName: 'Synthetic Editor' };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = { firstName: 'Synthetic', lastName: 'Attendee', phone: '(407) 555-0123', email: 'Attendee@Example.Invalid', office: 'Orlando', eventDate: '11/17/2026' };

test('event dates, offices and rows are normalized the same way in the browser and on the server', () => {
  assert.equal(attendeeEventDay('2026-11-17'), '2026-11-17');
  assert.equal(attendeeEventDay('11/17/2026'), '2026-11-17');
  assert.equal(attendeeEventDay('11/7/26'), '2026-11-07');
  assert.equal(attendeeEventDay(new Date(Date.UTC(2026, 10, 17))), '2026-11-17');
  assert.equal(attendeeEventDay('46343'), '2026-11-17'); // Excel day number
  for (const bad of ['', '2/30/2026', '17/11/2026', 'yesterday', '123']) assert.equal(attendeeEventDay(bad), '');
  assert.equal(attendeeOffice('Orlando'), 'orlando');
  assert.equal(attendeeOffice(' MIAMI '), 'miami');
  assert.equal(attendeeOffice('Jacksonville'), '');
  assert.deepEqual(normalizeAttendeeRow(row, { today: TODAY }), { firstName: 'Synthetic', lastName: 'Attendee', phone: '+14075550123', email: 'attendee@example.invalid', office: 'orlando', eventDate: '2026-11-17' });
  const problems = (change) => { try { normalizeAttendeeRow({ ...row, ...change }, { today: TODAY }); return {}; } catch (error) { return error.fieldErrors; } };
  assert.match(problems({ eventDate: '11/19/2026' }).eventDate, /future/);
  assert.match(problems({ eventDate: '11/17/2025' }).eventDate, /12 months/);
  assert.match(problems({ office: 'Remote' }).office, /Orlando/);
  assert.ok(problems({ phone: 'none' }).phone);
  assert.throws(() => normalizeAttendeeRow({ ...row, hs_pipeline_stage: '1' }, { today: TODAY }), { code: 'INVALID_INTAKE' });
  assert.throws(() => validateAttendeeImportInput({ ...row, requestId: 'not-a-uuid' }, { today: TODAY }), { code: 'INVALID_INTAKE' });
  const issues = attendeeRowIssues([row, { ...row, email: '' }, { ...row, eventDate: '2026-11-18' }], { today: TODAY });
  assert.match(issues[0].phone, /more than once/);
  assert.match(issues[1].phone, /more than once/);
  assert.deepEqual(issues[2], {}); // the same person on another day is a second sign-in
});

test('sign-in sheets map their columns, split a single Name column and keep Excel dates', async () => {
  assert.deepEqual(attendeeRowsFromCells([
    ['Name', 'Cell', 'Email Address', 'Location', 'Date'],
    ['Synthetic Middle Attendee', '4075550123', '', 'Miami', new Date(Date.UTC(2026, 10, 17))],
    ['', '', '', '', ''],
  ]), [{ firstName: 'Synthetic', lastName: 'Middle Attendee', phone: '4075550123', email: '', office: 'Miami', eventDate: '2026-11-17' }]);
  assert.throws(() => attendeeRowsFromCells([['First Name', 'Last Name', 'Phone'], ['a', 'b', '4075550123']]), /Office and Event Date/);
  assert.throws(() => attendeeRowsFromCells([['First Name', 'Last Name', 'Phone', 'Office', 'Date'], ['=HYPERLINK("x")', 'b', '1', 'Orlando', '11/17/2026']]), /Formula/);
  const csv = 'First Name,Last Name,Phone Number,Email,Office,Event Date\r\nSynthetic,Attendee,(407) 555-0123,attendee@example.invalid,Orlando,11/17/2026\r\n';
  const rows = await parseAttendeeFile(new File([csv], 'sign-in.csv'));
  assert.deepEqual(rows, [{ firstName: 'Synthetic', lastName: 'Attendee', phone: '(407) 555-0123', email: 'attendee@example.invalid', office: 'Orlando', eventDate: '11/17/2026' }]);
});

test('export is the attendance table with a total row, safe to open in Excel', () => {
  const report = { fetchedAt: '2026-11-18T22:00:00.000Z', offices: [{ key: 'orlando', label: 'Orlando' }, { key: 'miami', label: 'Miami' }], days: [
    { day: '2026-11-18', offices: { orlando: 4 }, signIns: 4, applications: 3 },
    { day: '2026-11-17', offices: { orlando: 5, miami: 1 }, signIns: 6, applications: 3 },
  ] };
  assert.equal(attendanceCsv(report), 'Event day,Orlando,Miami,Sign-ins,Online applications\r\n2026-11-18,4,0,4,3\r\n2026-11-17,5,1,6,3\r\nTotal,9,1,10,6\r\n');
  assert.equal(attendanceCsv({ ...report, offices: [{ key: 'x', label: '=cmd' }], days: [] }), "Event day,'=cmd,Sign-ins,Online applications\r\nTotal,0,0,0\r\n");
  assert.equal(attendanceCsvFilename(report.fetchedAt), 'event-attendance-2026-11-18.csv');
  assert.equal(attendanceCsvFilename('2026-11-19T00:35:00.000Z'), 'event-attendance-2026-11-18.csv'); // 7:35 PM Eastern
  assert.equal(attendanceCsvFilename('not a date'), 'event-attendance.csv');
});

test('Open in HubSpot links to the Recruiting tickets the forms create', () => {
  const url = new URL(HUBSPOT_SOURCE_URL);
  assert.equal(url.origin + url.pathname, 'https://app.hubspot.com/contacts/50894788/objects/0-5/views/all/list');
  assert.deepEqual(JSON.parse(url.searchParams.get('filters')), [
    { property: 'hs_pipeline', operator: 'EQ', value: '924992938' },
    { property: 'source_type', operator: 'EQ', value: 'FORM' },
  ]);
});

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const access = { hubId: 50894788, appId: 59264745, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write'] };
const labels = { results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 16 }] };
const contact = { id: '123', properties: { firstname: 'Synthetic', lastname: 'Attendee', phone: '+14075550123', mobilephone: null, email: 'attendee@example.invalid' } };
const ticket = { id: '456', properties: { subject: 'Recruiting: Synthetic Attendee', recruit_name: 'Synthetic Attendee', hs_pipeline: '924992938', hs_pipeline_stage: '1473318768', recruiting_path: 'genpop', licensing_branch: null }, associations: { contacts: { results: [{ id: '123', type: 'ticket_to_contact' }] } } };
const signInNote = (id, time) => ({ id, properties: { hs_timestamp: time, hs_note_body: '<p><strong>Hiring event sign-in</strong></p><p><strong>Office:</strong> Orlando</p>' } });

function hubspot({ existing = false, notes = [], noteReply = () => json({ id: '789' }, 201) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, pathname, body, init });
    assert.equal(init.redirect, 'manual');
    const route = `${method} ${pathname}`;
    if (route === 'POST /oauth/v2/private-apps/get/access-token-info') return json(access);
    if (route === 'GET /crm/v4/associations/tickets/contacts/labels') return json(labels);
    if (route === 'POST /crm/v3/objects/contacts/search') return json(existing ? { total: 1, results: [contact] } : { total: 0, results: [] });
    if (route === 'POST /crm/v3/objects/contacts') return json({ id: '123' }, 201);
    if (route === 'GET /crm/v3/objects/contacts/123') return json(contact);
    if (route === 'GET /crm/v4/objects/contacts/123/associations/tickets') return json({ results: existing ? [{ toObjectId: 456 }] : [] });
    if (route === 'POST /crm/v3/objects/tickets/batch/read') return json({ status: 'COMPLETE', results: [{ id: '456', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1473318768' } }] });
    if (route === 'POST /crm/v3/objects/tickets') return json({ id: '456' }, 201);
    if (route === 'GET /crm/v3/objects/tickets/456') return json(ticket);
    if (route === 'GET /crm/v4/objects/tickets/456/associations/notes') return json({ results: notes.map(note => ({ toObjectId: Number(note.id) })) });
    if (route === 'POST /crm/v3/objects/notes/batch/read') return json({ status: 'COMPLETE', results: notes.filter(note => body.inputs.some(input => input.id === note.id)) });
    if (route === 'POST /crm/v3/objects/notes') return noteReply();
    throw new Error(`Unexpected HubSpot call ${route}`);
  };
  return { calls, fetchImpl };
}
async function ledger() { const db = new PGlite(); await db.exec(migration); return createRecruitIntakePostgresLedger(db); }
const options = async fetchImpl => ({ user, accessToken: 'synthetic-token', hmacSecret: secret, ledger: await ledger(), fetchImpl, now: clock });

test('a new attendee gets a contact, a Recruiting ticket with their office, and a sign-in note on the event day', async () => {
  const { calls, fetchImpl } = hubspot();
  const result = await importAttendee({ requestId, ...row }, await options(fetchImpl));
  assert.equal(result.status, 'added');
  assert.equal(result.ticketCreated, true);
  assert.equal(result.noteId, '789');
  assert.equal(result.recruit.hubspotUrl, 'https://app.hubspot.com/contacts/50894788/record/0-5/456');
  const created = calls.find(call => call.method === 'POST' && call.pathname === '/crm/v3/objects/tickets');
  assert.equal(created.body.properties.orientation_office, 'orlando');
  assert.equal(created.body.properties.source_type, 'FORM');
  assert.equal(created.body.properties.hs_pipeline_stage, '1473318768');
  assert.equal(created.body.properties.recruiting_path, 'genpop');
  const note = calls.find(call => call.method === 'POST' && call.pathname === '/crm/v3/objects/notes').body;
  assert.equal(note.properties.hs_timestamp, '2026-11-17T17:00:00.000Z');
  assert.match(note.properties.hs_note_body, /^<p><strong>Hiring event sign-in \(imported from a sign-in list\)<\/strong><\/p>/);
  assert.match(note.properties.hs_note_body, /<p><strong>Office:<\/strong> Orlando<\/p>/);
  assert.match(note.properties.hs_note_body, /Synthetic Editor/);
  assert.deepEqual(note.associations.map(item => [item.to.id, item.types[0].associationTypeId]), [['456', 228], ['123', 202]]);
});

test('someone already in HubSpot keeps their ticket; a second sign-in for the same day is not added', async () => {
  const sameDay = hubspot({ existing: true, notes: [signInNote('701', '2026-11-17T23:10:00Z')] });
  const skipped = await importAttendee({ requestId, ...row }, await options(sameDay.fetchImpl));
  assert.equal(skipped.status, 'already_recorded');
  assert.equal(skipped.ticketCreated, false);
  assert.equal(sameDay.calls.some(call => call.method === 'POST' && ['/crm/v3/objects/tickets', '/crm/v3/objects/contacts', '/crm/v3/objects/notes'].includes(call.pathname)), false);
  const otherDay = hubspot({ existing: true, notes: [signInNote('701', '2026-11-11T15:00:00Z')] });
  const added = await importAttendee({ requestId, ...row }, await options(otherDay.fetchImpl));
  assert.equal(added.status, 'added');
  assert.equal(added.ticketCreated, false);
  assert.equal(otherDay.calls.some(call => call.method === 'POST' && call.pathname === '/crm/v3/objects/tickets'), false);
});

test('an unconfirmed note keeps the recruit link and can be retried safely', async () => {
  const { fetchImpl } = hubspot({ noteReply: () => json({ message: 'busy' }, 503) });
  const first = await options(fetchImpl);
  await assert.rejects(importAttendee({ requestId, ...row }, first), error =>
    error.code === 'NOTE_UNCONFIRMED' && error.recruit?.id === '456' && /not add a second sign-in/.test(error.message));
  // Retrying the same row reuses the ledger entry, and finds the note if HubSpot did save it.
  const retry = hubspot({ existing: true, notes: [signInNote('790', '2026-11-17T17:00:00Z')] });
  const again = await importAttendee({ requestId, ...row }, { ...first, fetchImpl: retry.fetchImpl });
  assert.equal(again.status, 'already_recorded');
  assert.equal(again.recruit.id, '456');
  assert.equal(retry.calls.some(call => call.method === 'POST' && ['/crm/v3/objects/tickets', '/crm/v3/objects/contacts', '/crm/v3/objects/notes'].includes(call.pathname)), false);
  const rejected = hubspot({ noteReply: () => json({ message: 'bad' }, 400) });
  await assert.rejects(importAttendee({ requestId, ...row }, await options(rejected.fetchImpl)), { code: 'NOTE_REJECTED' });
});

test('the shared intake accepts only known extra ticket fields', async () => {
  const input = { requestId, firstName: 'Synthetic', lastName: 'Attendee', phone: '4075550123', email: '', recruitingPath: 'genpop' };
  for (const ticketProperties of [{ hs_pipeline_stage: '1416243218' }, { orientation_office: 'remote' }, { source_type: 'EMAIL' }, []]) {
    await assert.rejects(createRecruitIntake(input, { userId: 'u', accessToken: 't', hmacSecret: secret, ledger: { claim() {}, finish() {} }, ticketProperties }), { code: 'INTAKE_UNAVAILABLE' });
  }
});

test('the import API keeps sign-in, editor, write-access and origin checks', async () => {
  const origin = 'https://crm.example.invalid';
  const request = (headers = {}, body = JSON.stringify({ requestId, ...row })) => new Request(`${origin}/api/event-attendance/import`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body });
  let imports = 0;
  const base = { editorEmails: user.email, writesEnabled: 'true', intakeEnabled: 'true', hmacSecret: secret, vercel: '1', vercelEnv: 'production', ledger: { claim() {}, finish() {} }, allowedOrigin: origin, getUser: async () => user, importData: async (input, context) => { imports += 1; assert.equal(context.user, user); return { status: 'added', ticketCreated: true }; } };
  assert.equal((await handleAttendeeImportRequest(request(), { ...base, getUser: async () => null })).status, 401);
  assert.equal((await handleAttendeeImportRequest(request(), { ...base, editorEmails: 'someone@example.invalid' })).status, 403);
  assert.equal((await handleAttendeeImportRequest(request(), { ...base, intakeEnabled: 'false' })).status, 403);
  assert.equal((await handleAttendeeImportRequest(request(), { ...base, vercelEnv: 'preview' })).status, 403);
  assert.equal((await handleAttendeeImportRequest(request({ Origin: 'https://other.example.invalid' }), base)).status, 403);
  assert.equal((await handleAttendeeImportRequest(request({ 'Content-Type': 'text/plain' }), base)).status, 415);
  assert.equal((await handleAttendeeImportRequest(request({}, 'x'.repeat(5000)), base)).status, 413);
  assert.equal(imports, 0);
  const ok = await handleAttendeeImportRequest(request(), base);
  assert.equal(ok.status, 201);
  assert.match(ok.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(imports, 1);
  const invalid = await handleAttendeeImportRequest(request(), { ...base, importData: async input => importAttendee({ ...input, office: 'Remote' }, await options(hubspot().fetchImpl)) });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error.fieldErrors.office, /Orlando/);
});

test('the imported note text is escaped', () => {
  const html = importedSignInNote({ firstName: '<b>Syn</b>', lastName: 'A&B', phone: '+14075550123', email: '', office: 'miami', eventDate: '2026-11-17' }, { importedBy: 'Editor', importedAt: clock() });
  assert.match(html, /&lt;b&gt;Syn&lt;\/b&gt; A&amp;B/);
  assert.match(html, /<p><strong>Office:<\/strong> Miami<\/p>/);
  assert.match(html, /Tue, Nov 17, 2026/);
});
