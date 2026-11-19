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
