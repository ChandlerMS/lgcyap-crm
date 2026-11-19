import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlText, parseApplicationNote, readApplications, summarizeApplications } from '../lib/applications.mjs';

// Synthetic notes in the apply site's format. No real applicant data.
const li = (label, value) => `<li><strong>${label}</strong><br>${value}</li>`;
const note = ({ required = 'Meets all required items', review = 'Nothing flagged', outcome = 'Created this recruiting ticket at Application', contact = '', photo = 'Attached to this note (private file)', photoLabel = 'Photo ID', name = 'Pat Example QA', office = 'Miami' } = {}) =>
  `<p><strong>Agent application (v3.1) submitted online, Nov 18, 2026, 7:00 PM ET</strong></p>`
  + `<p><strong>Required items:</strong> ${required}</p><p><strong>Needs a private conversation:</strong> ${review}</p><p><strong>In HubSpot:</strong> ${outcome}</p>`
  + (contact ? `<p><strong>Contact:</strong> ${contact}</p>` : '') + (photo ? `<p><strong>${photoLabel}:</strong> ${photo}</p>` : '')
  + `<p><strong>YOUR INFORMATION</strong></p><ul>${li('Full legal name', name)}${li('Preferred name', 'Not answered')}${li('Email address', 'pat.qa@example.invalid')}${li('Mobile phone', '(555) 010-0199')}${li('City', 'Doral')}${li('State', 'Florida')}${li('ZIP', '33178')}${li('Which office are you applying for?', office)}</ul>`
  + `<p><strong>INSURANCE LICENSE</strong></p><ul>${li('Which best describes you today?', 'Florida 2-15')}</ul>`
  + `<p><strong>TELL US ABOUT YOU</strong></p><ul>${li('Why does this role interest you?', 'Growth &amp; &quot;mentorship&quot;<br>Line two')}</ul>`
  + `<p><strong>APPLICANT CERTIFICATION</strong></p><ul>${li('I certify that the information in this application is true and complete. I understand…', 'Yes')}${li('Type your full name as your signature', name)}</ul>`;

test('an application note becomes its answers by section, with the opening details read', () => {
  const parsed = parseApplicationNote(note());
  assert.equal(parsed.name, 'Pat Example QA');
  assert.equal(parsed.preferredName, '', 'Not answered reads as blank');
  assert.equal(parsed.office, 'Miami'); assert.equal(parsed.officeKey, 'miami');
  assert.equal(parsed.license, 'Florida 2-15');
  assert.equal(parsed.requirementsMet, true); assert.deepEqual(parsed.missed, []); assert.deepEqual(parsed.flags, []);
  assert.equal(parsed.outcome, 'new-ticket'); assert.equal(parsed.photoId, true); assert.equal(parsed.existingContact, false);
  assert.deepEqual(parsed.sections.map(section => section.title), ['Your information', 'Insurance license', 'Tell us about you', 'Applicant certification']);
  assert.equal(parsed.sections[2].rows[0].value, 'Growth & "mentorship"\nLine two');
  assert.equal(parsed.sections[3].rows[0].label, 'Certifies the application is true and complete');
  assert.equal(parseApplicationNote('<p><strong>Hiring event sign-in</strong></p>'), null);
  assert.equal(htmlText('A&nbsp;&#39;B&#x27;<br/>C &unknown;'), "A 'B'\nC &unknown;");
});

test('missed items, private-conversation flags, outcomes and older photo labels are read', () => {
  const parsed = parseApplicationNote(note({ required: 'Did not meet: Is at least 18; Can work the office hours', review: 'Have you ever been convicted? | Do you have any charges pending?', outcome: 'No recruiting ticket: a required item was not met', contact: 'The email matched an existing contact, which was not changed.', photoLabel: "Driver's license" }));
  assert.equal(parsed.requirementsMet, false);
  assert.deepEqual(parsed.missed, ['Is at least 18', 'Can work the office hours']);
  assert.equal(parsed.flags.length, 2);
  assert.equal(parsed.outcome, 'contact-only'); assert.equal(parsed.existingContact, true); assert.equal(parsed.photoId, true);
  assert.equal(parseApplicationNote(note({ outcome: 'Added to this open recruiting ticket, which is at Hiring Event.', photo: '' })).outcome, 'existing-ticket');
  assert.equal(parseApplicationNote(note({ photo: '' })).photoId, false);
});

test('applications are listed newest first with their ticket as it is now, and counted', () => {
  const notes = [
    { id: '11', properties: { hs_note_body: note({ name: 'Older QA' }), hs_timestamp: '2026-11-17T15:00:00Z' } },
    { id: '12', properties: { hs_note_body: note({ name: 'Newer QA', review: 'One question', outcome: 'Added to this open recruiting ticket, which is at Hiring Event.' }), hs_timestamp: '2026-11-18T15:00:00Z' } },
    { id: '13', properties: { hs_note_body: note({ name: 'Not a fit QA', required: 'Did not meet: X', outcome: 'No recruiting ticket', photo: '' }), hs_timestamp: '2026-11-18T16:00:00Z' } },
    { id: '14', properties: { hs_note_body: '<p><strong>Hiring event sign-in</strong></p>', hs_timestamp: '2026-11-18T16:00:00Z' } },
  ];
  const report = summarizeApplications({
    notes, fetchedAt: '2026-11-19T00:00:00Z',
    noteTickets: new Map([['11', ['900']], ['12', ['901', '999']], ['13', []]]),
    noteContacts: new Map([['11', ['500']], ['12', ['501']], ['13', ['502']]]),
    tickets: new Map([['900', { pipeline: '924992938', stageId: '1473318769' }], ['901', { pipeline: '924992938', stageId: '1473318768' }], ['999', { pipeline: 'other', stageId: '1' }]]),
  });
  assert.deepEqual(report.applications.map(item => item.name), ['Not a fit QA', 'Newer QA', 'Older QA']);
  assert.deepEqual(report.applications.map(item => item.ticket?.stage ?? null), [null, 'Hiring Event', 'Application']);
  assert.equal(report.applications[1].waitingAtHiringEvent, true);
  assert.equal(report.applications[0].contact.url, 'https://app.hubspot.com/contacts/50894788/record/0-1/502');
  assert.deepEqual(report.summary, { total: 3, met: 2, notMet: 1, flagged: 1, waitingAtHiringEvent: 1, photoId: 2 });
});

test('the read searches only form notes, then links tickets and contacts', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    calls.push(path);
    const json = value => ({ ok: true, status: 200, headers: new Headers(), body: new Response(JSON.stringify(value)).body });
    if (path === '/crm/v3/objects/notes/search') {
      assert.deepEqual(body.filterGroups[0].filters.map(filter => filter.propertyName), ['hs_object_source_label', 'hs_createdate', 'hs_note_body']);
      return json({ total: 1, results: [{ id: '21', properties: { hs_note_body: note(), hs_timestamp: '2026-11-18T15:00:00Z' } }] });
    }
    if (path === '/crm/v4/associations/notes/tickets/batch/read') return json({ results: [{ from: { id: '21' }, to: [{ toObjectId: 77 }] }] });
    if (path === '/crm/v4/associations/notes/contacts/batch/read') return json({ results: [{ from: { id: '21' }, to: [{ toObjectId: 55 }] }] });
    if (path === '/crm/v3/objects/tickets/batch/read') return json({ results: [{ id: '77', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1473318769' } }] });
    throw new Error(`unexpected ${path}`);
  };
  const report = await readApplications({ accessToken: 'synthetic-token', fetchImpl, now: () => Date.parse('2026-11-19T00:00:00Z') });
  assert.equal(report.applications[0].ticket.id, '77');
  assert.equal(report.applications[0].contact.id, '55');
  assert.deepEqual(calls, ['/crm/v3/objects/notes/search', '/crm/v4/associations/notes/tickets/batch/read', '/crm/v4/associations/notes/contacts/batch/read', '/crm/v3/objects/tickets/batch/read']);
  await assert.rejects(readApplications({ accessToken: '' }), /not been configured/);
});
