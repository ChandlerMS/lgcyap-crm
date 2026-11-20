import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRecruitRows } from '../app/recruit-list-view.mjs';

test('recruit sorting is natural, stable and does not mutate the loaded cohort', () => {
  const rows = [{ id:'a',name:'Test 10' },{ id:'b',name:'test 2' },{ id:'c',name:'TEST 2' },{ id:'d',name:'' }];
  assert.deepEqual(sortRecruitRows(rows).map(r=>r.id), ['b','c','a','d']);
  assert.deepEqual(sortRecruitRows(rows,{field:'name',direction:'desc'}).map(r=>r.id), ['a','b','c','d']);
  assert.deepEqual(rows.map(r=>r.id), ['a','b','c','d']);
});
test('stage age sorts by elapsed time while absent dates remain last', () => {
  const rows = [{id:'old',enteredStageAt:'2026-10-01T12:00:00Z'},{id:'new',enteredStageAt:'2026-10-30T12:00:00Z'},{id:'missing',enteredStageAt:null}];
  assert.deepEqual(sortRecruitRows(rows,{field:'timeInStage',direction:'asc'}).map(r=>r.id), ['new','old','missing']);
  assert.deepEqual(sortRecruitRows(rows,{field:'timeInStage',direction:'desc'}).map(r=>r.id), ['old','new','missing']);
});

test('date added sorts chronologically in either direction with unknown dates last', () => {
  const rows = [{ id: 'new', createdAt: '2026-11-01T01:00:00Z' }, { id: 'missing' }, { id: 'old', createdAt: '2026-02-01T01:00:00Z' }, { id: 'invalid', createdAt: 'invalid' }];
  assert.deepEqual(sortRecruitRows(rows, { field: 'createdAt', direction: 'asc' }).map(r => r.id), ['old', 'new', 'missing', 'invalid']);
  assert.deepEqual(sortRecruitRows(rows, { field: 'createdAt', direction: 'desc' }).map(r => r.id), ['new', 'old', 'missing', 'invalid']);
});

test('stage and office columns sort in both directions', () => {
  const rows = [{ id: 'b', stage: 'Offer', office: 'Tampa' }, { id: 'a', stage: 'Hiring Event', office: 'Orlando' }, { id: 'unknown' }];
  for (const field of ['stage', 'office']) {
    assert.deepEqual(sortRecruitRows(rows, { field, direction: 'asc' }).map(r => r.id), ['a', 'b', 'unknown']);
    assert.deepEqual(sortRecruitRows(rows, { field, direction: 'desc' }).map(r => r.id), ['b', 'a', 'unknown']);
  }
});
