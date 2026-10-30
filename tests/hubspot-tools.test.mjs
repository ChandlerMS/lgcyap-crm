import test from 'node:test';
import assert from 'node:assert/strict';
import { HUBSPOT_TOOL_CONFIG, handleHubSpotToolRequest, readHubSpotTool, validateToolInput } from '../lib/hubspot-tools.mjs';

const now = () => Date.parse('2026-10-30T12:00:00Z');
const token = 'synthetic-owner-only-token';
const row = (id = '101', properties = {}) => ({ id, properties, createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-29T09:00:00Z' });
const provider = (results = [], total = results.length, after) => new Response(JSON.stringify({ results, total, ...(after ? { paging: { next: { after, link: 'https://never-follow.invalid' } } } : {}) }));
const request = (body = '{}', headers = {}, method = 'POST') => new Request('https://private.example/api/hubspot-tools/contacts', { method, headers: { Origin: 'https://private.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body }) });
const deps = { getUser: () => ({ userId: 'synthetic-user' }), authorizeUser: () => true, allowedOrigin: 'https://private.example', readData: async () => ({ records: [] }) };

test('tool selection accepts only eight fixed tools and inbox thread selection, without caller authority', () => {
  assert.equal(Object.keys(HUBSPOT_TOOL_CONFIG).length, 8);
  for (const tool of Object.keys(HUBSPOT_TOOL_CONFIG)) assert.deepEqual(validateToolInput(tool, {}), {});
  assert.deepEqual(validateToolInput('inbox', { threadId: '123' }), { threadId: '123' });
  for (const tool of ['constructor', '../contacts', 'companies', 'https://attacker.invalid']) assert.throws(() => validateToolInput(tool, {}));
  for (const input of [null, [], { endpoint: 'https://attacker.invalid' }, { properties: ['private'] }, { query: 'anything' }, { threadId: '../123' }, { threadId: 123 }, { threadId: '123', limit: 1000 }]) assert.throws(() => validateToolInput('inbox', input));
  assert.throws(() => validateToolInput('contacts', { threadId: '123' }));
});

test('every CRM tool uses fixed search endpoint, selected fields, read scope and truthful empty result', async () => {
  for (const [tool, config] of Object.entries(HUBSPOT_TOOL_CONFIG).filter(([key]) => key !== 'inbox')) {
    let calls = 0;
    const result = await readHubSpotTool(tool, {}, { accessToken: token, now, fetchImpl: async (url, options) => {
      calls++; assert.equal(url, `https://api.hubapi.com/crm/v3/objects/${config.object}/search`);
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, `Bearer ${token}`);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.properties, config.fields); assert.equal(body.limit, 100);
      assert.deepEqual(body.sorts, [{ propertyName: config.sort ?? 'hs_object_id', direction: 'DESCENDING' }]);
      if (tool === 'customer-success') assert.deepEqual(body.filterGroups, [{ filters: [{ propertyName: 'hs_current_customer', operator: 'EQ', value: 'yes' }] }]);
      return provider();
    } });
    assert.equal(calls, 1); assert.equal(result.tool, tool); assert.equal(result.status, 'available'); assert.equal(result.total, 0); assert.equal(result.loadedCount, 0); assert.equal(result.partial, false); assert.equal(result.source, 'HubSpot'); assert.equal(result.readOnly, true);
    assert.deepEqual(result.requiredScopes, config.scopes); assert.ok(result.hubspotUrl.startsWith('https://app.hubspot.com/'));
  }
  for (const tool of ['calls', 'tasks', 'meetings', 'calendar']) assert.deepEqual(HUBSPOT_TOOL_CONFIG[tool].scopes, ['crm.objects.contacts.read']);
});

test('all CRM tools accept a bounded global query while preserving fixed endpoints, properties, sorts and filters', async () => {
  for (const [tool, config] of Object.entries(HUBSPOT_TOOL_CONFIG).filter(([, value]) => value.object)) {
    assert.deepEqual(validateToolInput(tool, { query: '  Synthetic Example  ' }), { query: 'Synthetic Example' });
    let calls = 0;
    const result = await readHubSpotTool(tool, { query: '  Synthetic Example  ' }, { accessToken: token, now, fetchImpl: async (url, options) => {
      calls++; assert.equal(url, `https://api.hubapi.com/crm/v3/objects/${config.object}/search`); assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body); assert.equal(body.query, 'Synthetic Example'); assert.deepEqual(body.properties, config.fields); assert.equal(body.limit, 100);
      assert.deepEqual(body.sorts, [{ propertyName: config.sort ?? 'hs_object_id', direction: 'DESCENDING' }]);
      if (tool === 'customer-success') assert.deepEqual(body.filterGroups, [{ filters: config.filters }]);
      return provider([], 0);
    } });
    assert.equal(calls, 1); assert.equal(result.query, 'Synthetic Example'); assert.equal(result.total, 0); assert.equal(result.partial, false); assert.doesNotMatch(result.hubspotUrl, /Synthetic|query=/);
    assert.deepEqual(result.requiredScopes, config.scopes);
  }
  assert.throws(() => validateToolInput('inbox', { query: 'Synthetic Example' }));
});

test('query validation rejects unsafe authority, types, controls and lengths before any provider request', async () => {
  for (const input of [{ query: '' }, { query: ' ' }, { query: 'a' }, { query: 'a'.repeat(201) }, { query: 123 }, { query: null }, { query: ['Synthetic'] }, { query: 'Synthetic\nExample' }, { query: 'Synthetic\u0000Example' }, { query: 'Synthetic\u007fExample' }, { query: 'Synthetic', properties: ['private'] }, { query: 'Synthetic', filters: [] }, { query: 'Synthetic', threadId: '123' }]) {
    let called = false;
    await assert.rejects(readHubSpotTool('contacts', input, { accessToken: token, now, fetchImpl: async () => { called = true; } }));
    assert.equal(called, false);
  }
  assert.deepEqual(validateToolInput('contacts', { query: 'ab' }), { query: 'ab' });
  assert.equal(validateToolInput('contacts', { query: 'a'.repeat(200) }).query.length, 200);
  const literal = '{"endpoint":"https://never-follow.invalid"}';
  const result = await readHubSpotTool('contacts', { query: literal }, { accessToken: token, now, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.hubapi.com/crm/v3/objects/contacts/search'); assert.equal(JSON.parse(options.body).query, literal); return provider();
  } });
  assert.equal(result.query, literal);
});

test('fresh detail reads expose only supported editable snapshots and never infer write capability from read access', async () => {
  const result = await readHubSpotTool('contacts', { recordId: '101' }, { accessToken: token, now, fetchImpl: async (url, options) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.hubapi.com'); assert.equal(parsed.pathname, '/crm/v3/objects/contacts/101'); assert.equal(options.method, 'GET');
    assert.ok(parsed.searchParams.get('properties').includes('firstname'));
    return new Response(JSON.stringify(row('101', { firstname: 'Synthetic', lastname: 'Person', phone: '2025550101', email: 'SYNTHETIC@example.invalid', company: 'Example', lastmodifieddate: '2026-10-29T09:00:00Z' })));
  } });
  assert.equal(result.status, 'available'); assert.equal(result.selectedRecordId, '101'); assert.equal(result.records[0].id, '101'); assert.equal(result.records[0].editValues.email, 'synthetic@example.invalid'); assert.equal(result.records[0].updatedAt, '2026-10-29T09:00:00.000Z'); assert.equal(result.capabilities.canEdit, false); assert.equal(result.fields.length, 5);
  assert.throws(() => validateToolInput('contacts', { recordId: '../101' }));
  assert.throws(() => validateToolInput('contacts', { recordId: '101', query: 'Synthetic' }));
  for (const tool of ['calls', 'calendar', 'inbox']) assert.throws(() => validateToolInput(tool, { recordId: '101' }));
});

test('global query is retained on every bounded result page with genuine total and partial status', async () => {
  let calls = 0;
  const result = await readHubSpotTool('contacts', { query: 'Synthetic Example' }, { accessToken: token, now, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.query, 'Synthetic Example');
    const start = calls++ * 100 + 1;
    if (calls > 1) assert.equal(body.after, String((calls - 1) * 100));
    return provider(Array.from({ length: 100 }, (_, i) => row(String(start + i))), 601, String(calls * 100));
  } });
  assert.equal(calls, 5); assert.equal(result.total, 601); assert.equal(result.loadedCount, 500); assert.equal(result.partial, true); assert.equal(result.query, 'Synthetic Example');
});

test('contact projection retains only requested display facts and never leaks unrequested provider properties', async () => {
  const result = await readHubSpotTool('contacts', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { firstname: 'Synthetic', lastname: 'Person', email: 'demo@example.invalid', phone: '2025550101', company: 'Example', lifecyclestage: 'lead', bank_account: 'must-not-leak', raw_html: '<script>must-not-leak</script>' })]) });
  const record = result.records[0];
  assert.equal(record.title, 'Synthetic Person'); assert.equal(record.email, 'demo@example.invalid'); assert.equal(record.phone, '2025550101'); assert.equal(record.status, 'Lead'); assert.equal(record.company, 'Example');
  assert.equal(record.owner, null); assert.equal(record.createdAt, '2026-10-20T09:00:00.000Z');
  assert.match(record.hubspotUrl, /record\/0-1\/101\?/);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|bank_account|raw_html/);
});

test('Customer Success uses verified current-customer yes value, recorded sentiment and nullable renewal dates', async () => {
  const result = await readHubSpotTool('customer-success', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { name: 'Synthetic Account', hs_current_customer: 'yes', hs_csm_sentiment: 'at_risk', hs_next_renewal_date: '2026-11-02' })]) });
  assert.equal(result.records[0].health, 'At-Risk'); assert.equal(result.records[0].scheduledAt, '2026-11-02T00:00:00.000Z');
  assert.match(result.notice, /health scores.*not reproduced/);
  const unknown = await readHubSpotTool('customer-success', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { hs_current_customer: 'yes', hs_csm_sentiment: 'constructor' })]) });
  assert.equal(unknown.records[0].health, null);
  const bad = await readHubSpotTool('customer-success', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { hs_current_customer: 'true' })]) });
  assert.equal(bad.status, 'unavailable'); assert.equal(bad.error.code, 'HUBSPOT_RESPONSE_INVALID');
});

test('calls, tasks and meetings expose real activity dates and readable statuses without fabricated times', async () => {
  const call = await readHubSpotTool('calls', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { hs_call_title: 'Synthetic call', hs_call_status: 'NO_ANSWER', hs_call_direction: 'OUTBOUND', hs_call_duration: '125000', hs_timestamp: '2026-10-29T14:00:00Z', hs_call_to_number: '2025550101' })]) });
  assert.equal(call.records[0].status, 'No Answer'); assert.equal(call.records[0].subtitle, 'Outbound · 2m 5s'); assert.equal(call.records[0].scheduledAt, '2026-10-29T14:00:00.000Z');
  const inbound = await readHubSpotTool('calls', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { hs_call_direction: 'INBOUND', hs_call_from_number: '2025550198', hs_call_to_number: '2025550199' })]) });
  assert.equal(inbound.records[0].phone, '2025550198');
  const task = await readHubSpotTool('tasks', {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { hs_task_subject: 'Synthetic task', hs_task_status: 'NOT_STARTED', hs_task_priority: 'HIGH', hs_task_type: 'CALL', hs_timestamp: '2026-02-31' })]) });
  assert.equal(task.records[0].status, 'Not Started'); assert.equal(task.records[0].subtitle, 'High · Call'); assert.equal(task.records[0].scheduledAt, null);
  for (const tool of ['calendar', 'meetings']) {
    const meeting = await readHubSpotTool(tool, {}, { accessToken: token, now, fetchImpl: async () => provider([row('101', { hs_meeting_title: 'Synthetic meeting', hs_meeting_start_time: '2026-10-30T15:00:00Z', hs_meeting_end_time: '2026-10-30T16:00:00Z', hs_meeting_outcome: 'SCHEDULED', hs_meeting_location: 'Office' })]) });
    assert.equal(meeting.records[0].scheduledAt, '2026-10-30T15:00:00.000Z'); assert.equal(meeting.records[0].endedAt, '2026-10-30T16:00:00.000Z'); assert.equal(meeting.records[0].status, 'Scheduled');
    assert.match(meeting.notice, /HubSpot CRM meeting/);
  }
});

test('ticket stage metadata supplies actual labels with short cache and safe fallback on metadata failure', async () => {
  let metadataCalls = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/tickets/search')) return provider([row('101', { subject: 'Synthetic ticket', hs_pipeline: 'support', hs_pipeline_stage: 'custom' })]);
    metadataCalls++; assert.equal(url, 'https://api.hubapi.com/crm/v3/pipelines/tickets');
    return new Response(JSON.stringify({ results: [{ id: 'support', stages: [{ id: 'custom', label: 'Waiting on customer' }] }] }));
  };
  const result = await readHubSpotTool('tickets', {}, { accessToken: token, now, fetchImpl });
  assert.equal(result.records[0].status, 'Waiting on customer');
  await readHubSpotTool('tickets', {}, { accessToken: token, now, fetchImpl }); assert.equal(metadataCalls, 1);
  const fallback = await readHubSpotTool('tickets', {}, { accessToken: token, now, fetchImpl: async url => url.endsWith('/tickets/search') ? provider([row('101', { hs_pipeline: 'support', hs_pipeline_stage: 'custom' })]) : new Response(null, { status: 403 }) });
  assert.equal(fallback.status, 'available'); assert.equal(fallback.records[0].status, 'Stage custom'); assert.match(fallback.notice, /stage labels are unavailable/);
});

test('CRM pagination is bounded at 500 records, deduplicated and reports upstream total and partial status', async () => {
  let calls = 0;
  const result = await readHubSpotTool('contacts', {}, { accessToken: token, now, fetchImpl: async () => {
    const start = calls++ * 100 + 1;
    return provider(Array.from({ length: 100 }, (_, i) => row(String(start + i))), 850, String(calls * 100));
  } });
  assert.equal(calls, 5); assert.equal(result.loadedCount, 500); assert.equal(result.total, 850); assert.equal(result.partial, true); assert.match(result.notice, /Local search and date filters/);
  let page = 0;
  const duplicates = await readHubSpotTool('contacts', {}, { accessToken: token, now, fetchImpl: async () => ++page === 1 ? provider([row('101')], 1, '1') : provider([row('101')], 1) });
  assert.equal(duplicates.loadedCount, 1); assert.equal(duplicates.partial, false);
});

test('malformed provider IDs, repeated cursors, wrong counts and oversized pages cannot look like complete results', async () => {
  for (const payload of [{ results: [row('../101')], total: 1 }, { results: [row('101')], total: -1 }, { results: Array.from({ length: 101 }, () => row('101')), total: 101 }, { results: [{}], total: 1 }]) {
    const result = await readHubSpotTool('contacts', {}, { accessToken: token, now, fetchImpl: async () => new Response(JSON.stringify(payload)) });
    assert.equal(result.status, 'unavailable'); assert.equal(result.loadedCount, 0);
  }
  let calls = 0;
  const repeated = await readHubSpotTool('contacts', {}, { accessToken: token, now, fetchImpl: async () => provider([row(String(++calls))], 10, '1') });
  assert.equal(repeated.status, 'unavailable'); assert.equal(calls, 2);
});

test('Inbox reads bounded thread metadata and selected plain-text history, never sends or exposes rich HTML/attachments', async () => {
  const list = await readHubSpotTool('inbox', {}, { accessToken: token, now, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.hubapi.com/conversations/v3/conversations/threads?limit=100&archived=false&sort=id'); assert.equal(options.method, 'GET');
    return provider([{ id: '123', inboxId: '42', status: 'OPEN', createdAt: '2026-10-29T09:00:00Z', latestMessageTimestamp: '2026-10-30T09:00:00Z', email: 'must-not-leak', arbitrary: 'must-not-leak' }]);
  } });
  assert.equal(list.status, 'available'); assert.equal(list.records[0].title, 'Conversation 123'); assert.equal(list.records[0].status, 'Open'); assert.equal(list.total, 1); assert.doesNotMatch(JSON.stringify(list), /must-not-leak/);
  const history = await readHubSpotTool('inbox', { threadId: '123' }, { accessToken: token, now, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.hubapi.com/conversations/v3/conversations/threads/123/messages?limit=100'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    return provider([{ id: 'message-uuid', text: 'Synthetic plain text', richText: '<script>must-not-leak</script>', attachments: [{ url: 'must-not-leak' }], createdAt: '2026-10-30T09:00:00Z', direction: 'INCOMING', type: 'MESSAGE', truncationStatus: 'TRUNCATED' }]);
  } });
  assert.equal(history.selectedThreadId, '123'); assert.deepEqual(history.records, []); assert.equal(history.messages[0].text, 'Synthetic plain text'); assert.equal(history.messages[0].truncated, true); assert.equal(history.messages[0].direction, 'Incoming'); assert.doesNotMatch(JSON.stringify(history), /must-not-leak/); assert.doesNotMatch(JSON.stringify(history.messages), /richText|attachments/);
});

test('Inbox opaque pagination cursors may contain long base64 and URL punctuation without changing provider authority', async () => {
  const cursor = `${'filter'.repeat(80)}+/==?&%`;
  let calls = 0;
  const result = await readHubSpotTool('inbox', {}, { accessToken: token, now, fetchImpl: async url => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.hubapi.com'); assert.equal(parsed.pathname, '/conversations/v3/conversations/threads');
    calls++; if (calls === 1) return provider([{ id: '123', status: 'OPEN' }], undefined, cursor);
    assert.equal(parsed.searchParams.get('after'), cursor); return provider([{ id: '124', status: 'OPEN' }]);
  } });
  assert.equal(result.status, 'available'); assert.equal(result.loadedCount, 2); assert.equal(result.partial, false); assert.equal(calls, 2);
});

test('Inbox unusable or repeated pagination preserves valid loaded threads with explicit incomplete history', async () => {
  for (const cursor of [{ unsupported: 'must-not-leak' }, 'a'.repeat(4097), 'invalid\ncontrol']) {
    const result = await readHubSpotTool('inbox', {}, { accessToken: token, now, fetchImpl: async () => provider([{ id: '123' }], undefined, cursor) });
    assert.equal(result.status, 'available'); assert.equal(result.partial, true); assert.equal(result.total, null); assert.equal(result.loadedCount, 1); assert.match(result.notice, /not the complete inbox/); assert.ok(result.paginationWarning.validationReason.startsWith('CURSOR_')); assert.doesNotMatch(JSON.stringify(result), /must-not-leak|invalid\\ncontrol/);
  }
  let calls = 0;
  const repeated = await readHubSpotTool('inbox', {}, { accessToken: token, now, fetchImpl: async () => { calls++; return provider([{ id: '123' }], undefined, 'same-cursor'); } });
  assert.equal(calls, 2); assert.equal(repeated.paginationWarning.validationReason, 'CURSOR_REPEATED'); assert.equal(repeated.loadedCount, 1); assert.equal(repeated.partial, true);
});

test('Inbox history enforces a total message response budget with honest partial history', async () => {
  let calls = 0;
  const result = await readHubSpotTool('inbox', { threadId: '123' }, { accessToken: token, now, fetchImpl: async () => {
    const start = calls++ * 50;
    return provider(Array.from({ length: 50 }, (_, i) => ({ id: `synthetic-${start + i}`, text: 'a'.repeat(20000) })), undefined, String(calls));
  } });
  assert.equal(result.status, 'available'); assert.equal(result.partial, true); assert.ok(result.loadedCount < 150); assert.ok(calls <= 3); assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength < 2.1 * 1024 * 1024);
});

test('provider permissions, rates, redirects, timeout and malformed JSON have safe distinct failures without retries', async () => {
  for (const [status, expected] of [[401, 'permission-required'], [403, 'permission-required'], [429, 'unavailable'], [500, 'unavailable'], [302, 'unavailable']]) {
    let calls = 0;
    const result = await readHubSpotTool('inbox', {}, { accessToken: token, now, fetchImpl: async () => { calls++; return new Response('secret-provider-body', { status, headers: { 'Retry-After': '120', Location: 'https://attacker.invalid' } }); } });
    assert.equal(result.status, expected); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(result), /secret-provider-body|attacker/); assert.deepEqual(result.requiredScopes, ['conversations.read']);
    assert.equal(result.error.providerStatus, status);
    if (status === 429) assert.equal(result.retryAfterSeconds, 120);
  }
  const timedOut = await readHubSpotTool('contacts', {}, { accessToken: token, now, timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('secret-error')), { once: true })) });
  assert.equal(timedOut.error.code, 'HUBSPOT_TIMEOUT');
  const malformed = await readHubSpotTool('contacts', {}, { accessToken: token, now, fetchImpl: async () => new Response('not JSON') }); assert.equal(malformed.error.code, 'HUBSPOT_RESPONSE_INVALID');
  let called = false; const missing = await readHubSpotTool('contacts', {}, { accessToken: '', now, fetchImpl: async () => { called = true; } }); assert.equal(called, false); assert.equal(missing.status, 'unavailable');
});

test('request boundary blocks anonymous, non-allowlisted, cross-origin, malformed, oversized and non-POST calls before provider access', async () => {
  let calls = 0;
  const readData = async () => { calls++; return {}; };
  const cases = [
    [request(), { ...deps, getUser: () => null, readData }, 401],
    [request(), { ...deps, authorizeUser: () => false, readData }, 403],
    [request('{}', { Origin: 'https://attacker.invalid' }), { ...deps, readData }, 403],
    [request('{}', { 'Content-Type': 'text/plain' }), { ...deps, readData }, 415],
    [request('[]'), { ...deps, readData }, 400],
    [request('not json'), { ...deps, readData }, 400],
    [request(' '.repeat(1025)), { ...deps, readData }, 413],
    [request('{"endpoint":"https://attacker.invalid"}'), { ...deps, readData }, 400],
    [request(undefined, {}, 'GET'), { ...deps, readData }, 405],
  ];
  for (const [req, options, status] of cases) { const result = await handleHubSpotToolRequest(req, 'contacts', options); assert.equal(result.status, status); assert.match(result.headers.get('Cache-Control'), /private, no-store/); }
  assert.equal(calls, 0);
  assert.equal((await handleHubSpotToolRequest(request(), 'constructor', { ...deps, readData })).status, 404); assert.equal(calls, 0);
});

test('successful read boundary passes only validated input, adds private headers and redacts unexpected errors', async () => {
  const result = await handleHubSpotToolRequest(request('{"threadId":"123"}'), 'inbox', { ...deps, readData: async (tool, input) => { assert.equal(tool, 'inbox'); assert.deepEqual(input, { threadId: '123' }); return { readOnly: true, retryAfterSeconds: 120 }; } });
  assert.equal(result.status, 200); assert.equal(result.headers.get('Retry-After'), '120'); assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(result.headers.get('Referrer-Policy'), 'no-referrer');
  const failed = await handleHubSpotToolRequest(request(), 'contacts', { ...deps, readData: async () => { throw Error('secret-backend-error'); } });
  assert.equal(failed.status, 502); assert.doesNotMatch(await failed.text(), /secret-backend-error/);
});
