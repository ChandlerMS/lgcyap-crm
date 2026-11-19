import test from 'node:test';
import assert from 'node:assert/strict';
import { completeNoteLinks } from '../lib/complete-note-links.mjs';
test('continued association rows preserve all linked ticket IDs and reject repeated cursors', async () => {
  const initial = { status: 'COMPLETE', results: [{ from: { id: '1' }, to: [{ toObjectId: '10' }], paging: { next: { after: 'page2' } } }] };
  const links = await completeNoteLinks(['1'], initial, async (id, after) => {
    assert.equal(id, '1');
    return after === 'page2' ? { results: [{ toObjectId: '20' }], paging: { next: { after: 'page3' } } } : { results: [{ toObjectId: '30' }] };
  });
  assert.deepEqual(links.get('1'), ['10', '20', '30']);
  await assert.rejects(completeNoteLinks(['1'], initial, async () => ({ results: [{ toObjectId: '20' }], paging: { next: { after: 'page2' } } })), /incomplete/i);
});

test('notes HubSpot reports as having no associations are re-read one at a time, and other errors are refused', async () => {
  const none = id => ({ status: 'error', category: 'OBJECT_NOT_FOUND', subCategory: 'crm.associations.NO_ASSOCIATIONS_FOUND', context: { fromObjectId: [id] }, message: `No ticket is associated with note ${id}.` });
  const payload = { status: 'COMPLETE', results: [{ from: { id: '1' }, to: [{ toObjectId: '10' }] }], numErrors: 1, errors: [none('2')] };
  const reads = [];
  const links = await completeNoteLinks(['1', '2'], payload, async (id, after) => { reads.push([id, after]); return { results: [] }; });
  assert.deepEqual(reads, [['2', null]], 'the unlinked note is confirmed empty by its own read');
  assert.deepEqual([...links], [['1', ['10']], ['2', []]]);
  const linkedAfterAll = await completeNoteLinks(['1', '2'], payload, async () => ({ results: [{ toObjectId: '20' }] }));
  assert.deepEqual(linkedAfterAll.get('2'), ['20'], 'an individual read that finds a link wins over the batch error');
  const refuse = async (body, message) => assert.rejects(completeNoteLinks(['1', '2'], body, async () => ({ results: [] })), error => error.code === 'HUBSPOT_ASSOCIATIONS_INCOMPLETE', message);
  await refuse({ ...payload, errors: [{ status: 'error', category: 'RATE_LIMITS', message: 'Too many requests' }] }, 'other error kinds are refused');
  await refuse({ ...payload, errors: [none('1')] }, 'an error naming a returned note is refused');
  await refuse({ ...payload, errors: [none('3')] }, 'an error naming an unrequested note is refused');
  await refuse({ ...payload, errors: [{ category: 'OBJECT_NOT_FOUND' }] }, 'an error that names no note is refused');
  const byMessage = await completeNoteLinks(['1', '2'], { ...payload, errors: [{ category: 'OBJECT_NOT_FOUND', message: 'No contact is associated with note 2.' }] }, async () => ({ results: [] }));
  assert.deepEqual(byMessage.get('2'), [], 'the note can be named by the message alone');
  await refuse({ ...payload, numErrors: 2 }, 'an error count that does not match the listed errors is refused');
  await refuse({ ...payload, status: 'PENDING' }, 'an unfinished batch is refused');
  await assert.rejects(completeNoteLinks(['1', '2'], payload, async () => { throw Object.assign(new Error('x'), { code: 'HUBSPOT_UNAVAILABLE' }); }), /x/, 'a failed individual read still fails the sync');
});
