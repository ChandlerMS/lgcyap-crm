import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecruitActivity, normalizeActivity, handleRecruitActivity } from '../lib/recruit-activity.mjs';
import { PIPELINE_ID } from '../lib/recruiting-config.mjs';

const response = value => Response.json(value);
function provider({ pipeline = PIPELINE_ID, links = ['22'], next = '80', foreign = false } = {}) {
  const urls = [];
  return { urls, fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(new URL(url).origin, 'https://api.hubapi.com');
    if (url.includes('/objects/tickets/11?')) return response({ id: '11', properties: { hs_pipeline: pipeline } });
    if (url.endsWith('/tickets/contacts/batch/read')) return response({ status: 'COMPLETE', results: [{ from: { id: '11' }, to: links.map(id => ({ toObjectId: id })) }] });
    if (url.includes('/associations/notes?')) return response({ results: [{ toObjectId: '33' }], ...(next ? { paging: { next: { after: next, link: 'https://evil.invalid/' } } } : {}) });
    if (url.endsWith('/notes/batch/read')) { assert.deepEqual(JSON.parse(options.body).inputs, [{ id: '33' }]); return response({ status: 'COMPLETE', results: [{ id: foreign ? '99' : '33', properties: { hs_note_body: '<p>Recorded note</p>', hs_timestamp: '2026-10-30T10:00:00Z' } }] }); }
    throw Error('unexpected route');
  } };
}
test('reads only associated activity and returns resumable cursor without following provider link', async () => {
  const mock = provider(); const result = await readRecruitActivity('11', { kind: 'notes', source: 'contact' }, { accessToken: 'test', ...mock });
  assert.equal(result.records[0].body, 'Recorded note'); assert.equal(result.next, '80');
  assert.ok(mock.urls.some(url => url.includes('/contacts/22/associations/notes')));
});
test('rejects non-recruiting tickets before history access', async () => {
  const mock = provider({ pipeline: 'other' }); await assert.rejects(readRecruitActivity('11', {}, { accessToken: 'test', ...mock })); assert.equal(mock.urls.length, 1);
});
test('does not guess a contact when multiple contacts are linked', async () => {
  const mock = provider({ links: ['22', '23'] }); const result = await readRecruitActivity('11', { source: 'contact' }, { accessToken: 'test', ...mock });
  assert.equal(result.records.length, 0); assert.match(result.notice, /multiple/); assert.equal(mock.urls.length, 2);
});
test('rejects repeated cursor and unassociated batch records', async () => {
  await assert.rejects(readRecruitActivity('11', { after: '80' }, { accessToken: 'test', ...provider() }));
  await assert.rejects(readRecruitActivity('11', {}, { accessToken: 'test', ...provider({ foreign: true }) }));
});
test('never returns recording URLs or fabricates transcript text from call notes', () => {
  const row = normalizeActivity('calls', { id: '33', properties: { hs_call_body: '<script>bad()</script><p>Notes</p>', hs_call_recording_url: 'https://example.test/?access_token=secret', hs_call_has_transcript: 'true' } });
  assert.equal(row.body, 'Notes'); assert.equal(row.recordingAvailable, true); assert.equal(row.transcriptAvailable, true); assert.equal(row.transcript, undefined); assert.ok(!JSON.stringify(row).includes('secret'));
});
test('auth and origin guards run before any provider read', async () => {
  let called = false;
  const request = origin => new Request('https://crm.test/api/recruits/11/activity', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: '{}' });
  const options = { getUser: async () => null, authorizeUser: () => true, allowedOrigin: 'https://crm.test', readData: async () => { called = true; } };
  assert.equal((await handleRecruitActivity(request('https://crm.test'), '11', options)).status, 401);
  assert.equal((await handleRecruitActivity(request('https://bad.test'), '11', { ...options, getUser: async () => ({ id: '1' }) })).status, 403);
  assert.equal(called, false);
});

test('RingEX call metadata and HubSpot AI summary are shown without inventing a transcript', () => {
  const row = normalizeActivity('calls', { id: '33', properties: {
    hs_call_title: 'Outbound call', hs_call_duration: '17000', hs_object_source_detail_1: 'RingEX by RingCentral',
    hs_call_summary: '', hs_ai_summary: '<p>Discussed next steps.</p>', hs_call_has_transcript: 'false',
  } });
  assert.equal(row.durationSeconds, 17);
  assert.equal(row.source, 'RingEX by RingCentral');
  assert.equal(row.summary, 'Discussed next steps.');
  assert.equal(row.transcriptAvailable, false);
  assert.equal(row.recordingAvailable, false);
  assert.equal(row.reviewUrl, 'https://app.hubspot.com/calls/50894788/review/33');
  for (const duration of ['', null, undefined, '-1', 'garbage']) {
    assert.equal(normalizeActivity('calls', { id: '33', properties: { hs_call_duration: duration } }).durationSeconds, null);
  }
});

test('reads associated native RingEX calls with media flags and verified summary fields', async () => {
  let requests = 0;
  const result = await readRecruitActivity('11', { kind: 'calls', source: 'contact' }, { accessToken: 'test', fetchImpl: async (url, options) => {
    requests++;
    if (url.includes('/objects/tickets/11?')) return response({ id: '11', properties: { hs_pipeline: PIPELINE_ID } });
    if (url.endsWith('/tickets/contacts/batch/read')) return response({ status: 'COMPLETE', results: [{ from: { id: '11' }, to: [{ toObjectId: '22' }] }] });
    if (url.includes('/contacts/22/associations/calls?')) return response({ results: [{ toObjectId: '33' }] });
    if (url.endsWith('/calls/batch/read')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.inputs, [{ id: '33' }]);
      assert.ok(body.properties.includes('hs_ai_summary'));
      assert.ok(body.properties.includes('hs_object_source_detail_1'));
      return response({ status: 'COMPLETE', results: [{ id: '33', properties: { hs_call_recording_url: 'https://provider.invalid/private', hs_call_has_transcript: 'true', hs_ai_summary: 'Summary', hs_object_source_detail_1: 'RingEX by RingCentral' } }] });
    }
    throw Error('Unexpected API route');
  } });
  assert.equal(requests, 4);
  assert.equal(result.records[0].recordingAvailable, true);
  assert.equal(result.records[0].transcriptAvailable, true);
  assert.equal(result.records[0].summary, 'Summary');
  assert.equal(result.next, null);
  assert.ok(!JSON.stringify(result).includes('provider.invalid'));
});
