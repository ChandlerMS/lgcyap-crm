import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWorkspaceSearch } from '../lib/workspace-search.mjs';

const origin = 'https://workspace.example';
const user = { userId: 'u1', email: 'viewer@example.com' };
const groups = ['recruits', 'contract-agents', 'calls', 'meetings', 'inbox', 'help-desk', 'tickets'];
const search = (body, options = {}) => {
  const headers = new Headers({ origin, 'content-type': 'application/json' });
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return handleWorkspaceSearch(new Request(options.url ?? origin + '/api/workspace-search', {
    method: options.method ?? 'POST',
    headers,
    ...(options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), {
    getUser: async () => Object.hasOwn(options, 'user') ? options.user : user,
    editorEmails: 'viewer@example.com',
    allowedOrigin: origin,
    accessToken: 'fixture-token',
    hmacSecret: 'fixture continuation secret at least 32 characters',
    fetchImpl: options.fetchImpl ?? (() => { throw new Error('Unexpected provider access'); }),
    now: options.now,
  });
};

function fixture(handler = () => undefined) {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, body });
    const result = handler(url, body);
    if (result instanceof Response) return result;
    if (result) return Response.json(result);
    if (url.pathname.endsWith('/owners/')) return Response.json({
      results: url.searchParams.get('archived') === 'true' ? [] : [{ id: '7', email: user.email }],
    });
    return Response.json(body ? { results: [], total: 0 } : { results: [] });
  };
  return { requests, fetchImpl };
}

test('returns a private error before reading HubSpot on failed authorization or origin checks', async () => {
  let providerCalls = 0;
  const fetchImpl = () => { providerCalls++; throw new Error(); };
  for (const [options, status] of [
    [{ user: null }, 401],
    [{ user: { ...user, email: 'other@example.com' } }, 403],
    [{ headers: { origin: null } }, 403],
    [{ headers: { origin: 'https://hostile.example' } }, 403],
    [{ url: 'https://hostile.example/api/workspace-search' }, 403],
    [{ method: 'GET' }, 405],
  ]) {
    const result = await search({ query: 'needle' }, { ...options, fetchImpl });
    assert.equal(result.status, status);
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
  }
  assert.equal(providerCalls, 0);
});

test('rejects malformed, unknown, overlong, non-JSON and control-bearing input', async () => {
  for (const [input, options] of [
    ['{', {}], [{ query: 'x' }, {}], [{ query: 'x'.repeat(201) }, {}],
    [{ query: 'needle\n' }, {}], [{ query: 'needle\u0085' }, {}],
    [{ query: 'needle', endpoint: 'https://hostile.example' }, {}],
    [{ query: 'needle', continuation: null }, {}],
    [{ query: 'needle' }, { headers: { 'content-type': 'text/plain' } }],
    [' '.repeat(4100) + '{"query":"ok"}', {}],
    [{ query: 'needle' }, { headers: { 'content-length': '4097' } }],
  ]) assert.equal((await search(input, options)).status, 400);
});

test('searches all seven areas with fixed scopes, normalized query and safe links', async () => {
  const { requests, fetchImpl } = fixture((url, body) => {
    if (url.pathname.endsWith('/calls/search')) return { total: 1, results: [{ id: '21', properties: { hubspot_owner_id: '7', hs_call_title: 'Needle call' } }] };
    if (url.pathname.endsWith('/meetings/search')) return { total: 1, results: [{ id: '22', properties: { hubspot_owner_id: '7', hs_meeting_title: 'Needle meeting' } }] };
    if (url.pathname.endsWith('/2-64481801/search')) return { total: 1, results: [{ id: '23', properties: { full_name: 'Needle agent' } }] };
    if (url.pathname.endsWith('/tickets/search')) {
      const pipeline = body.filterGroups?.[0].filters[0].value;
      return { total: 1, results: [{ id: pipeline === '924992938' ? '25' : '24', properties: { hs_pipeline: pipeline ?? '0', subject: 'Needle ticket' } }] };
    }
    if (url.pathname.endsWith('/threads') && url.searchParams.get('archived') === 'false') return { results: [{ id: '26', subject: 'Needle conversation' }] };
  });
  const response = await search({ query: '  Needle  ' }, { fetchImpl });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const result = await response.json();
  assert.equal(result.query, 'Needle');
  assert.deepEqual(result.groups.map(group => group.id), groups);
  assert.ok(result.groups.every(group => group.status === 'available' && group.records.length === 1));
  assert.equal(result.groups[0].records[0].href, '#recruit/25');
  assert.equal(result.groups[4].records[0].href, '#inbox/thread/26');
  assert.equal(result.groups[1].records[0].href, 'https://app.hubspot.com/contacts/50894788/record/2-64481801/23');
  const searches = requests.filter(request => request.body);
  assert.equal(searches.length, 6);
  assert.ok(searches.every(({ body }) => body.query === 'Needle'));
  assert.deepEqual(searches.filter(({ url }) => url.pathname.endsWith('/tickets/search')).map(({ body }) => body.filterGroups?.[0].filters[0]), [
    { propertyName: 'hs_pipeline', operator: 'EQ', value: '924992938' },
    { propertyName: 'hs_pipeline', operator: 'EQ', value: '0' },
    undefined,
  ]);
  for (const tool of ['calls', 'meetings']) {
    assert.deepEqual(searches.find(({ url }) => url.pathname.endsWith('/' + tool + '/search')).body.filterGroups[0].filters,
      [{ propertyName: 'hubspot_owner_id', operator: 'IN', values: ['7'] }]);
  }
});

test('fails closed on foreign owners and unsafe provider record IDs', async () => {
  const { fetchImpl } = fixture((url) => {
    if (url.pathname.endsWith('/calls/search') || url.pathname.endsWith('/meetings/search')) return { total: 1, results: [{ id: '31', properties: { hubspot_owner_id: '8' } }] };
    if (url.pathname.endsWith('/2-64481801/search')) return { total: 1, results: [{ id: '../other', properties: {} }] };
  });
  const { groups: result } = await (await search({ query: 'needle' }, { fetchImpl })).json();
  for (const id of ['calls', 'meetings', 'contract-agents']) {
    const group = result.find(item => item.id === id);
    assert.equal(group.status, 'unavailable');
    assert.equal(group.partial, true);
    assert.deepEqual(group.records, []);
  }
});

test('bounds Inbox work and resumes message pages without skipping later threads', async () => {
  const { fetchImpl, requests } = fixture((url) => {
    if (url.pathname.endsWith('/threads') && url.searchParams.get('archived') === 'false') {
      return { results: [{ id: '41' }, { id: '42' }, { id: '43', subject: 'Needle thread' }] };
    }
    if (url.pathname.endsWith('/41/messages')) return { results: [{ id: 'm41', text: 'A Needle in a haystack.' }] };
    if (url.pathname.endsWith('/42/messages')) {
      const after = url.searchParams.get('after');
      if (after === '4') return { results: [{ id: 'match', text: 'Finally, a NEEDLE.' }] };
      const page = Number(after) || 0;
      return { results: [{ id: 'm' + page, text: 'Unrelated' }], paging: { next: { after: String(page + 1) } } };
    }
  });
  const first = await (await search({ query: 'needle' }, { fetchImpl })).json();
  let inbox = first.groups.find(group => group.id === 'inbox');
  assert.equal(inbox.partial, true);
  assert.ok(inbox.continuation);
  assert.deepEqual(inbox.records.map(row => row.id), ['41']);
  assert.ok(requests.filter(({ url }) => url.pathname.includes('/conversations/')).length < 8);
  const matches = ['41'];
  for (let attempt = 0; inbox.continuation && attempt < 5; attempt++) {
    const next = await (await search({ query: 'needle', continuation: inbox.continuation }, { fetchImpl })).json();
    assert.deepEqual(next.groups.map(group => group.id), ['inbox']);
    inbox = next.groups[0];
    matches.push(...inbox.records.map(row => row.id));
  }
  assert.deepEqual(matches, ['41', '42', '43']);
  assert.equal(inbox.partial, false);
  assert.deepEqual(requests.filter(({ url }) => url.pathname.endsWith('/42/messages')).map(({ url }) => url.searchParams.get('after')), [null, '1', '2', '3', '4']);
});

test('rejects modified, expired or differently bound cursors', async () => {
  const { fetchImpl } = fixture(url => url.pathname.endsWith('/threads') ? { results: [{ id: String(61 + Number(url.searchParams.get('after') ?? 0)) }], paging: { next: { after: String(1 + Number(url.searchParams.get('after') ?? 0)) } } } : undefined);
  const now = () => 1_000_000;
  const { groups: result } = await (await search({ query: 'needle' }, { fetchImpl, now })).json();
  const { continuation } = result.find(group => group.id === 'inbox');
  assert.ok(continuation);
  for (const [body, options] of [
    [{ query: 'needle', continuation: continuation.replace(/^./, 'X') }, {}],
    [{ query: 'other', continuation }, {}],
    [{ query: 'needle', continuation }, { user: { ...user, userId: 'u2' } }],
    [{ query: 'needle', continuation }, { now: () => 5_000_000 }],
  ]) assert.equal((await search(body, { now, ...options })).status, 400);
});

test('reports rate limits and preserves the availability of a successful area', async () => {
  const { fetchImpl, requests } = fixture((url, body) => {
    if (url.pathname.endsWith('/2-64481801/search')) return new Response('', { status: 429, headers: { 'Retry-After': '17' } });
    if (url.pathname.endsWith('/tickets/search') && body.filterGroups?.[0].filters[0].value === '924992938') {
      return { total: 30, results: [{ id: '25', properties: { hs_pipeline: '924992938', subject: 'Needle' } }] };
    }
    if (url.pathname.endsWith('/threads')) return new Response('', { status: 502 });
  });
  const response = await search({ query: 'needle' }, { fetchImpl });
  const { groups: result } = await response.json();
  assert.equal(result[0].status, 'available');
  assert.equal(result[0].partial, true);
  assert.equal(result[1].status, 'unavailable');
  assert.equal(result[1].partial, true);
  assert.equal(response.headers.get('retry-after'), '17');
  assert.equal(result.find(group => group.id === 'inbox').partial, true);
  assert.equal(requests.filter(request => request.body).length, 2);
});

test('keeps matches for verified owner IDs when the owner directory is incomplete', async () => {
  const { fetchImpl } = fixture(url => {
    if (url.pathname.endsWith('/owners/') && url.searchParams.get('archived') === 'true') return new Response(null, { status: 502 });
    if (url.pathname.endsWith('/calls/search')) return { total: 1, results: [{ id: '81', properties: { hubspot_owner_id: '7', hs_call_title: 'Needle call' } }] };
  });
  const { groups: result } = await (await search({ query: 'needle' }, { fetchImpl })).json();
  const calls = result.find(group => group.id === 'calls');
  assert.equal(calls.status, 'available');
  assert.equal(calls.partial, true);
  assert.deepEqual(calls.records.map(row => row.id), ['81']);
});

test('does not claim complete coverage when HubSpot truncated an unmatched Inbox message', async () => {
  const { fetchImpl } = fixture(url => {
    if (url.pathname.endsWith('/threads') && url.searchParams.get('archived') === 'false') return { results: [{ id: '91' }] };
    if (url.pathname.endsWith('/91/messages')) return { results: [{ id: 'm91', text: 'Body excerpt', truncationStatus: 'TRUNCATED' }] };
  });
  const { groups: result } = await (await search({ query: 'needle' }, { fetchImpl })).json();
  const inbox = result.find(group => group.id === 'inbox');
  assert.equal(inbox.status, 'available');
  assert.equal(inbox.partial, true);
  assert.equal(inbox.continuation, undefined);
  assert.deepEqual(inbox.records, []);
});
