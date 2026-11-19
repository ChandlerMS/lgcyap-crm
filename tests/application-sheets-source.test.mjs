import test from 'node:test';
import assert from 'node:assert/strict';
import { readApplications, parseApplicationNote } from '../lib/applications.mjs';
const note = answer => `<p><strong>Agent application (v3.1) submitted online</strong></p><p><strong>Your information</strong></p><ul><li><strong>Full legal name</strong><br>Synthetic Applicant</li><li><strong>Long answer</strong><br>${answer}</li></ul>`;
const record = (id, answer = 'Synthetic') => ({ id: String(id), properties: { hs_note_body: note(answer), hs_timestamp: '2026-11-19T13:00:00Z' } });
function source({ count = 1, terminalEarly = false, batchError = false, missingLinks = false, answer = 'Synthetic' } = {}) {
  const queries = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body), path = new URL(url).pathname;
    if (path.endsWith('/notes/search')) {
      const filters = body.filterGroups[0].filters;
      if (filters.some(filter => filter.propertyName === 'hs_attachment_ids')) return Response.json({ total: 0, results: [] });
      queries.push(body);
      const cursor = filters.find(filter => filter.propertyName === 'hs_object_id' && filter.operator === 'GT')?.value ?? body.after ?? 0;
      const start = Number(cursor), remaining = count - start;
      const take = Math.min(100, Math.max(0, remaining));
      return Response.json({ total: remaining, results: Array.from({ length: terminalEarly ? 1 : take }, (_, i) => record(start + i + 1, answer)), ...(remaining > take && !terminalEarly ? { paging: { next: { after: String(take) } } } : {}) });
    }
    if (path.includes('/associations/')) return Response.json({ ...(batchError ? { status: 'PENDING', errors: [{ message: 'synthetic failure' }], numErrors: 1 } : { status: 'COMPLETE' }), results: missingLinks ? [] : body.inputs.map(({ id }) => ({ from: { id }, to: [] })) });
    throw new Error('Unexpected path');
  };
  return { fetchImpl, queries };
}
test('strict Sheets source reads beyond the dashboard cap using ID keysets', async () => {
  const fake = source({ count: 2101 });
  const report = await readApplications({ accessToken: 'synthetic', fetchImpl: fake.fetchImpl, strictComplete: true });
  assert.equal(report.partial, false);
  assert.equal(report.applications.length, 2101);
  assert.equal(fake.queries.length, 22);
  assert.ok(fake.queries[1].filterGroups[0].filters.some(filter => filter.propertyName === 'hs_object_id' && filter.value === '100'));
});
test('strict Sheets source rejects premature terminal and incomplete association batches', async () => {
  for (const options of [{ count: 5, terminalEarly: true }, { batchError: true }, { missingLinks: true }]) {
    const fake = source(options);
    await assert.rejects(readApplications({ accessToken: 'synthetic', fetchImpl: fake.fetchImpl, strictComplete: true }));
  }
});
test('Sheets retains longer answers while the dashboard keeps its display bound', async () => {
  const answer = 'a'.repeat(4500);
  assert.equal(parseApplicationNote(note(answer)).sections[0].rows[1].value.length, 4000);
  const report = await readApplications({ accessToken: 'synthetic', fetchImpl: source({ answer }).fetchImpl, strictComplete: true });
  assert.equal(report.applications[0].sections[0].rows[1].value, answer);
});
