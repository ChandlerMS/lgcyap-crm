import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichRecruitContacts } from '../lib/recruit-contact-read.mjs';

const rows = [{ id: '101', name: 'Independent ticket name', firstName: null, lastName: null, phone: '2025550100', email: null, lastContactedAt: '2026-10-20T12:00:00.000Z', lastContactedSource: 'ticket' }];
const json = value => new Response(JSON.stringify(value));
const contact = (extra = {}) => ({ id: '201', properties: { firstname: 'Synthetic', lastname: 'Contact', phone: '2025550101', email: 'synthetic@example.invalid', notes_last_contacted: '2026-10-29T12:00:00Z', ...extra } });

test('unique actual associations supply contact fields and latest logged contact without splitting ticket names', async () => {
  let calls = 0;
  const result = await enrichRecruitContacts(rows, { accessToken: 'synthetic-token', fetchImpl: async (url, options) => {
    calls++; assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    const body = JSON.parse(options.body);
    if (calls === 1) { assert.equal(url, 'https://api.hubapi.com/crm/v4/associations/tickets/contacts/batch/read'); assert.deepEqual(body, { inputs: [{ id: '101' }] }); return json({ status: 'COMPLETE', results: [{ from: { id: '101' }, to: [{ toObjectId: 201 }, { toObjectId: 201 }] }] }); }
    assert.equal(url, 'https://api.hubapi.com/crm/v3/objects/contacts/batch/read'); assert.deepEqual(body.properties, ['firstname', 'lastname', 'phone', 'email', 'notes_last_contacted']);
    return json({ status: 'COMPLETE', results: [contact({ private_note: 'must-not-leak' })] });
  } });
  assert.equal(calls, 2); assert.equal(result[0].name, 'Independent ticket name'); assert.equal(result[0].firstName, 'Synthetic'); assert.equal(result[0].lastName, 'Contact'); assert.equal(result[0].contactName, 'Synthetic Contact'); assert.equal(result[0].phone, '2025550101'); assert.equal(result[0].contactId, '201'); assert.equal(result[0].contactStatus, 'available'); assert.equal(result[0].lastContactedAt, '2026-10-29T12:00:00.000Z'); assert.equal(result[0].lastContactedSource, 'contact'); assert.doesNotMatch(JSON.stringify(result), /must-not-leak|private_note/);
});

test('multiple contacts, association pagination or no contact never invent an identity', async () => {
  for (const [to, paging, status] of [[[{ toObjectId: 201 }, { toObjectId: 202 }], undefined, 'ambiguous'], [[{ toObjectId: 201 }], { next: { after: 'provider-opaque' } }, 'ambiguous'], [[], undefined, 'unlinked']]) {
    let calls = 0;
    const result = await enrichRecruitContacts(rows, { accessToken: 'synthetic-token', fetchImpl: async () => { calls++; return json({ status: 'COMPLETE', results: [{ from: { id: '101' }, to, paging }] }); } });
    assert.equal(calls, 1); assert.equal(result[0].contactStatus, status); assert.equal(result[0].contactId, null); assert.equal(result[0].firstName, null); assert.equal(result[0].phone, '2025550100');
  }
});

test('failed or mismatched contact reads preserve the recruiting record and verified ticket facts', async () => {
  for (const response of [new Response(null, { status: 403 }), json({ status: 'COMPLETE', results: [{ from: { id: '999' }, to: [{ toObjectId: 201 }] }] }), json({ status: 'PENDING', results: [] })]) {
    const result = await enrichRecruitContacts(rows, { accessToken: 'synthetic-token', fetchImpl: async () => response });
    assert.equal(result.length, 1); assert.equal(result[0].contactStatus, 'unavailable'); assert.equal(result[0].phone, '2025550100'); assert.equal(result[0].lastContactedAt, rows[0].lastContactedAt);
  }
  let calls = 0;
  const result = await enrichRecruitContacts(rows, { accessToken: 'synthetic-token', fetchImpl: async () => ++calls === 1 ? json({ status: 'COMPLETE', results: [{ from: { id: '101' }, to: [{ toObjectId: 201 }] }] }) : json({ status: 'COMPLETE', results: [contact({ phone: null, notes_last_contacted: '2026-02-31T12:00:00Z' })] }) });
  assert.equal(result[0].phone, '2025550100'); assert.equal(result[0].lastContactedAt, rows[0].lastContactedAt); assert.equal(result[0].lastContactedSource, 'ticket');
});
