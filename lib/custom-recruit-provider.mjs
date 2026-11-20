import { CUSTOM_RECRUIT_OBJECT as OBJECT, CUSTOM_RECRUIT_PIPELINES, APPROVED_RECRUIT_PROPERTIES, SYNC_FIELDS, SOURCE_TIMESTAMP_FIELDS, recruitCanonical } from './custom-recruit-model.mjs';
import { PIPELINE_ID, PORTAL_ID, TERMINAL_STAGE_IDS, stageIdForKey } from './recruiting-config.mjs';
const id = value => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : null;
const ticketFields = [...SYNC_FIELDS, 'hs_pipeline', 'createdate', 'hs_lastmodifieddate', 'hs_v2_date_entered_current_stage', 'hs_lastcontacted', 'source_type', 'content', 'recruit_email', 'recruit_phone_number'];
const customFields = [...SYNC_FIELDS, ...SOURCE_TIMESTAMP_FIELDS, 'hs_pipeline', 'hs_lastmodifieddate', 'crm_ticket_id', 'closed_reason', 'lgcy_office'];
export class CustomRecruitSyncError extends Error { constructor(code) { super(`Recruit synchronization needs attention: ${code}`); this.code = code; } }
const fail = code => { throw new CustomRecruitSyncError(code); };
const pipelines = new Set(Object.values(CUSTOM_RECRUIT_PIPELINES).map(value => value.id));
export function createCustomRecruitProvider({ accessToken, fetchImpl = fetch, deadline = Date.now() + 50000, now = Date.now }) {
  const labels = new Map();
  let budgetEnd = deadline;
  async function request(path, method = 'GET', body, missing = false) {
    if (now() >= budgetEnd) fail('deadline');
    let response;
    try { response = await fetchImpl(`https://api.hubapi.com${path}`, { method, redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(Math.max(1, Math.min(8000, budgetEnd - now()))) }); }
    catch { fail('unavailable'); }
    if (missing && response.status === 404) return null;
    if (!response.ok) fail(response.status === 403 ? path.startsWith('/crm/v3/properties') ? 'schema_permission' : 'access_required' : response.status === 429 ? 'rate_limited' : 'unavailable');
    if (response.status === 204) return {};
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) fail('invalid_response');
    try { return text ? JSON.parse(text) : {}; } catch { fail('invalid_response'); }
  }
  async function associationType(from, to) {
    const key = `${from}/${to}`;
    if (!labels.has(key)) {
      const data = await request(`/crm/v4/associations/${key}/labels`);
      const types = data.results?.filter(value => value.label === null && ['HUBSPOT_DEFINED', 'USER_DEFINED'].includes(value.category) && Number.isInteger(value.typeId));
      if (types?.length !== 1) fail('association_schema');
      labels.set(key, types[0]);
    }
    return labels.get(key);
  }
  async function associations(type, recordId, to) {
    const result = new Set(), cursors = new Set(); let after;
    do {
      const data = await request(`/crm/v4/objects/${type}/${recordId}/associations/${to}?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      if (!Array.isArray(data.results)) fail('invalid_associations');
      for (const row of data.results) { const value = id(row.toObjectId); if (!value) fail('invalid_associations'); result.add(value); }
      after = data.paging?.next?.after;
      if (after && (result.size >= 500 || cursors.has(String(after)) || cursors.size >= 10)) fail('incomplete_associations');
      if (after) cursors.add(String(after));
    } while (after);
    return [...result];
  }
  function record(raw, expected, required = []) {
    if (!raw || !id(raw.id) || expected && raw.id !== expected || raw.archived || !raw.properties || typeof raw.properties !== 'object') fail('record_unavailable');
    if (required.some(key => !Object.hasOwn(raw.properties, key) || raw.properties[key] !== null && typeof raw.properties[key] !== 'string')) fail('invalid_record');
    return { id: String(raw.id), properties: raw.properties };
  }
  const readTicket = async ticketId => {
    const ticket = record(await request(`/crm/v3/objects/tickets/${ticketId}?properties=${ticketFields.join(',')}`), ticketId, [...SYNC_FIELDS, 'hs_pipeline']);
    if (ticket.properties.hs_pipeline !== PIPELINE_ID) fail('wrong_pipeline');
    return ticket;
  };
  const readRecruit = async recruitId => record(await request(`/crm/v3/objects/${OBJECT}/${recruitId}?properties=${customFields.join(',')}`), recruitId, [...SYNC_FIELDS, 'hs_pipeline', 'crm_ticket_id']);
  const contact = async contactId => record(await request(`/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,notes_last_contacted`), contactId);
  function timestamp(value) {
    if (value == null || value === '') return '';
    const parsed = new Date(/^\d+$/.test(value) ? Number(value) : value);
    if (!Number.isFinite(parsed.getTime())) fail('invalid_source_timestamp');
    return parsed.toISOString();
  }
  async function ticketForContact(contactId) {
    const ids = await associations('contacts', contactId, 'tickets');
    if (ids.length > 100) fail('ambiguous_tickets');
    const tickets = await Promise.all(ids.map(async value => {
      const raw = await request(`/crm/v3/objects/tickets/${value}?properties=hs_pipeline,hs_pipeline_stage`, 'GET', undefined, true);
      return raw && record(raw, value);
    }));
    const matches = tickets.filter(value => value?.properties.hs_pipeline === PIPELINE_ID);
    const active = matches.filter(value => !TERMINAL_STAGE_IDS.includes(value.properties.hs_pipeline_stage));
    if (active.length > 1 || !active.length && matches.length > 1) fail('ambiguous_tickets');
    return active[0]?.id ?? matches[0]?.id ?? null;
  }
  async function verifyAndSetup() {
    const info = await request('/oauth/v2/private-apps/get/access-token-info', 'POST', { tokenKey: accessToken });
    const scopes = ['crm.objects.contacts.read', 'crm.objects.tickets.read', 'crm.objects.tickets.write', 'crm.objects.custom.read', 'crm.objects.custom.write'];
    if (String(info.hubId) !== PORTAL_ID || String(info.appId) !== '59264745' || !scopes.every(scope => info.scopes?.includes(scope))) fail('wrong_credentials');
    const name = await request(`/crm/v3/properties/${OBJECT}/recruit_name`);
    if (!name.groupName) fail('schema_group');
    for (const definition of APPROVED_RECRUIT_PROPERTIES) {
      let existing = await request(`/crm/v3/properties/${OBJECT}/${definition.name}`, 'GET', undefined, true);
      if (!existing) existing = await request(`/crm/v3/properties/${OBJECT}`, 'POST', { ...definition, groupName: name.groupName, description: 'Synchronized with the Legacy recruiting app. Blank values remain unknown.' });
      if (existing.name !== definition.name || existing.type !== definition.type || existing.fieldType !== definition.fieldType || definition.hasUniqueValue && existing.hasUniqueValue !== true || definition.options.some(option => !(existing.options ?? []).some(value => value.value === option.value))) fail('schema_mismatch');
    }
    for (const pipeline of Object.values(CUSTOM_RECRUIT_PIPELINES)) {
      const raw = await request(`/crm/v3/pipelines/${OBJECT}/${pipeline.id}`);
      if (!Object.values(pipeline.stages).every(value => raw.stages?.some(stage => stage.id === value))) fail('pipeline_mismatch');
    }
    await associationType(OBJECT, 'contacts'); await associationType('tickets', 'contacts');
  }
  async function pair(ticketId, knownRecruitId) {
    const ticket = await readTicket(ticketId);
    const contacts = await associations('tickets', ticketId, 'contacts');
    if (contacts.length !== 1) fail('ambiguous_contacts');
    const contactId = contacts[0];
    const relatedTickets = await ticketForContact(contactId);
    if (relatedTickets !== ticketId) fail('association_changed');
    let recruit = null;
    const keyed = await request(`/crm/v3/objects/${OBJECT}/${ticketId}?idProperty=crm_ticket_id&properties=${customFields.join(',')}`, 'GET', undefined, true);
    if (keyed) recruit = record(keyed, undefined, [...SYNC_FIELDS, 'hs_pipeline', 'crm_ticket_id']);
    else if (knownRecruitId) recruit = await readRecruit(knownRecruitId);
    else {
      const ids = await associations('contacts', contactId, OBJECT);
      if (ids.length > 1) fail('ambiguous_recruits');
      if (ids.length) recruit = await readRecruit(ids[0]);
    }
    if (recruit) {
      if (!pipelines.has(recruit.properties.hs_pipeline) || recruit.properties.crm_ticket_id && recruit.properties.crm_ticket_id !== ticketId || knownRecruitId && recruit.id !== knownRecruitId) fail('association_changed');
      const linked = await associations(OBJECT, recruit.id, 'contacts');
      if (linked.length !== 1 || linked[0] !== contactId) fail('association_changed');
    }
    return { ticket, contactId, recruit };
  }
  async function create(type, properties, contactId) {
    const relation = await associationType(type, 'contacts');
    return record(await request(`/crm/v3/objects/${type}`, 'POST', { properties, associations: [{ to: { id: contactId }, types: [{ associationCategory: relation.category, associationTypeId: relation.typeId }] }] }));
  }
  async function search(type, filters, properties, sorts, limit = 30) {
    const raw = await request(`/crm/v3/objects/${type}/search`, 'POST', { filterGroups: [{ filters }], properties, sorts, limit });
    if (!Array.isArray(raw.results) || raw.results.some(value => !id(value.id))) fail('invalid_search');
    return { records: raw.results.map(value => record(value)), more: Boolean(raw.paging?.next) };
  }
  return {
    async withBudget(end, work) {
      const previous = budgetEnd;
      budgetEnd = Math.min(previous, end);
      try { return await work(); } finally { budgetEnd = previous; }
    },
    request, verifyAndSetup, pair, readTicket, readRecruit, contact, associations, ticketForContact,
    createRecruit: (ticketId, contactId, properties) => create(OBJECT, { ...properties, crm_ticket_id: ticketId }, contactId),
    createTicket: (contactId, properties) => create('tickets', { ...properties, hs_pipeline: PIPELINE_ID }, contactId),
    patchTicket: (ticketId, properties) => request(`/crm/v3/objects/tickets/${ticketId}`, 'PATCH', { properties }),
    patchRecruit: (recruitId, properties) => request(`/crm/v3/objects/${OBJECT}/${recruitId}`, 'PATCH', { properties }),
    async linkRecruit(ticketId, recruitId) {
      const current = await pair(ticketId, recruitId);
      if (current.recruit.properties.crm_ticket_id && current.recruit.properties.crm_ticket_id !== ticketId) fail('association_changed');
      const properties = { ...(!current.recruit.properties.crm_ticket_id ? { crm_ticket_id: ticketId } : {}), ...(!current.recruit.properties.orientation_office && current.ticket.properties.orientation_office ? { orientation_office: current.ticket.properties.orientation_office } : {}) };
      if (Object.keys(properties).length) await request(`/crm/v3/objects/${OBJECT}/${recruitId}`, 'PATCH', { properties });
    },
    async syncSourceMetadata(ticketId, recruitId) {
      // These system timestamps describe the original ticket and are never written back to it.
      const current = await pair(ticketId, recruitId);
      const person = await contact(current.contactId);
      const p = current.ticket.properties;
      if (['createdate', 'hs_lastmodifieddate', 'hs_v2_date_entered_current_stage', 'hs_lastcontacted'].some(key => !Object.hasOwn(p, key)) || !Object.hasOwn(person.properties, 'notes_last_contacted') || SOURCE_TIMESTAMP_FIELDS.some(key => !Object.hasOwn(current.recruit.properties, key))) fail('invalid_source_timestamp');
      const contacted = [timestamp(p.hs_lastcontacted), timestamp(person.properties.notes_last_contacted)].filter(Boolean).sort().at(-1) || '';
      const desired = {
        source_ticket_created_at: timestamp(p.createdate),
        source_ticket_updated_at: timestamp(p.hs_lastmodifieddate),
        source_ticket_stage_entered_at: timestamp(p.hs_v2_date_entered_current_stage),
        source_last_contacted_at: contacted,
      };
      const properties = Object.fromEntries(Object.entries(desired).filter(([key, value]) => timestamp(current.recruit.properties[key]) !== value));
      if (!Object.keys(properties).length) return;
      await request(`/crm/v3/objects/${OBJECT}/${recruitId}`, 'PATCH', { properties });
      const observed = await readRecruit(recruitId);
      if (Object.entries(properties).some(([key, value]) => timestamp(observed.properties[key]) !== value)) fail('source_metadata_uncertain');
    },
    listTickets: (cursor = '0') => search('tickets', [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }, { propertyName: 'hs_object_id', operator: 'GT', value: cursor }], ['hs_pipeline'], ['hs_object_id']),
    changedTickets: since => search('tickets', [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }, { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(since) }], ['hs_pipeline'], ['-hs_lastmodifieddate']),
    listRecruits: (cursor = '0') => search(OBJECT, [{ propertyName: 'hs_pipeline', operator: 'IN', values: [...pipelines] }, { propertyName: 'hs_object_id', operator: 'GT', value: cursor }], customFields, ['hs_object_id']),
    changedRecruits: since => search(OBJECT, [{ propertyName: 'hs_pipeline', operator: 'IN', values: [...pipelines] }, { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(since) }], customFields, ['-hs_lastmodifieddate']),
    applicationNote: async noteId => record(await request(`/crm/v3/objects/notes/${noteId}?properties=hs_note_body,hs_timestamp`), noteId),
    applicationNotes: (cursor = '0') => search('notes', [{ propertyName: 'hs_object_source_label', operator: 'EQ', value: 'INTEGRATION' }, { propertyName: 'hs_createdate', operator: 'GTE', value: String(Date.parse('2026-11-10T05:00:00Z')) }, { propertyName: 'hs_note_body', operator: 'CONTAINS_TOKEN', value: 'submitted' }, { propertyName: 'hs_object_id', operator: 'GT', value: cursor }], ['hs_note_body', 'hs_timestamp'], ['hs_object_id'], 10),
    async applicationTicket(application, store) {
      if (!id(application.contact?.id)) fail('missing_application_contact');
      const contactId = application.contact.id;
      const linked = await associations('notes', application.id, 'contacts');
      if (linked.length !== 1 || linked[0] !== contactId) fail('ambiguous_application_contact');
      const current = await ticketForContact(contactId);
      if (current) { await request(`/crm/v4/objects/notes/${application.id}/associations/default/tickets/${current}`, 'PUT'); return current; }
      const pending = await store.getIntake(contactId);
      if (pending) fail('intake_uncertain');
      const person = await contact(contactId), p = person.properties;
      const office = ['orlando', 'miami', 'tampa'].includes(application.officeKey) ? application.officeKey : '';
      const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || application.name;
      if (!name) fail('missing_name');
      const license = { 'Not licensed': 'unlicensed', 'Florida 2-14': 'already_licensed', 'Florida 2-15': 'already_licensed' }[application.license];
      const properties = { ...(license ? { intake_license_status: license } : {}), hs_pipeline: PIPELINE_ID, recruit_name: name, subject: `Recruiting: ${name}`.slice(0, 180), recruit_email: p.email || application.email || '', recruit_phone_number: p.phone || application.phone || '', hs_pipeline_stage: stageIdForKey('application'), recruiting_path: 'mass_recruiting', source_type: 'FORM', ...(office ? { orientation_office: office } : {}) };
      await store.putIntake(contactId, { status: 'pending', sourceId: application.id });
      const created = await create('tickets', properties, contactId);
      await store.putIntake(contactId, { status: 'confirmed', sourceId: application.id, ticketId: created.id });
      // Reuse the original note rather than rewriting application answers.
      await request(`/crm/v4/objects/notes/${application.id}/associations/default/tickets/${created.id}`, 'PUT');
      if (await ticketForContact(contactId) !== created.id) fail('association_changed');
      return created.id;
    },
    async nativeTicket(recruit, store) {
      if (!pipelines.has(recruit.properties.hs_pipeline)) return null;
      recruit = await readRecruit(recruit.id);
      const linked = await associations(OBJECT, recruit.id, 'contacts');
      if (linked.length !== 1) fail('ambiguous_contacts');
      const contactId = linked[0], current = await ticketForContact(contactId);
      if (current) return current;
      if (await store.getIntake(contactId)) fail('intake_uncertain');
      const properties = recruitCanonical(recruit.properties);
      const person = await contact(contactId);
      const name = properties.recruit_name || [person.properties.firstname, person.properties.lastname].filter(Boolean).join(' ');
      if (!name) fail('missing_name');
      await store.putIntake(contactId, { status: 'pending', sourceId: recruit.id });
      const created = await create('tickets', { ...properties, hs_pipeline: PIPELINE_ID, subject: properties.subject || `Recruiting: ${name}`.slice(0, 180), recruit_name: name, recruit_email: person.properties.email || '', recruit_phone_number: person.properties.phone || '' }, contactId);
      await store.putIntake(contactId, { status: 'confirmed', sourceId: recruit.id, ticketId: created.id });
      return created.id;
    },
  };
}
