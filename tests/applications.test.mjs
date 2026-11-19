import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlText, parseApplicationNote, readApplications, summarizeApplications } from '../lib/applications.mjs';
import { eventReviewHtml } from '../lib/event-review.mjs';

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
    { id: '11', properties: { hs_note_body: note({ name: 'Older QA' }), hs_timestamp: '2026-11-17T15:00:00Z', hs_attachment_ids: '801' } },
    { id: '12', properties: { hs_note_body: note({ name: 'Newer QA', review: 'One question', outcome: 'Added to this open recruiting ticket, which is at Hiring Event.' }), hs_timestamp: '2026-11-18T15:00:00Z', hs_attachment_ids: '802' } },
    { id: '13', properties: { hs_note_body: note({ name: 'Not a fit QA', required: 'Did not meet: X', outcome: 'No recruiting ticket', photo: '' }), hs_timestamp: '2026-11-18T16:00:00Z' } },
    { id: '14', properties: { hs_note_body: '<p><strong>Hiring event sign-in</strong></p>', hs_timestamp: '2026-11-18T16:00:00Z' } },
  ];
  // Sign-in photo notes: 31 is the same person as application 13 by contact, 32 the same as application 11 by ticket,
  // 33 is someone else, and 34 is not a sign-in note.
  const signIn = (id, attachments, at = '2026-11-17T22:00:00Z', body = '<p><strong>Hiring event sign-in</strong></p>') => ({ id, properties: { hs_note_body: body, hs_timestamp: at, hs_attachment_ids: attachments } });
  const photoNotes = [signIn('31', '901;902'), signIn('32', '903', '2026-11-16T22:00:00Z'), signIn('33', '904'), signIn('34', '905', undefined, '<p>Call notes</p>')];
  const report = summarizeApplications({
    notes, fetchedAt: '2026-11-19T00:00:00Z', photoNotes,
    noteTickets: new Map([['11', ['900']], ['12', ['901', '999']], ['13', []], ['31', []], ['32', ['900']], ['33', ['950']], ['34', []]]),
    noteContacts: new Map([['11', ['500']], ['12', ['501']], ['13', ['502']], ['31', ['502']], ['32', ['599']], ['33', ['598']], ['34', ['502']]]),
    tickets: new Map([['900', { pipeline: '924992938', stageId: '1473318769' }], ['901', { pipeline: '924992938', stageId: '1473318768' }], ['999', { pipeline: 'other', stageId: '1' }]]),
  });
  assert.deepEqual(report.applications.map(item => item.name), ['Not a fit QA', 'Newer QA', 'Older QA']);
  assert.deepEqual(report.applications.map(item => item.ticket?.stage ?? null), [null, 'Hiring Event', 'Application']);
  assert.equal(report.applications[1].waitingAtHiringEvent, true);
  assert.equal(report.applications[0].contact.url, 'https://app.hubspot.com/contacts/50894788/record/0-1/502');
  assert.deepEqual(report.summary, { total: 3, met: 2, notMet: 1, flagged: 1, waitingAtHiringEvent: 1, photoId: 3 });
  // Each applicant's own photo first, then any from signing in at an event; front and back count as two files.
  assert.deepEqual(report.applications.map(item => item.photos.map(photo => [photo.noteId, photo.source, photo.files])), [
    [['31', 'sign-in', 2]], [['12', 'application', 1]], [['11', 'application', 1], ['32', 'sign-in', 1]],
  ]);
});

test('the read searches only form notes, then links tickets and contacts', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    calls.push(path);
    const json = value => ({ ok: true, status: 200, headers: new Headers(), body: new Response(JSON.stringify(value)).body });
    if (path === '/crm/v3/objects/notes/search') {
      const filters = body.filterGroups[0].filters.map(filter => filter.propertyName);
      assert.ok(body.properties.includes('hs_attachment_ids'));
      if (filters.includes('hs_attachment_ids')) {
        assert.deepEqual(filters, ['hs_object_source_label', 'hs_createdate', 'hs_attachment_ids', 'hs_note_body']);
        return json({ total: 1, results: [{ id: '31', properties: { hs_note_body: '<p><strong>Hiring event sign-in</strong></p>', hs_timestamp: '2026-11-17T22:00:00Z', hs_attachment_ids: '901' } }] });
      }
      assert.deepEqual(filters, ['hs_object_source_label', 'hs_createdate', 'hs_note_body']);
      return json({ total: 1, results: [{ id: '21', properties: { hs_note_body: note(), hs_timestamp: '2026-11-18T15:00:00Z', hs_attachment_ids: '900' } }] });
    }
    if (path === '/crm/v4/associations/notes/tickets/batch/read') {
      assert.deepEqual(body.inputs.map(input => input.id), ['21', '31']);
      return json({ results: [{ from: { id: '21' }, to: [{ toObjectId: 77 }] }, { from: { id: '31' }, to: [{ toObjectId: 77 }] }] });
    }
    if (path === '/crm/v4/associations/notes/contacts/batch/read') return json({ results: [{ from: { id: '21' }, to: [{ toObjectId: 55 }] }, { from: { id: '31' }, to: [{ toObjectId: 55 }] }] });
    if (path === '/crm/v3/objects/tickets/batch/read') assert.deepEqual(body.inputs.map(input => input.id), ['77']);
    if (path === '/crm/v3/objects/tickets/batch/read') return json({ results: [{ id: '77', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1473318769' } }] });
    throw new Error(`unexpected ${path}`);
  };
  const report = await readApplications({ accessToken: 'synthetic-token', fetchImpl, now: () => Date.parse('2026-11-19T00:00:00Z') });
  assert.equal(report.applications[0].ticket.id, '77');
  assert.equal(report.applications[0].contact.id, '55');
  assert.deepEqual(report.applications[0].photos.map(photo => [photo.noteId, photo.source]), [['21', 'application'], ['31', 'sign-in']]);
  assert.deepEqual(calls, ['/crm/v3/objects/notes/search', '/crm/v3/objects/notes/search', '/crm/v4/associations/notes/tickets/batch/read', '/crm/v4/associations/notes/contacts/batch/read', '/crm/v3/objects/tickets/batch/read']);
  await assert.rejects(readApplications({ accessToken: '' }), /not been configured/);
});

test('asked for reviews, the read adds each recruiting ticket\'s latest Approved or Denied decision', async () => {
  const secret = 'applications-review-test-secret-32-chars';
  const decision = (id, ticketId, status, at) => ({ id, properties: { hs_note_body: eventReviewHtml({ ticketId, status, requestId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, reviewedAt: new Date(at).toISOString(), secret }), hs_timestamp: at } });
  // 77 was approved and then denied; 78 is in another pipeline, so its decision is left out.
  const decisions = [decision('41', '77', 'approved', '2026-11-18T16:00:00Z'), decision('42', '77', 'denied', '2026-11-18T17:00:00Z'), decision('43', '78', 'approved', '2026-11-18T17:00:00Z')];
  const links = new Map([['21', ['77']], ['22', ['78']], ['41', ['77']], ['42', ['77']], ['43', ['78']]]);
  let reviewsFail = false;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    const json = value => new Response(JSON.stringify(value));
    if (path === '/crm/v3/objects/notes/search') {
      const token = body.filterGroups[0].filters.find(filter => filter.propertyName === 'hs_note_body' && filter.operator === 'CONTAINS_TOKEN')?.value;
      if (token === 'LGCYEventReview') return reviewsFail ? new Response('{}', { status: 500 }) : json({ total: decisions.length, results: decisions });
      if (token === 'submitted') return json({ total: 2, results: [{ id: '21', properties: { hs_note_body: note(), hs_timestamp: '2026-11-18T15:00:00Z' } }, { id: '22', properties: { hs_note_body: note({ name: 'Other QA' }), hs_timestamp: '2026-11-18T15:30:00Z' } }] });
      return json({ total: 0, results: [] });
    }
    if (path === '/crm/v4/associations/notes/tickets/batch/read') return json({ status: 'COMPLETE', results: body.inputs.map(({ id }) => ({ from: { id }, to: (links.get(id) ?? []).map(ticket => ({ toObjectId: Number(ticket) })) })) });
    if (path === '/crm/v4/associations/notes/contacts/batch/read') return json({ results: [] });
    if (path === '/crm/v3/objects/tickets/batch/read') return json({ results: body.inputs.map(({ id }) => ({ id, properties: { hs_pipeline: id === '77' ? '924992938' : 'other', hs_pipeline_stage: '1473318769' } })) });
    throw new Error(`unexpected ${path}`);
  };
  const now = () => Date.parse('2026-11-19T00:00:00Z');
  const report = await readApplications({ accessToken: 'synthetic-token', fetchImpl, now, includeReviews: true, reviewSecrets: [secret] });
  assert.equal(report.reviews['77'].status, 'denied');
  assert.equal(report.reviews['77'].noteId, '42');
  assert.equal(report.reviews['78'], undefined);
  assert.equal(report.reviewComplete, true);
  assert.equal(report.summary.total, 2, 'decision notes are not applications');
  // Without the request, the read stays as it was.
  assert.equal((await readApplications({ accessToken: 'synthetic-token', fetchImpl, now })).reviews, undefined);
  // A failed decision read still returns the applications.
  reviewsFail = true;
  const failed = await readApplications({ accessToken: 'synthetic-token', fetchImpl, now, includeReviews: true, reviewSecrets: [secret] });
  assert.equal(failed.applications.length, 2);
  assert.deepEqual(failed.reviews, {});
  assert.equal(failed.reviewComplete, false);
  assert.match(failed.reviewNotice, /applications are still shown/);
});
