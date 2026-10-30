import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresLedger } from '../lib/hubspot-write.mjs';

const migration = await readFile(new URL('../migrations/0001_recruiting_ledger.sql', import.meta.url), 'utf8');
const clock = Date.parse('2026-10-30T15:00:00Z');
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];

test('real SQL ledger accepts object-qualified IDs without colliding with other objects or recruiting tickets', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    const ledger = createPostgresLedger(db);
    const rows = ['contacts:101', 'meetings:101', '101'].map((ticketId, index) => ({ userId: 'synthetic-user', requestId: ids[index], ticketId, hash: `hash-${index}`, now: clock }));
    const results = await Promise.all(rows.map(row => ledger.claim(row)));
    assert.equal(results.every(result => result.acquired), true);
    const pending = await db.query("SELECT ticket_id FROM recruit_write_requests WHERE status='pending' ORDER BY ticket_id");
    assert.deepEqual(pending.rows.map(row => row.ticket_id), ['101', 'contacts:101', 'meetings:101']);
    const sharedRecruitingLock = await createPostgresLedger(db).claim({ ...rows[2], userId: 'another-user', requestId: ids[0], hash: 'other-payload' });
    assert.deepEqual(sharedRecruitingLock, { acquired: false, status: 'busy' });
  } finally { await db.close(); }
});

test('real SQL conflicts preserve request hashes and return no acquired claim to a different payload or object', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    const ledger = createPostgresLedger(db);
    const first = { userId: 'synthetic-user', requestId: ids[0], ticketId: 'contacts:101', hash: 'original-tool-payload-hmac', now: clock };
    assert.deepEqual(await ledger.claim(first), { acquired: true });
    assert.deepEqual(await createPostgresLedger(db).claim({ ...first, ticketId: 'meetings:101', hash: 'different-tool-payload-hmac' }), { acquired: false, hash: first.hash, status: 'pending' });
    assert.equal(await ledger.finish({ ...first, status: 'saved' }), true);
    assert.deepEqual(await createPostgresLedger(db).claim(first), { acquired: false, hash: first.hash, status: 'saved' });
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM recruit_write_requests')).rows[0].count, 1);
  } finally { await db.close(); }
});
