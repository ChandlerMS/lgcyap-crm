import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyInboxPages, mergeInboxPage, walkInboxPages } from '../app/inbox-pagination.mjs';
const page = (items, continuation = null, extra = {}) => ({ tool: 'inbox', status: 'available', archive: 'all', records: items, complete: continuation === null, continuation, ...extra });

test('Inbox loads past 500 records and deduplicates overlaps without falsely ending', async () => {
  let requests = 0, committed;
  const result = await walkInboxPages({ initial: emptyInboxPages(), input: { archive: 'all' }, signal: new AbortController().signal,
    request: async body => { assert.equal(body.continuation, requests ? `signed-${requests}` : undefined); const n = requests++; return page(Array.from({ length: 100 }, (_, i) => ({ id: String(n * 99 + i + 1) })), requests < 8 ? `signed-${requests}` : null); }, onPage: value => { committed = value; } });
  assert.equal(result.items.length, 793); assert.equal(requests, 8); assert.equal(result.complete, true); assert.equal(committed, result);
});
test('page failures retain committed rows and resume precisely without automatic retries', async () => {
  let state = emptyInboxPages(), calls = 0;
  await assert.rejects(walkInboxPages({ initial: state, input: { archive: 'all' }, signal: new AbortController().signal, request: async () => { if (calls++) throw Error('rate limited'); return page([{ id: '1' }], 'signed-next'); }, onPage: value => { state = value; } }), /rate limited/);
  assert.equal(calls, 2); assert.equal(state.continuation, 'signed-next'); assert.equal(state.items.length, 1);
  const resumed = await walkInboxPages({ initial: state, input: { archive: 'all' }, signal: new AbortController().signal, request: async body => { assert.equal(body.continuation, 'signed-next'); return page([{ id: '2' }]); }, onPage: () => {} });
  assert.equal(resumed.items.length, 2); assert.equal(resumed.complete, true);
});
test('pause prevents late data from committing, bounded runs retain a continuation', async () => {
  const controller = new AbortController(); let commits = 0;
  await walkInboxPages({ initial: emptyInboxPages(), input: { archive: 'all' }, signal: controller.signal, request: async () => { controller.abort(); return page([{ id: '1' }]); }, onPage: () => { commits++; } });
  assert.equal(commits, 0);
  let count = 0;
  const state = await walkInboxPages({ initial: emptyInboxPages(), input: { archive: 'all' }, signal: new AbortController().signal, maxPages: 2, request: async () => page([{ id: String(++count) }], `next-${count}`), onPage: () => {} });
  assert.equal(count, 2); assert.equal(state.continuation, 'next-2'); assert.equal(state.complete, false);
});
test('scope mismatches, contradictory completion and cursor cycles are rejected', async () => {
  for (const result of [page([], null, { archive: 'active' }), page([], 'cursor', { complete: true }), page([], null, { complete: undefined })]) assert.throws(() => mergeInboxPage(emptyInboxPages(), result, { archive: 'all' }));
  assert.throws(() => mergeInboxPage(emptyInboxPages(), page([], null, { selectedThreadId: 'other', messages: [] }), { archive: 'all', threadId: '1' }));
  let calls = 0;
  await assert.rejects(walkInboxPages({ initial: emptyInboxPages(), input: { archive: 'all' }, signal: new AbortController().signal, request: async () => page([{ id: String(++calls) }], calls === 2 ? 'b' : 'a'), onPage: () => {} }), /repeated/);
});
test('message pages merge by message ID and preserve full supplied text', () => {
  const text = 'x'.repeat(21000);
  const result = mergeInboxPage(emptyInboxPages(), page([], null, { selectedThreadId: '1', messages: [{ id: 'message-1', text }] }), { archive: 'all', threadId: '1' });
  assert.equal(result.items[0].text, text); assert.equal(result.complete, true);
});
