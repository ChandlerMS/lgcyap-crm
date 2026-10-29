import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresLedger, saveRecruit, validateWriteInput } from '../lib/hubspot-write.mjs';
import { PIPELINE_ID } from '../lib/recruiting-config.mjs';

const migration = await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8');
const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const before = '2026-10-29T12:00:00.000Z';
const after = '2026-10-29T12:01:00.000Z';
const clock = () => Date.parse(after);
async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  return { db, ledger: createPostgresLedger(db) };
}

test('Postgres migration is repeatable and enforces one pending ticket with metadata-only columns', async () => {
  const { db, ledger } = await fixture();
  try {
    await db.exec(migration);
    const first = { userId: 'synthetic-user', requestId: firstId, ticketId: '101', hash: 'hash-only', now: clock() };
    assert.deepEqual(await ledger.claim(first), { acquired: true });
    assert.deepEqual(await ledger.claim(first), { acquired: false, hash: 'hash-only', status: 'pending' });
    assert.deepEqual(await ledger.claim({ ...first, requestId: secondId }), { acquired: false, status: 'busy' });
    assert.equal(await ledger.finish({ ...first, status: 'saved' }), true);
    assert.equal(await ledger.finish({ ...first, status: 'failed' }), false);
    assert.deepEqual(await ledger.claim({ ...first, requestId: secondId }), { acquired: true });
    const third = { ...first, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', now: clock() + 120001 };
    assert.deepEqual(await ledger.claim(third), { acquired: true });
    assert.equal((await ledger.claim({ ...first, requestId: secondId, now: third.now })).status, 'uncertain');
    assert.equal(await ledger.finish({ ...first, requestId: secondId, status: 'saved' }), false);
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recruit_write_requests' ORDER BY ordinal_position");
    assert.deepEqual(columns.rows.map(row => row.column_name), ['user_id', 'request_id', 'ticket_id', 'payload_hash', 'status', 'created_at', 'updated_at']);
    await assert.rejects(db.query("UPDATE recruit_write_requests SET status = 'unexpected'"), /check constraint/);
  } finally { await db.close(); }
});

test('separate ledger instances cannot concurrently claim the same ticket', async () => {
  const { db } = await fixture();
  try {
    const first = { userId: 'user-one', requestId: firstId, ticketId: '101', hash: 'first-hash', now: clock() };
    const second = { ...first, userId: 'user-two', requestId: secondId, hash: 'second-hash' };
    const results = await Promise.all([createPostgresLedger(db).claim(first), createPostgresLedger(db).claim(second)]);
    assert.equal(results.filter(result => result.acquired).length, 1);
    assert.deepEqual(results.find(result => !result.acquired), { acquired: false, status: 'busy' });
    const pending = await db.query("SELECT count(*)::integer AS count FROM recruit_write_requests WHERE status = 'pending'");
    assert.equal(pending.rows[0].count, 1);
  } finally { await db.close(); }
});

function record(office = 'orlando', modified = before) {
  return { id: '101', properties: {
    hs_pipeline: PIPELINE_ID, hs_pipeline_stage: '1416243212', hs_lastmodifieddate: modified,
    recruit_name: 'Synthetic Recruit', subject: 'Recruiting: Synthetic Recruit', orientation_office: office,
  } };
}
function input(office = 'miami') {
  return validateWriteInput('101', { requestId: firstId, expectedUpdatedAt: before, expectedValues: { orientation_office: 'orlando' }, changes: { orientation_office: office } });
}
function json(body) { return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }); }

test('saved requests survive a new ledger instance and return fresh reads without another PATCH', async () => {
  const { db, ledger } = await fixture();
  try {
    const calls = [];
    const replies = [record(), { id: '101' }, record('miami', after), record('tampa', after)];
    const fetchImpl = async (_url, options) => { calls.push(options.method); return json(replies.shift()); };
    const options = { userId: 'synthetic-user', accessToken: 'synthetic-provider-token', ledger, fetchImpl, now: clock };
    assert.equal((await saveRecruit(input(), options)).status, 'saved');
    const replay = await saveRecruit(input(), { ...options, ledger: createPostgresLedger(db) });
    assert.equal(replay.replayed, true);
    assert.equal(replay.recruit.office, 'Tampa');
    assert.deepEqual(calls, ['GET', 'PATCH', 'GET', 'GET']);
    await assert.rejects(saveRecruit(input('tampa'), options), { code: 'REQUEST_ID_REUSED' });
    assert.equal(calls.length, 4);
  } finally { await db.close(); }
});

test('ambiguous saves remain blocked after a new function instance uses the same database', async () => {
  const { db, ledger } = await fixture();
  try {
    const calls = [];
    const fetchImpl = async (_url, options) => {
      calls.push(options.method);
      if (options.method === 'GET') return json(record());
      throw new Error('synthetic connection interruption');
    };
    const options = { userId: 'synthetic-user', accessToken: 'synthetic-provider-token', ledger, fetchImpl, now: clock };
    await assert.rejects(saveRecruit(input(), options), { code: 'SAVE_UNCERTAIN' });
    await assert.rejects(saveRecruit(input(), { ...options, ledger: createPostgresLedger(db) }), { code: 'SAVE_UNCERTAIN' });
    assert.deepEqual(calls, ['GET', 'PATCH']);
    assert.equal((await db.query('SELECT status FROM recruit_write_requests')).rows[0].status, 'uncertain');
  } finally { await db.close(); }
});
