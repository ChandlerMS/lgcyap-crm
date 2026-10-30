import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeInboxCursor, readInboxPage, validateInboxInput } from '../lib/hubspot-inbox.mjs';

const context = { userId: 'synthetic-user', hmacSecret: 'synthetic-inbox-secret-at-least-32-characters', accessToken: 'synthetic-inbox-token', now: () => Date.parse('2026-10-30T12:00:00Z') };
const json = (results = [], after) => new Response(JSON.stringify({ results, ...(after === undefined ? {} : { paging: { next: { after } } }) }));
const thread = id => ({ id, status: 'OPEN', createdAt: '2026-10-29T12:00:00Z' });

test('provider cursors decode exactly once and preserve literal plus and percent data', () => {
  assert.equal(decodeInboxCursor('abc%3D%3D'), 'abc==');
  assert.equal(decodeInboxCursor('abc%2B+%25'), 'abc++%');
  assert.equal(decodeInboxCursor('abc%253D'), 'abc%3D');
  assert.throws(() => decodeInboxCursor('bad%zz')); assert.throws(() => decodeInboxCursor({ bad: true }));
});

test('signed continuation fixes encoded cursor transport and reads beyond 500 records without following links', async () => {
  let calls = 0, continuation; const loaded = new Set();
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url); calls++; assert.equal(parsed.origin, 'https://api.hubapi.com'); assert.equal(parsed.pathname, '/conversations/v3/conversations/threads'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(parsed.searchParams.get('archived'), 'false');
    if (calls > 1) assert.equal(parsed.searchParams.get('after'), `page${calls - 1}==+%`);
    return json(Array.from({ length: 100 }, (_, i) => thread(String((calls - 1) * 100 + i + 1))), calls < 7 ? `page${calls}%3D%3D%2B%25` : undefined);
  };
  let result;
  do {
    result = await readInboxPage({ archive: 'active', ...(continuation ? { continuation } : {}) }, { ...context, fetchImpl });
    result.records.forEach(row => loaded.add(row.id)); continuation = result.continuation;
  } while (continuation);
  assert.equal(calls, 7); assert.equal(loaded.size, 700); assert.equal(result.complete, true); assert.equal(result.partial, false);
});

test('All walks active and archived independently and returns archive context consistently', async () => {
  const phases = []; const fetchImpl = async url => { phases.push(new URL(url).searchParams.get('archived')); return json([thread(phases.length === 1 ? '101' : '102')]); };
  const active = await readInboxPage({}, { ...context, fetchImpl }); assert.equal(active.archive, 'all'); assert.equal(active.complete, false); assert.ok(active.continuation);
  const archived = await readInboxPage({ archive: 'all', continuation: active.continuation }, { ...context, fetchImpl });
  assert.deepEqual(phases, ['false', 'true']); assert.equal(archived.complete, true); assert.equal(archived.archive, 'all'); assert.equal(archived.walkId, active.walkId);
});

test('continuations reject tampering, expiry, other users, archives, threads and credentials before provider access', async () => {
  const first = await readInboxPage({ archive: 'active' }, { ...context, fetchImpl: async () => json([thread('101')], 'next%3D') });
  const variants = [
    [{ archive: 'archived', continuation: first.continuation }, context],
    [{ archive: 'active', threadId: '123', continuation: first.continuation }, context],
    [{ archive: 'active', continuation: first.continuation + 'x' }, context],
    [{ archive: 'active', continuation: first.continuation }, { ...context, userId: 'other-user' }],
    [{ archive: 'active', continuation: first.continuation }, { ...context, accessToken: 'other-token' }],
    [{ archive: 'active', continuation: first.continuation }, { ...context, now: () => context.now() + 1800001 }],
  ];
  for (const [input, options] of variants) { let called = false; await assert.rejects(readInboxPage(input, { ...options, fetchImpl: async () => { called = true; } })); assert.equal(called, false); }
});

test('messages keep complete plain text beyond 20000 characters and disclose provider truncation', async () => {
  const body = 'a'.repeat(35000);
  const result = await readInboxPage({ threadId: '123', archive: 'active' }, { ...context, fetchImpl: async (url, options) => { assert.equal(new URL(url).pathname, '/conversations/v3/conversations/threads/123/messages'); assert.equal(options.cache, 'no-store'); return json([{ id: 'synthetic-message', text: body, truncationStatus: 'TRUNCATED', createdAt: '2026-10-30T12:00:00Z', richText: 'must-not-leak', attachments: ['must-not-leak'] }]); } });
  assert.equal(result.messages[0].text.length, 35000); assert.equal(result.messages[0].truncated, true); assert.equal(result.complete, true); assert.equal(result.archive, 'active'); assert.doesNotMatch(JSON.stringify(result.messages), /must-not-leak|attachments|richText/);
});

test('All message history includes independent active and archived chains', async () => {
  const phases = [];
  const fetchImpl = async url => { phases.push(new URL(url).searchParams.get('archived')); return json([{ id: `synthetic-message-${phases.length}`, text: 'Synthetic message' }]); };
  const active = await readInboxPage({ threadId: '123', archive: 'all' }, { ...context, fetchImpl });
  assert.equal(active.complete, false); assert.equal(active.phase, 'active');
  const archived = await readInboxPage({ threadId: '123', archive: 'all', continuation: active.continuation }, { ...context, fetchImpl });
  assert.deepEqual(phases, ['false', 'true']); assert.equal(archived.complete, true); assert.equal(archived.phase, 'archived'); assert.equal(archived.archive, 'all'); assert.equal(archived.selectedThreadId, '123');
});

test('observed empty unchanged-position bookmark exhausts the current active or archived phase', async () => {
  const first = await readInboxPage({ archive: 'active' }, { ...context, fetchImpl: async () => json([thread('101')], 'next%3D') });
  const second = await readInboxPage({ archive: 'active', continuation: first.continuation }, { ...context, fetchImpl: async () => json([], 'next%3D') });
  assert.equal(second.complete, true); assert.equal(second.partial, false); assert.equal(second.continuation, null); assert.equal(second.paginationWarning, undefined);
  for (const input of [{ archive: 'all' }, { archive: 'all', threadId: '123' }]) {
    const first = await readInboxPage(input, { ...context, fetchImpl: async () => json(input.threadId ? [{ id: 'message-a', text: 'Synthetic' }] : [thread('101')], 'active%3D') });
    const activeEnd = await readInboxPage({ ...input, continuation: first.continuation }, { ...context, fetchImpl: async url => { assert.equal(new URL(url).searchParams.get('after'), 'active='); assert.equal(new URL(url).searchParams.get('archived'), 'false'); return json([], 'active%3D'); } });
    assert.equal(activeEnd.complete, false); assert.ok(activeEnd.continuation); assert.equal(activeEnd.paginationWarning, undefined);
    const archived = await readInboxPage({ ...input, continuation: activeEnd.continuation }, { ...context, fetchImpl: async url => { assert.equal(new URL(url).searchParams.get('archived'), 'true'); assert.equal(new URL(url).searchParams.get('after'), null); return json(input.threadId ? [{ id: 'message-b', text: 'Synthetic archive' }] : [thread('102')], 'archived%3D'); } });
    const archivedEnd = await readInboxPage({ ...input, continuation: archived.continuation }, { ...context, fetchImpl: async () => json([], 'archived%3D') });
    assert.equal(archivedEnd.complete, true); assert.equal(archivedEnd.partial, false); assert.equal(archivedEnd.continuation, null);
  }
});

test('nonempty repeated pages block and empty pages with a new cursor keep reading', async () => {
  const first = await readInboxPage({ archive: 'active' }, { ...context, fetchImpl: async () => json([thread('101')], 'next%3D') });
  const repeated = await readInboxPage({ archive: 'active', continuation: first.continuation }, { ...context, fetchImpl: async () => json([thread('101')], 'next%3D') });
  assert.equal(repeated.complete, false); assert.equal(repeated.paginationWarning.code, 'CURSOR_REPEATED');
  const advance = await readInboxPage({ archive: 'active', continuation: first.continuation }, { ...context, fetchImpl: async () => json([], 'new%3D') });
  assert.equal(advance.complete, false); assert.ok(advance.continuation); assert.equal(advance.paginationWarning, undefined);
});

test('rate or transport failures retain a signed same-page resume and never retry automatically', async () => {
  let calls = 0;
  const failed = await readInboxPage({ archive: 'active' }, { ...context, fetchImpl: async () => { calls++; return new Response('private-provider-body', { status: 429, headers: { 'Retry-After': '120' } }); } });
  assert.equal(calls, 1); assert.equal(failed.status, 'unavailable'); assert.equal(failed.retryAfterSeconds, 120); assert.ok(failed.continuation); assert.equal(failed.complete, false); assert.doesNotMatch(JSON.stringify(failed), /private-provider-body/);
  const resumed = await readInboxPage({ archive: 'active', continuation: failed.continuation }, { ...context, fetchImpl: async url => { assert.equal(new URL(url).searchParams.get('after'), null); return json([thread('101')]); } });
  assert.equal(resumed.complete, true); assert.equal(resumed.walkId, failed.walkId);
});

test('input and page limits preserve the fixed provider contract', async () => {
  for (const input of [{ archive: 'everything' }, { endpoint: 'https://attacker.invalid' }, { threadId: '../123' }, { continuation: 'a'.repeat(7401) }, { query: 'anything' }]) assert.throws(() => validateInboxInput(input));
  const large = await readInboxPage({ archive: 'active' }, { ...context, fetchImpl: async () => new Response('a'.repeat(2 * 1024 * 1024 + 1)) }); assert.equal(large.complete, false); assert.equal(large.error.code, 'HUBSPOT_RESPONSE_TOO_LARGE');
});
