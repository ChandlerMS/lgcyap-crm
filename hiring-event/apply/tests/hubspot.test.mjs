import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateApplication } from '../public/rules.js';
import { createHubSpotClient, recordApplication, resetAccessCache } from '../lib/hubspot.mjs';
import { validateApplication } from '../lib/validate.mjs';
import { applicationForm, baseAnswers } from './fixtures.mjs';
import { fakeHubSpot } from './fake-hubspot.mjs';

const NOW = Date.UTC(2026, 10, 9, 22, 0, 0);

async function run(hub, answers = baseAnswers()) {
  resetAccessCache();
  const checked = await validateApplication(applicationForm({ answers }));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const client = createHubSpotClient({ accessToken: 'test-token', fetchImpl: hub.fetchImpl, now: () => NOW, sleep: async () => {} });
  return recordApplication(client, checked, evaluateApplication(checked.answers), { now: () => NOW });
}

test('a new applicant gets a contact, a ticket at Application, a private file and a note', async () => {
  const hub = fakeHubSpot();
  const result = await run(hub);
  assert.equal(result.action, 'created');
  assert.equal(result.contactCreated, true);

  const contact = hub.state.contacts[0];
  assert.deepEqual(contact.properties, { firstname: 'Testy', lastname: 'Q Applicant', email: 'testy.applicant@example.com', phone: '+14075550142', city: 'Orlando', state: 'FL', zip: '32801' });
  assert.ok(!('lifecyclestage' in contact.properties), 'never touches the sales lifecycle');

  const ticket = hub.state.tickets[0];
  assert.equal(ticket.properties.hs_pipeline, '924992938');
  assert.equal(ticket.properties.hs_pipeline_stage, '1473318769');
  assert.equal(ticket.properties.subject, 'Recruiting: Testy Q Applicant');
  assert.equal(ticket.properties.orientation_office, 'orlando');
  assert.equal(ticket.properties.intake_license_status, 'unlicensed');
  assert.equal(ticket.properties.already_licensed, 'false');
  assert.equal(ticket.properties.recruit_phone_number, '+14075550142');
  assert.ok(!('recruiting_path' in ticket.properties), 'path is left for staff at Application');
  assert.equal(ticket.associations[0].types[0].associationTypeId, 16);

  assert.equal(hub.state.files.length, 1);
  assert.equal(hub.state.files[0].options.access, 'PRIVATE');
  assert.equal(hub.state.files[0].folder, '/Agent Applications/Driver Licenses');

  const note = hub.state.notes[0];
  assert.equal(note.properties.hs_attachment_ids, hub.state.files[0].id);
  assert.deepEqual(note.associations.map(a => a.types[0].associationTypeId), [228, 202]);
  assert.match(note.properties.hs_note_body, /Meets all five/);
  assert.match(note.properties.hs_note_body, /Why does this role interest you\?/);
  assert.match(note.properties.hs_note_body, /Customer service\.<br>Looking to grow\./);
  assert.match(note.properties.hs_note_body, /this opens Part 2 below\)<\/strong><br>No<\/li>/, 'an unticked box reads No');
  assert.ok(hub.state.calls.every(c => c.auth === 'Bearer test-token'));
});

// The form is public and emails are not verified: nothing found by email may be changed.
const noChanges = hub => assert.deepEqual(hub.state.calls.filter(c => c.method === 'PATCH' || c.method === 'PUT' || c.method === 'DELETE'), []);

test('an existing contact is linked but never changed', async () => {
  const before = { email: 'testy.applicant@example.com', firstname: 'Tess', lastname: '', phone: '+13215550100' };
  const hub = fakeHubSpot({ contacts: [{ id: '501', properties: { ...before } }] });
  const result = await run(hub);
  assert.equal(result.contactCreated, false);
  assert.equal(result.contactId, '501');
  assert.deepEqual(hub.state.contacts[0].properties, before, 'blank fields stay blank, values stay as they were');
  noChanges(hub);
  const search = hub.state.calls.find(c => c.pathname === '/crm/v3/objects/contacts/search');
  assert.deepEqual(search.body.properties, ['email'], 'reads nothing but the match');
  assert.equal(hub.state.tickets[0].associations[0].to.id, '501', 'the new ticket is linked to the contact');
  assert.match(hub.state.notes[0].properties.hs_note_body, /matched an existing contact, which was not changed/);
});

test('an open ticket gets the note but keeps its stage and fields', async () => {
  for (const properties of [
    { hs_pipeline: '924992938', hs_pipeline_stage: '1473318768', recruiting_path: 'genpop', orientation_office: 'miami', recruit_email: '' },
    { hs_pipeline: '924992938', hs_pipeline_stage: '1473225368', recruiting_path: 'genpop' },
    { hs_pipeline: '924992938', hs_pipeline_stage: '1473318768', recruiting_path: 'mass_recruiting' },
  ]) {
    const hub = fakeHubSpot({ contacts: [{ id: '501', properties: { email: 'testy.applicant@example.com' } }], tickets: [{ id: '7002', contactId: '501', properties }] });
    const result = await run(hub);
    assert.equal(result.action, 'noted');
    assert.equal(result.ticketId, '7002');
    assert.equal(hub.state.tickets.length, 1, 'no second ticket');
    assert.deepEqual(hub.state.tickets[0].properties, properties, 'stage and fields unchanged');
    noChanges(hub);
    assert.equal(hub.state.notes[0].associations[0].to.id, '7002');
    if (properties.hs_pipeline_stage === '1473318768') assert.match(hub.state.notes[0].properties.hs_note_body, /confirm this is the same person, then move it to Application in the CRM/);
  }
});

test('closed tickets and other pipelines do not count as open', async () => {
  const hub = fakeHubSpot({
    contacts: [{ id: '501', properties: { email: 'testy.applicant@example.com' } }],
    tickets: [
      { id: '7003', contactId: '501', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1473318773' } },
      { id: '7004', contactId: '501', properties: { hs_pipeline: '0', hs_pipeline_stage: '1' } },
    ],
  });
  const result = await run(hub);
  assert.equal(result.action, 'created');
  assert.equal(hub.state.tickets.length, 3);
});

test('an applicant who fails a required item gets a contact and note but no ticket', async () => {
  const hub = fakeHubSpot();
  const result = await run(hub, baseAnswers({ workAuth: 'no' }));
  assert.equal(result.action, 'contact_only');
  assert.equal(hub.state.tickets.length, 0);
  const note = hub.state.notes[0];
  assert.deepEqual(note.associations.map(a => a.types[0].associationTypeId), [202]);
  assert.match(note.properties.hs_note_body, /Did not meet: authorization to work in the United States/);
});

test('a licensed applicant maps license fields and referral', async () => {
  const hub = fakeHubSpot();
  await run(hub, baseAnswers({ licenseStatus: 'Currently licensed in Florida', npn: '12345678', referredBy: 'Jordan Example', felony: 'yes', eligExplain: 'Explained privately.' }));
  const t = hub.state.tickets[0].properties;
  assert.equal(t.intake_license_status, 'already_licensed');
  assert.equal(t.already_licensed, 'true');
  assert.equal(t.npn_number, '12345678');
  assert.equal(t.invited_by_name, 'Jordan Example');
  assert.match(hub.state.notes[0].properties.hs_note_body, /PART 2/);
  assert.match(hub.state.notes[0].properties.hs_note_body, /Needs a private conversation:<\/strong> Have you ever been convicted/);
});

test('answers are HTML-escaped in the note', async () => {
  const hub = fakeHubSpot();
  await run(hub, baseAnswers({ whyRole: '<script>alert(1)</script> & more' }));
  const body = hub.state.notes[0].properties.hs_note_body;
  assert.ok(!body.includes('<script>'));
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/);
});

const CRM_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write'];

test('a token for another portal or missing scopes writes nothing', async () => {
  for (const options of [{ hubId: 123 }, { scopes: ['crm.objects.contacts.read'] }, { scopes: CRM_SCOPES }, { scopes: [...CRM_SCOPES, 'files.read'] }]) {
    const hub = fakeHubSpot(options);
    await assert.rejects(run(hub), error => error.code === 'HUBSPOT_ACCESS');
    assert.equal(hub.state.calls.length, 1);
  }
});

test('a service key with files.write is accepted', async () => {
  const hub = fakeHubSpot({ scopes: [...CRM_SCOPES, 'files.write'] });
  const result = await run(hub);
  assert.equal(result.action, 'created');
  assert.equal(hub.state.files.length, 1);
});

test('when token info is unavailable, the portal is confirmed by reading the Recruiting pipeline', async () => {
  const hub = fakeHubSpot({ tokenInfoStatus: 404 });
  const result = await run(hub);
  assert.equal(result.action, 'created');
  assert.ok(hub.state.calls.some(c => c.pathname === '/crm/v3/pipelines/tickets/924992938'));

  for (const pipelineStatus of [401, 403, 404]) {
    const other = fakeHubSpot({ tokenInfoStatus: 400, pipelineStatus });
    await assert.rejects(run(other), error => error.code === 'HUBSPOT_ACCESS' && error.phase === 'access_pipeline' && error.upstreamStatus === pipelineStatus && error.tokenInfoStatus === 400);
    assert.equal(other.state.calls.length, 2, 'nothing written without a confirmed portal');
  }

  const denied = fakeHubSpot({ tokenInfoStatus: 401 });
  await assert.rejects(run(denied), error => error.code === 'HUBSPOT_ACCESS');
  assert.equal(denied.state.calls.length, 1, 'a rejected token does not fall back');
});

test('a HubSpot failure surfaces a safe code', async () => {
  const hub = fakeHubSpot({ failOn: { method: 'POST', path: '/crm/v3/objects/tickets', status: 400 } });
  await assert.rejects(run(hub), error => error.code === 'HUBSPOT_REJECTED' && error.phase === 'ticket_create' && !/Testy/.test(error.message));
});
