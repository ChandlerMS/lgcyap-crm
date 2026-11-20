import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { SignInError, createHubSpotClient, recordSignIn, resetAccessCache } from '../lib/hubspot.mjs';
import { validateSignIn } from '../lib/validate.mjs';
import { fakeHubSpot, validForm } from './helpers.mjs';

const NOW = Date.UTC(2026, 10, 12, 23, 30);
const now = () => NOW;
const noSleep = async () => {};

async function input(overrides) {
  const result = await validateSignIn(validForm(overrides));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.value;
}

function client(hub) {
  return createHubSpotClient({ accessToken: 'test-token', fetchImpl: hub.fetchImpl, now, sleep: noSleep });
}

beforeEach(() => resetAccessCache());

test('a new person gets a Contact, a Hiring Event ticket, private license files and a note', async () => {
  const hub = fakeHubSpot();
  const result = await recordSignIn(client(hub), await input(), { now });
  assert.deepEqual(result, { contactId: '501', ticketId: '901', contactCreated: true, ticketCreated: true, attachments: 1 });

  const contact = hub.find('POST /crm/v3/objects/contacts')[0].body;
  assert.deepEqual(contact.properties, { firstname: 'Testy', lastname: 'McSample', email: 'testy.sample@example.invalid', phone: '+14075550142' });
  assert.equal('lifecyclestage' in contact.properties, false);

  const ticket = hub.find('POST /crm/v3/objects/tickets')[0].body;
  assert.equal(ticket.properties.hs_pipeline, '924992938');
  assert.equal(ticket.properties.hs_pipeline_stage, '1473318768');
  assert.equal(ticket.properties.recruiting_path, 'genpop');
  assert.equal(ticket.properties.subject, 'Recruiting: Testy McSample');
  assert.equal(ticket.properties.orientation_office, 'orlando');
  assert.equal(ticket.properties.intake_license_status, 'already_licensed');
  assert.equal(ticket.properties.already_licensed, 'true');
  assert.equal(ticket.properties.npn_number, '12345678');
  assert.equal(ticket.properties.has_recruit_contracted_before_transfer, 'No');
  assert.equal(ticket.properties.invited_by_name, 'Pat Example');
  assert.equal(ticket.properties.source_type, 'FORM');
  assert.match(ticket.properties.content, /Signed in from: Lobby security desk \(QR\)/);
  assert.match(ticket.properties.content, /How they heard about us: In-house referral: Pat Example/);
  assert.equal('licensing_branch' in ticket.properties, false);
  assert.deepEqual(ticket.associations, [{ to: { id: '501' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }] }]);

  const uploads = hub.find('POST /files/v3/files');
  assert.equal(uploads.length, 1);
  for (const upload of uploads) {
    const options = JSON.parse(upload.body.get('options'));
    assert.equal(options.access, 'PRIVATE');
    assert.equal(upload.body.get('folderPath'), '/Hiring Event Sign-Ins/Photo IDs');
    assert.doesNotMatch(upload.body.get('fileName'), /Testy|McSample|example/i);
    assert.equal(upload.body.get('file').type, 'image/jpeg');
  }

  const note = hub.find('POST /crm/v3/objects/notes')[0].body;
  assert.equal(note.properties.hs_attachment_ids, '7001');
  assert.equal(note.properties.hs_timestamp, new Date(NOW).toISOString());
  assert.match(note.properties.hs_note_body, /Hiring event sign-in/);
  assert.match(note.properties.hs_note_body, /\(407\) 555-0142/);
  assert.deepEqual(note.associations.map(a => [a.to.id, a.types[0].associationTypeId]), [['901', 228], ['501', 202]]);
});

test('unlicensed sign-ins record the unlicensed intake status without NPN fields', async () => {
  const hub = fakeHubSpot();
  await recordSignIn(client(hub), await input({ licenseStatus: 'unlicensed', heardAbout: 'job_posting', heardAboutDetail: 'indeed', referredBy: undefined }), { now });
  const ticket = hub.find('POST /crm/v3/objects/tickets')[0].body.properties;
  assert.equal(ticket.intake_license_status, 'unlicensed');
  assert.equal(ticket.already_licensed, 'false');
  assert.equal('npn_number' in ticket, false);
  assert.equal('has_recruit_contracted_before_transfer' in ticket, false);
  assert.equal('invited_by_name' in ticket, false);
  assert.equal(hub.find('POST /files/v3/files').length, 1);
  assert.equal(hub.find('POST /crm/v3/objects/notes')[0].body.properties.hs_attachment_ids, '7001');
});

test('an existing contact is never modified; the answers go on the ticket and note for staff', async () => {
  const hub = fakeHubSpot({
    'POST /crm/v3/objects/contacts/search': () => [200, { total: 1, results: [{ id: '777', properties: { email: 'testy.sample@example.invalid' } }] }],
    'GET /crm/v4/objects/contacts/777/associations/tickets': () => [200, { results: [] }],
  });
  const result = await recordSignIn(client(hub), await input(), { now });
  assert.equal(result.contactCreated, false);
  assert.equal(result.ticketCreated, true);
  assert.equal(hub.find('POST /crm/v3/objects/contacts').length, 0);
  assert.equal(hub.calls.filter(c => c.init.method === 'PATCH' || c.init.method === 'PUT' || c.init.method === 'DELETE').length, 0, 'no contact or other record is edited');
  assert.deepEqual(hub.find('POST /crm/v3/objects/contacts/search')[0].body.properties, ['email']);
  const ticket = hub.find('POST /crm/v3/objects/tickets')[0].body;
  assert.equal(ticket.properties.recruit_phone_number, '+14075550142');
  assert.equal(ticket.associations[0].to.id, '777');
  const note = hub.find('POST /crm/v3/objects/notes')[0].body.properties.hs_note_body;
  assert.match(note, /matched an existing contact, which was not changed/);
});

test('a new contact is labeled as created from the sign-in', async () => {
  const hub = fakeHubSpot();
  await recordSignIn(client(hub), await input(), { now });
  assert.match(hub.find('POST /crm/v3/objects/tickets')[0].body.properties.content, /Contact record: Created from this sign-in/);
});

test('a person with an open recruiting ticket gets a note on it instead of a second ticket', async () => {
  const hub = fakeHubSpot({
    'POST /crm/v3/objects/contacts/search': () => [200, { total: 1, results: [{ id: '777', properties: { firstname: 'A', lastname: 'B', phone: '+14075550142' } }] }],
    'GET /crm/v4/objects/contacts/777/associations/tickets': () => [200, { results: [{ toObjectId: 11 }, { toObjectId: 12 }, { toObjectId: 13 }] }],
    'POST /crm/v3/objects/tickets/batch/read': () => [200, { results: [
      { id: '11', properties: { hs_pipeline: '0', hs_pipeline_stage: '1' } },
      { id: '12', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1416243218' } },
      { id: '13', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1473318769' } },
    ] }],
  });
  const result = await recordSignIn(client(hub), await input(), { now });
  assert.equal(result.ticketCreated, false);
  assert.equal(result.ticketId, '13');
  assert.equal(hub.find('POST /crm/v3/objects/tickets').length, 0);
  assert.equal(hub.find('PATCH /crm/v3/objects/contacts/777').length, 0);
  const note = hub.find('POST /crm/v3/objects/notes')[0].body;
  assert.equal(note.associations[0].to.id, '13');
  assert.match(note.properties.hs_note_body, /already had an open recruiting ticket/);
});

test('closed recruiting tickets (Completed/Withdrawn) do not block a new ticket', async () => {
  const hub = fakeHubSpot({
    'POST /crm/v3/objects/contacts/search': () => [200, { total: 1, results: [{ id: '777', properties: { firstname: 'A', lastname: 'B', phone: 'x' } }] }],
    'GET /crm/v4/objects/contacts/777/associations/tickets': () => [200, { results: [{ toObjectId: 12 }] }],
    'POST /crm/v3/objects/tickets/batch/read': () => [200, { results: [{ id: '12', properties: { hs_pipeline: '924992938', hs_pipeline_stage: '1473318773' } }] }],
  });
  const result = await recordSignIn(client(hub), await input(), { now });
  assert.equal(result.ticketCreated, true);
});

test('a duplicate-email conflict on create reuses the existing contact', async () => {
  const hub = fakeHubSpot({
    'POST /crm/v3/objects/contacts': () => [409, { status: 'error', message: 'Contact already exists. Existing ID: 888', category: 'CONFLICT' }],
    'GET /crm/v4/objects/contacts/888/associations/tickets': () => [200, { results: [] }],
  });
  const result = await recordSignIn(client(hub), await input(), { now });
  assert.equal(result.contactId, '888');
  assert.equal(result.contactCreated, false);
});

test('the token must belong to the Legacy portal and carry every scope', async () => {
  for (const info of [
    { hubId: 1234, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write', 'files'] },
    { hubId: 50894788, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write'] },
  ]) {
    resetAccessCache();
    const hub = fakeHubSpot({ 'POST /oauth/v2/private-apps/get/access-token-info': () => [200, info] });
    await assert.rejects(recordSignIn(client(hub), await input(), { now }), error => error instanceof SignInError && error.code === 'HUBSPOT_ACCESS' && error.status === 503);
    assert.equal(hub.calls.length, 1, 'nothing is written after a failed access check');
  }
});

const CRM_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write'];

test('a service key with the granular files.write scope is accepted', async () => {
  const hub = fakeHubSpot({ 'POST /oauth/v2/private-apps/get/access-token-info': () => [200, { hubId: 50894788, scopes: [...CRM_SCOPES, 'files.write'] }] });
  const result = await recordSignIn(client(hub), await input(), { now });
  assert.equal(result.ticketCreated, true);
  assert.equal(hub.find('GET /account-info/v3/details').length, 0);
});

test('when the token lookup does not recognize the token, the portal is confirmed instead', async () => {
  for (const status of [400, 404]) {
    resetAccessCache();
    const hub = fakeHubSpot({
      'POST /oauth/v2/private-apps/get/access-token-info': () => [status, { message: 'not a private app token' }],
      'GET /account-info/v3/details': () => [200, { portalId: 50894788, timeZone: 'US/Eastern' }],
    });
    const result = await recordSignIn(client(hub), await input(), { now });
    assert.equal(result.ticketCreated, true, `status ${status}`);
    assert.equal(hub.find('GET /account-info/v3/details').length, 1);
  }
});

test('the portal fallback refuses another portal and writes nothing', async () => {
  const hub = fakeHubSpot({
    'POST /oauth/v2/private-apps/get/access-token-info': () => [404, {}],
    'GET /account-info/v3/details': () => [200, { portalId: 1234 }],
  });
  await assert.rejects(recordSignIn(client(hub), await input(), { now }), error => error.code === 'HUBSPOT_ACCESS');
  assert.deepEqual(hub.calls.map(c => c.key), ['POST /oauth/v2/private-apps/get/access-token-info', 'GET /account-info/v3/details']);
});

test('a rejected token fails closed without the portal fallback', async () => {
  for (const status of [401, 403]) {
    resetAccessCache();
    const hub = fakeHubSpot({ 'POST /oauth/v2/private-apps/get/access-token-info': () => [status, {}] });
    await assert.rejects(recordSignIn(client(hub), await input(), { now }), error => error.code === 'HUBSPOT_ACCESS' && error.status === 503);
    assert.equal(hub.calls.length, 1, `status ${status}`);
  }
});

test('a token with no file scope at all is refused', async () => {
  const hub = fakeHubSpot({ 'POST /oauth/v2/private-apps/get/access-token-info': () => [200, { hubId: 50894788, scopes: [...CRM_SCOPES, 'files.read'] }] });
  await assert.rejects(recordSignIn(client(hub), await input(), { now }), error => error.code === 'HUBSPOT_ACCESS');
  assert.equal(hub.calls.length, 1);
});

test('a 429 is retried once; a failed ticket create is not retried', async () => {
  let searches = 0;
  const hub = fakeHubSpot({
    'POST /crm/v3/objects/contacts/search': () => (searches++ === 0 ? [429, { message: 'slow down' }, { 'Retry-After': '1' }] : [200, { results: [] }]),
    'POST /crm/v3/objects/tickets': () => [500, { message: 'boom' }],
  });
  await assert.rejects(recordSignIn(client(hub), await input(), { now }), error => error.code === 'HUBSPOT_REJECTED' && error.phase === 'ticket_create');
  assert.equal(searches, 2);
  assert.equal(hub.find('POST /crm/v3/objects/tickets').length, 1);
  assert.equal(hub.find('POST /files/v3/files').length, 0);
});

test('typed answers are escaped in the note HTML', async () => {
  const hub = fakeHubSpot();
  await recordSignIn(client(hub), await input({ referredBy: 'Pat <b>Bold</b> & "Co"' }), { now });
  const html = hub.find('POST /crm/v3/objects/notes')[0].body.properties.hs_note_body;
  assert.match(html, /Pat &lt;b&gt;Bold&lt;\/b&gt; &amp; &quot;Co&quot;/);
  assert.doesNotMatch(html, /<b>Bold/);
});

test('the optional "how heard" property is written only when configured', async () => {
  const hub = fakeHubSpot();
  await recordSignIn(client(hub), await input({ heardAbout: 'social', heardAboutDetail: 'facebook', referredBy: undefined }), { now, heardAboutProperty: 'how_did_you_hear_about_us' });
  assert.equal(hub.find('POST /crm/v3/objects/tickets')[0].body.properties.how_did_you_hear_about_us, 'facebook');
});

test('the client sends the bearer token only to the fixed HubSpot host', async () => {
  const hub = fakeHubSpot();
  await recordSignIn(client(hub), await input(), { now });
  for (const call of hub.calls) {
    assert.equal(call.url.origin, 'https://api.hubapi.com');
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.headers.Authorization, 'Bearer test-token');
  }
});
