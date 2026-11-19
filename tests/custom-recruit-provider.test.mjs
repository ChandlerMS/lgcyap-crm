import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomRecruitProvider } from '../lib/custom-recruit-provider.mjs';
import { APPROVED_RECRUIT_PROPERTIES, CUSTOM_RECRUIT_OBJECT as OBJECT, CUSTOM_RECRUIT_PIPELINES, SYNC_FIELDS, createRecruitProperties } from '../lib/custom-recruit-model.mjs';
import { PIPELINE_ID, stageIdForKey } from '../lib/recruiting-config.mjs';

const scopes = ['crm.objects.contacts.read', 'crm.objects.tickets.read', 'crm.objects.tickets.write', 'crm.objects.custom.read', 'crm.objects.custom.write'];
const blankSync = Object.fromEntries(SYNC_FIELDS.map(name => [name, null]));
const customRecruit = { id: '301', properties: { ...blankSync, hs_pipeline: CUSTOM_RECRUIT_PIPELINES.recruiters.id, hs_pipeline_stage: CUSTOM_RECRUIT_PIPELINES.recruiters.stages.application, recruiting_path: 'recruiters' } };
const ticket = { id: '101', properties: { ...blankSync, hs_pipeline: PIPELINE_ID, hs_pipeline_stage: stageIdForKey('application'), recruiting_path: 'mass_recruiting', recruit_name: 'Synthetic Person', unrequested_secret: 'must not copy' } };
const person = { id: '201', properties: { firstname: 'Synthetic', lastname: 'Person', email: 'synthetic@example.invalid', phone: '5550100' } };
function fake(options = {}) {
  const calls = [], definitions = new Map((options.existing ?? APPROVED_RECRUIT_PROPERTIES).map(p => [p.name, structuredClone(p)]));
  const nativeRecruit = structuredClone(options.nativeRecruit ?? customRecruit);
  const sourceTicket = options.ticket ?? ticket, sourceContact = options.person ?? person;
  let tickets = options.tickets ?? ['101'];
  const fetchImpl = async (url, init) => {
    const u = new URL(url), path = u.pathname, method = init.method, body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body, search: u.search });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
    const readReply = data => {
      const properties = { ...Object.fromEntries((u.searchParams.get('properties') ?? '').split(',').filter(Boolean).map(name => [name, null])), ...data.properties };
      if (options.omitField && (options.omitFrom === 'keyed' ? u.searchParams.has('idProperty') : options.omitFrom === 'ticket' ? path.includes('/objects/tickets/') : options.omitFrom === 'recruit' ? path.includes(`/objects/${OBJECT}/`) : false)) delete properties[options.omitField];
      return reply({ ...data, properties });
    };
    if (path === '/oauth/v2/private-apps/get/access-token-info') return reply({ hubId: '50894788', appId: '59264745', scopes, ...options.identity });
    if (path.startsWith('/crm/v3/properties/')) {
      if (options.schemaDenied) return reply({}, 403);
      const name = path.split('/')[5];
      if (name === 'recruit_name') return reply({ groupName: 'recruits_information' });
      if (method === 'POST') { definitions.set(body.name, body); return reply(body); }
      return definitions.has(name) ? reply(definitions.get(name)) : reply({}, 404);
    }
    if (path.startsWith('/crm/v3/pipelines/')) return reply({ stages: Object.values(Object.values(CUSTOM_RECRUIT_PIPELINES).find(p => path.endsWith(p.id)).stages).map(id => ({ id })) });
    if (path.endsWith('/labels')) return reply({ results: [{ label: null, category: 'USER_DEFINED', typeId: 9876 }] });
    if (path.includes('/associations/')) {
      if (method === 'PUT') return reply({});
      const to = path.split('/').at(-1), from = path.split('/')[4];
      const ids = from === 'notes' ? ['201'] : from === 'tickets' ? ['201'] : from === OBJECT ? options.customContacts ?? ['201'] : to === 'tickets' ? tickets : options.recruits ?? [];
      return reply({ results: ids.map(toObjectId => ({ toObjectId })) });
    }
    if (path === '/crm/v3/objects/tickets' && method === 'POST') {
      if (options.timeout) throw new Error('synthetic transport timeout');
      tickets = ['102']; return reply({ id: '102', properties: body.properties });
    }
    if (path === `/crm/v3/objects/${OBJECT}` && method === 'POST') return reply({ id: '301', properties: body.properties });
    if (path.startsWith('/crm/v3/objects/tickets/')) return readReply({ ...sourceTicket, id: path.split('/').at(-1) });
    if (path.startsWith('/crm/v3/objects/contacts/')) return readReply(sourceContact);
    if (path.startsWith(`/crm/v3/objects/${OBJECT}/`)) {
      if (u.searchParams.has('idProperty')) return options.keyed ? readReply(options.keyed) : reply({}, 404);
      if (method === 'PATCH' && !options.ignorePatch) Object.assign(nativeRecruit.properties, body.properties);
      return readReply({ ...nativeRecruit, id: path.split('/').at(-1) });
    }
    throw new Error(`Unexpected fake route ${method} ${path}`);
  };
  return { calls, definitions, provider: createCustomRecruitProvider({ accessToken: 'synthetic-token', fetchImpl }), writes: () => calls.filter(c => ['PATCH', 'PUT', 'POST'].includes(c.method) && c.path !== '/oauth/v2/private-apps/get/access-token-info') };
}
const store = () => { const rows = new Map(); return { rows, getIntake: async key => rows.get(key), putIntake: async (key, value) => rows.set(key, value) }; };
const application = { id: '401', contact: { id: '201' }, officeKey: 'tampa', name: 'Synthetic Person' };

for (const [label, identity] of [['wrong portal', { hubId: '999' }], ['wrong app', { appId: '999' }], ['missing scope', { scopes: scopes.slice(1) }]]) {
  test(`setup rejects ${label} before schema access or writes`, async () => {
    const f = fake({ identity });
    await assert.rejects(f.provider.verifyAndSetup(), { code: 'wrong_credentials' });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.writes(), []);
  });
}
test('setup creates exactly the fifteen approved missing properties in the existing group', async () => {
  const f = fake({ existing: [] }); await f.provider.verifyAndSetup();
  const writes = f.writes(); assert.equal(writes.length, 15);
  assert.deepEqual(writes.map(c => c.body.name), APPROVED_RECRUIT_PROPERTIES.map(p => p.name));
  for (const call of writes) {
    const expected = APPROVED_RECRUIT_PROPERTIES.find(p => p.name === call.body.name);
    assert.deepEqual(call.body, { ...expected, groupName: 'recruits_information', description: 'Synchronized with the Legacy recruiting app. Blank values remain unknown.' });
  }
});
test('setup preserves all existing definitions including user labels and extra options', async () => {
  const existing = structuredClone(APPROVED_RECRUIT_PROPERTIES); existing[0].label = 'Existing label'; existing[0].options.push({ value: 'extra', label: 'Existing option' });
  const f = fake({ existing }); await f.provider.verifyAndSetup(); assert.deepEqual(f.writes(), []); assert.deepEqual(f.definitions.get(existing[0].name), existing[0]);
});
for (const [label, mutate] of [['type', p => { p.type = 'string'; }], ['option', p => { p.options.pop(); }], ['fieldType', p => { p.fieldType = 'checkbox'; }]]) {
  test(`setup blocks existing ${label} mismatch without rewriting it`, async () => {
    const existing = structuredClone(APPROVED_RECRUIT_PROPERTIES); mutate(existing[0]); const f = fake({ existing });
    await assert.rejects(f.provider.verifyAndSetup(), { code: 'schema_mismatch' }); assert.deepEqual(f.writes(), []);
  });
}
test('setup rejects a nonunique existing CRM ticket key', async () => {
  const existing = structuredClone(APPROVED_RECRUIT_PROPERTIES); existing.at(-1).hasUniqueValue = false; const f = fake({ existing });
  await assert.rejects(f.provider.verifyAndSetup(), { code: 'schema_mismatch' }); assert.deepEqual(f.writes(), []);
});
test('schema permission failure blocks setup before object creation', async () => {
  const f = fake({ schemaDenied: true }); await assert.rejects(f.provider.verifyAndSetup(), { code: 'schema_permission' }); assert.deepEqual(f.writes(), []);
});
test('unique ticket/contact pair creates mapped recruit using discovered native association and exact properties', async () => {
  const f = fake(); const pair = await f.provider.pair('101'); assert.equal(pair.contactId, '201'); assert.equal(pair.recruit, null);
  const properties = createRecruitProperties(pair.ticket.properties, '101'); await f.provider.createRecruit('101', pair.contactId, properties);
  const writes = f.writes(); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { properties, associations: [{ to: { id: '201' }, types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 9876 }] }] });
  assert.deepEqual(Object.keys(properties).sort(), ['crm_ticket_id', 'hs_pipeline', 'hs_pipeline_stage', 'recruit_name', 'recruiting_path'].sort());
  assert.equal(properties.crm_ticket_id, '101'); assert.ok(f.calls.some(c => c.path === `/crm/v4/associations/${OBJECT}/contacts/labels`));
});
for (const options of [{ recruits: ['301', '302'] }, { recruits: ['301'], customContacts: ['202'] }]) {
  test(`conflicting recruit association is read-only: ${JSON.stringify(options)}`, async () => {
    const f = fake(options); await assert.rejects(f.provider.pair('101')); assert.deepEqual(f.writes(), []);
  });
}
test('application reuses existing ticket and links the original note', async () => {
  const f = fake(); assert.equal(await f.provider.applicationTicket(application, store()), '101');
  assert.deepEqual(f.writes().map(c => [c.method, c.path]), [['PUT', '/crm/v4/objects/notes/401/associations/default/tickets/101']]);
});
test('application creates one shadow ticket and reuses it on retry', async () => {
  const f = fake({ tickets: [] }), ledger = store();
  assert.equal(await f.provider.applicationTicket(application, ledger), '102'); assert.equal(await f.provider.applicationTicket(application, ledger), '102');
  const creates = f.writes().filter(c => c.method === 'POST'); assert.equal(creates.length, 1);
  assert.equal(creates[0].body.properties.hs_pipeline_stage, stageIdForKey('application')); assert.equal(creates[0].body.properties.recruiting_path, 'mass_recruiting');
  assert.equal(creates[0].body.properties.hs_pipeline, PIPELINE_ID); assert.equal(creates[0].body.properties.source_type, 'FORM');
  assert.equal(creates[0].body.properties.orientation_office, 'tampa'); assert.equal(ledger.rows.get('201').status, 'confirmed');
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.path.includes('/notes')).length, 0);
});
test('durable pending intake blocks another ticket POST after ambiguous timeout', async () => {
  const f = fake({ tickets: [], timeout: true }), ledger = store();
  await assert.rejects(f.provider.applicationTicket(application, ledger), { code: 'unavailable' });
  assert.deepEqual(ledger.rows.get('201'), { status: 'pending', sourceId: '401' });
  await assert.rejects(f.provider.applicationTicket(application, ledger), { code: 'intake_uncertain' });
  assert.equal(f.writes().filter(c => c.method === 'POST').length, 1);
});
test('native recruit shadow ticket uses canonical ticket stage and path', async () => {
  const recruit = { id: '301', properties: { ...blankSync, recruit_name: 'Synthetic Person', hs_pipeline: CUSTOM_RECRUIT_PIPELINES.referrals.id, hs_pipeline_stage: CUSTOM_RECRUIT_PIPELINES.referrals.stages['phone-interview'], recruiting_path: 'referrals' } };
  const f = fake({ tickets: [], nativeRecruit: recruit }), ledger = store();
  assert.equal(await f.provider.nativeTicket(recruit, ledger), '102');
  const body = f.writes().find(c => c.method === 'POST').body;
  assert.equal(body.properties.hs_pipeline, PIPELINE_ID); assert.equal(body.properties.hs_pipeline_stage, stageIdForKey('phone-interview')); assert.equal(body.properties.recruiting_path, 'genpop');
  assert.deepEqual(body.associations[0].types, [{ associationCategory: 'USER_DEFINED', associationTypeId: 9876 }]);
});

for (const omitFrom of ['ticket', 'recruit', 'keyed']) {
  test(`missing shared property in ${omitFrom} read rejects before writes`, async () => {
    const f = fake({ omitFrom, omitField: 'orientation_registered', ...(omitFrom === 'keyed' ? { keyed: customRecruit } : {}) });
    await assert.rejects(omitFrom === 'ticket' ? f.provider.readTicket('101') : omitFrom === 'recruit' ? f.provider.readRecruit('301') : f.provider.pair('101'));
    assert.deepEqual(f.writes(), []);
  });
}

test('provider phase budget expires without network calls and restores the global deadline', async () => {
  let clock = 0, calls = 0;
  const provider = createCustomRecruitProvider({ accessToken: 'test', deadline: 50000, now: () => clock, fetchImpl: async () => { calls++; return Response.json({ results: [] }); } });
  await assert.rejects(provider.withBudget(7000, async () => { clock = 7000; await provider.listRecruits(); }), error => error.code === 'deadline');
  assert.equal(calls, 0);
  await provider.listRecruits();
  assert.equal(calls, 1);
});

for (const [license, expected] of [['Not licensed', 'unlicensed'], ['Florida 2-14', 'already_licensed'], ['Florida 2-15', 'already_licensed'], ['Other state', undefined], ['', undefined]]) {
  test(`new application ticket maps declared license ${JSON.stringify(license)} without verification or acceptance claims`, async () => {
    const f = fake({ tickets: [] });
    await f.provider.applicationTicket({ ...application, license }, store());
    const properties = f.writes().find(c => c.method === 'POST').body.properties;
    assert.equal(properties.intake_license_status, expected);
    if (expected === undefined) assert.equal(Object.hasOwn(properties, 'intake_license_status'), false);
    assert.deepEqual(Object.keys(properties).sort(), [
      'hs_pipeline', 'recruit_name', 'subject', 'recruit_email', 'recruit_phone_number',
      'hs_pipeline_stage', 'recruiting_path', 'source_type', 'orientation_office',
      ...(expected ? ['intake_license_status'] : []),
    ].sort());
    assert.equal(properties.hs_pipeline_stage, stageIdForKey('application'));
    assert.equal(Object.hasOwn(properties, 'licensing_branch'), false);
    assert.equal(Object.hasOwn(properties, 'licensing_started'), false);
  });
}

test('source timestamps mirror the ticket and latest linked Contact activity without reverse writes', async () => {
  const sourceTicket = structuredClone(ticket), sourceContact = structuredClone(person);
  sourceTicket.properties.createdate = '2026-10-10T12:00:00Z';
  sourceTicket.properties.hs_lastmodifieddate = '2026-11-19T10:00:00Z';
  sourceTicket.properties.hs_v2_date_entered_current_stage = '2026-11-18T08:00:00Z';
  sourceTicket.properties.hs_lastcontacted = '2026-11-17T09:00:00Z';
  sourceContact.properties.notes_last_contacted = '2026-11-19T11:00:00Z';
  const custom = { ...structuredClone(customRecruit), properties: { ...structuredClone(customRecruit.properties), crm_ticket_id:'101' } };
  const f = fake({ nativeRecruit: custom, ticket: sourceTicket, person: sourceContact });
  await f.provider.syncSourceMetadata('101','301');
  const writes = f.writes();assert.equal(writes.length,1);assert.equal(writes[0].path,`/crm/v3/objects/${OBJECT}/301`);
  assert.deepEqual(writes[0].body.properties, { source_ticket_created_at:'2026-10-10T12:00:00.000Z', source_ticket_updated_at:'2026-11-19T10:00:00.000Z', source_ticket_stage_entered_at:'2026-11-18T08:00:00.000Z', source_last_contacted_at:'2026-11-19T11:00:00.000Z' });
  await f.provider.syncSourceMetadata('101','301');
  assert.equal(f.writes().length, 1, 'unchanged source data is a no-op');
});

test('source timestamp readback failure retries from current values without reverse writes', async () => {
  const source = structuredClone(ticket); source.properties.createdate = '2026-10-10T12:00:00Z';
  const f = fake({ ticket: source, ignorePatch: true });
  await assert.rejects(f.provider.syncSourceMetadata('101', '301'), { code: 'source_metadata_uncertain' });
  assert.equal(f.writes().length, 1);
  assert.equal(f.writes()[0].path, `/crm/v3/objects/${OBJECT}/301`);
});
test('invalid source dates and changed Contact associations stop metadata writes', async () => {
  const source = structuredClone(ticket); source.properties.createdate = 'invalid';
  const f = fake({ ticket: source });
  await assert.rejects(f.provider.syncSourceMetadata('101', '301'), { code: 'invalid_source_timestamp' });
  assert.deepEqual(f.writes(), []);
  const changed = fake({ customContacts: ['202'] });
  await assert.rejects(changed.provider.syncSourceMetadata('101', '301'), { code: 'association_changed' });
  assert.deepEqual(changed.writes(), []);
});
