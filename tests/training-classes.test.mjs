import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateClass, easternLocalToIso, easternInput, trainingClassError } from '../lib/training-classes.mjs';
import { listClasses, saveClass, cancelClass, TRAINING_SCHEMA } from '../db/training-classes.mjs';
const input = { createId: 'd261faed-f97c-45eb-86fb-c083aa23dc72', name: 'New agent training', startAt: '2026-12-01T14:00:00.000Z', endAt: '2026-12-01T16:00:00.000Z', trainer: 'Sarah', location: 'Online', meetingUrl: 'https://example.test/meeting', notes: 'Bring questions.' };
test('class validation bounds input, rejects unsafe links and requires ordered real timestamps', () => {
  assert.equal(validateClass({ ...input, name: '  Training  ' }).name, 'Training');
  for (const patch of [{ name: '' }, { name: 'a'.repeat(161) }, { endAt: input.startAt }, { startAt: '2026-02-30T14:00:00.000Z' }, { meetingUrl: 'javascript:alert(1)' }, { meetingUrl: 'https://user:password@example.test/' }, { notes: 'a'.repeat(4001) }, { trainer: '\0' }]) assert.throws(() => validateClass({ ...input, ...patch }), e => e.status === 400);
});
test('Eastern inputs are independent of the device timezone and handle DST gaps and repeats explicitly', () => {
  assert.equal(easternLocalToIso('2026-12-01T09:00'), input.startAt);
  assert.equal(easternLocalToIso('2026-07-01T09:00'), '2026-07-01T13:00:00.000Z');
  assert.throws(() => easternLocalToIso('2027-03-14T02:30'), /does not exist/);
  assert.throws(() => easternLocalToIso('2026-02-30T09:00'));
  assert.equal(easternLocalToIso('2026-11-01T01:30', 'earlier'), '2026-11-01T05:30:00.000Z');
  assert.equal(easternLocalToIso('2026-11-01T01:30', 'later'), '2026-11-01T06:30:00.000Z');
  assert.equal(easternInput(input.startAt), '2026-12-01T09:00');
  assert.equal(trainingClassError(new Error('database secret')).status, 503);
  assert.doesNotMatch(trainingClassError(new Error('database secret')).error, /secret/);
});
test('Postgres persists creation, edits, cancellation and actor stamps; stale or canceled edits cannot overwrite records', async () => {
  const db = new PGlite();
  try {
    assert.equal(TRAINING_SCHEMA, await readFile(new URL('../migrations/0014_training_classes.sql', import.meta.url), 'utf8'));
    await db.exec(TRAINING_SCHEMA); await db.exec(TRAINING_SCHEMA);
    assert.deepEqual(await listClasses(db), []);
    const created = await saveClass(input, 'one@example.test', db);
    assert.equal(created.id, input.createId);
    const replay = await saveClass(input, 'one@example.test', db);
    assert.equal(replay.id, created.id); assert.equal((await listClasses(db)).length, 1);
    await assert.rejects(saveClass({ ...input, name: 'Different create' }, 'one@example.test', db), e => e.status === 409);
    assert.equal(created.status, 'scheduled'); assert.equal(created.version, 1);
    const edited = await saveClass({ ...input, id: created.id, version: 1, name: 'Updated' }, 'two@example.test', db);
    assert.equal(edited.name, 'Updated'); assert.equal(edited.version, 2);
    await assert.rejects(saveClass({ ...input, id: created.id, version: 1 }, 'one@example.test', db), e => e.status === 409);
    const canceled = await cancelClass({ id: created.id, version: 2 }, 'one@example.test', db);
    assert.equal(canceled.status, 'canceled'); assert.equal(canceled.version, 3);
    await assert.rejects(saveClass({ ...input, id: created.id, version: 3 }, 'one@example.test', db), e => e.status === 409);
    assert.equal((await listClasses(db))[0].status, 'canceled');
    const stored = (await db.query('SELECT created_by, updated_by FROM training_classes')).rows[0];
    assert.deepEqual(stored, { created_by: 'one@example.test', updated_by: 'one@example.test' });
  } finally { await db.close(); }
});
