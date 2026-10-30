import test from 'node:test';
import assert from 'node:assert/strict';
import { hubspotDateTimeInput, hubspotDateTimeToIso, hubspotEditBaseline, hubspotEditChanges, hubspotRecordSnapshotAvailable, HubspotRecordSaveError, saveHubspotRecordSnapshot, validateHubspotEditChanges } from '../app/hubspot-record-edit.mjs';
import { editableFields } from '../lib/hubspot-tool-edit-config.mjs';
import { validateToolWriteInput } from '../lib/hubspot-tool-write.mjs';

const fields = [{ property: 'firstname', label: 'First name', type: 'text', maxLength: 100 }, { property: 'lastname', label: 'Last name', type: 'text', maxLength: 100 }, { property: 'email', label: 'Email', type: 'email', maxLength: 254 }];
const record = { id: '123', title: 'First Last', updatedAt: '2026-10-30T15:00:00.000Z', editValues: { firstname: 'First', lastname: 'Last', email: 'person@example.com' } };
const requestId = '72663a1d-808b-4f06-8ad0-f7f5665cae08';
const endpoint = '/api/hubspot-tools/contacts/123';
const saved = { ...record, updatedAt: '2026-10-30T15:01:00.000Z', editValues: { ...record.editValues, firstname: 'New' } };

test('editing uses raw fields and creates sparse changes without rewriting untouched values', () => {
  const baseline = hubspotEditBaseline(record, fields);
  assert.equal(hubspotRecordSnapshotAvailable(record, fields), true);
  assert.equal(hubspotRecordSnapshotAvailable({ ...record, editValues: { firstname: 'First' } }, fields), false);
  assert.equal(hubspotRecordSnapshotAvailable({ ...record, updatedAt: '2026-02-30T15:00:00.000Z' }, fields), false);
  assert.deepEqual(hubspotEditChanges({ ...baseline, firstname: ' New ' }, baseline, fields), { firstname: 'New' });
  assert.deepEqual(hubspotEditChanges({ firstname: ' First ', lastname: 'Changed', email: 'person@example.com' }, { ...baseline, firstname: ' First ' }, fields), { lastname: 'Changed' });
  assert.ok(validateHubspotEditChanges({ unrelated: 'value' }, fields));
  assert.ok(validateHubspotEditChanges({ email: 'invalid' }, fields));
});

test('reviewed save sends exactly the changed raw baseline and verifies confirmed values', async () => {
  let calls = 0;
  const result = await saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, endpoint); assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(init.body), { requestId, expectedUpdatedAt: record.updatedAt, expectedValues: { firstname: 'First' }, changes: { firstname: 'New' } });
    return Response.json({ status: 'saved', requestId, record: saved, replayed: false });
  } });
  assert.equal(calls, 1); assert.equal(result.record.editValues.firstname, 'New');
});

test('unconfirmed responses and network failures never retry the mutation', async () => {
  for (const fetchResult of [() => { throw new Error('Network interrupted'); }, () => Response.json({ status: 'saved', requestId, record }), () => Response.json({ status: 'saved', requestId: 'different', record: saved })]) {
    let calls = 0;
    await assert.rejects(saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, fetchImpl: async () => { calls++; return fetchResult(); } }), error => error instanceof HubspotRecordSaveError && error.uncertain);
    assert.equal(calls, 1);
  }
});

test('sign-in, stale versions and rate limits remain distinct without automatic retries', async () => {
  await assert.rejects(saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, fetchImpl: async () => new Response('Sign in', { status: 401 }) }), error => error.status === 401 && error.code === 'UNAUTHORIZED');
  await assert.rejects(saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, fetchImpl: async () => Response.json({ error: { code: 'RECORD_CHANGED' } }, { status: 409 }) }), error => error.code === 'RECORD_CHANGED' && !error.uncertain);
  await assert.rejects(saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, fetchImpl: async () => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers: { 'Retry-After': '20' } }) }), error => error.retryAfterSeconds === 20);
});

test('missing versions, forbidden fields and external endpoints fail before any request', async () => {
  for (const overrides of [{ endpoint: 'https://other.example/api/save' }, { record: { ...record, updatedAt: null } }, { changes: { hs_pipeline_stage: 'other' } }]) {
    let calls = 0;
    await assert.rejects(saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, ...overrides, fetchImpl: async () => { calls++; return Response.json({}); } }), error => error.code === 'INVALID_SAVE');
    assert.equal(calls, 0);
  }
});

test('meeting and task times convert Eastern input to canonical UTC without changing untouched seconds', () => {
  assert.equal(hubspotDateTimeInput('2026-10-30T14:30:45.123Z'), '2026-10-30T10:30');
  assert.deepEqual(hubspotDateTimeToIso('2026-10-30T10:30', '2026-10-30T14:30:45.123Z'), { value: '2026-10-30T14:30:45.123Z', error: null });
  assert.deepEqual(hubspotDateTimeToIso('2026-10-30T11:00'), { value: '2026-10-30T15:00:00.000Z', error: null });
  assert.deepEqual(hubspotDateTimeToIso('2026-12-30T11:00'), { value: '2026-12-30T16:00:00.000Z', error: null });
  assert.deepEqual(hubspotDateTimeToIso(''), { value: '', error: null });
});

test('DST gaps and new ambiguous times require an explicit correction, while existing fold instants remain intact', () => {
  assert.match(hubspotDateTimeToIso('2026-03-08T02:30').error, /does not exist/);
  assert.match(hubspotDateTimeToIso('2026-11-01T01:30').error, /occurs twice/);
  assert.deepEqual(hubspotDateTimeToIso('2026-11-01T01:30', '2026-11-01T06:30:00.000Z'), { value: '2026-11-01T06:30:00.000Z', error: null });
  assert.ok(hubspotDateTimeToIso('2026-02-30T12:00').error);
  assert.ok(validateHubspotEditChanges({ due: '2026-03-08T02:30' }, [{ property: 'due', label: 'Due', type: 'datetime' }]));
});

test('reviewed email and domain values match the real writer canonicalization before submission', () => {
  for (const [tool, baseline, draft] of [
    ['contacts', { firstname: 'Synthetic', lastname: 'Person', phone: '', email: 'old@example.invalid', company: 'Agency' }, { email: ' NEW@EXAMPLE.invalid ' }],
    ['customer-success', { name: 'Synthetic company', domain: 'old.example', phone: '', city: '', hs_csm_sentiment: '' }, { domain: ' NEW.EXAMPLE ' }],
  ]) {
    const definitions = editableFields(tool);
    const changes = hubspotEditChanges({ ...baseline, ...draft }, baseline, definitions);
    const expectedValues = Object.fromEntries(Object.keys(changes).map(property => [property, baseline[property]]));
    assert.equal(validateHubspotEditChanges(changes, definitions), null);
    const validated = validateToolWriteInput(tool, record.id, { requestId, expectedUpdatedAt: record.updatedAt, expectedValues, changes });
    assert.deepEqual(validated.changes, changes);
  }
  assert.ok(validateHubspotEditChanges({ phone: 'letters only' }, editableFields('contacts')));
  assert.ok(validateHubspotEditChanges({ firstname: 'Line\nBreak' }, editableFields('contacts')));
});

test('replayed saves with later field changes explain the completed original save without sending again', async () => {
  let calls = 0;
  await assert.rejects(saveHubspotRecordSnapshot({ endpoint, record, fields, changes: { firstname: 'New' }, requestId, fetchImpl: async () => { calls++; return Response.json({ status: 'saved', requestId, record, replayed: true }); } }), error => error.code === 'REPLAY_RECORD_CHANGED' && error.uncertain === false && /earlier save completed/.test(error.message));
  assert.equal(calls, 1);
});

test('meeting review validates the merged start/end range before a save can be submitted', () => {
  const definitions = editableFields('meetings');
  const baseline = { hs_meeting_start_time: '2026-11-01T14:00:00.000Z', hs_meeting_end_time: '2026-11-01T15:00:00.000Z' };
  assert.match(validateHubspotEditChanges({ hs_meeting_end_time: '2026-11-01T13:00:00.000Z' }, definitions, baseline), /end must follow/);
  assert.match(validateHubspotEditChanges({ hs_meeting_start_time: '' }, definitions, baseline), /end must follow/);
  assert.equal(validateHubspotEditChanges({ hs_meeting_start_time: '2026-11-01T16:00:00.000Z', hs_meeting_end_time: '2026-11-01T17:00:00.000Z' }, definitions, baseline), null);
});
