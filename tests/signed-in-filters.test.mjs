import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSignedIn, signedInFilters } from '../lib/signed-in-filters.mjs';
const rows = [{ ticketId: '1', name: 'Zoë Smith', office: 'miami' }, { ticketId: '2', name: 'Alice Smith', office: 'orlando' }, { ticketId: '3', name: 'Bob Jones', office: 'miami' }];
const reviews = { 1: { status: 'approved' }, 2: { status: 'denied' } };
test('signed-in controls combine office, case-insensitive name and review while sorting a copy', () => {
  assert.deepEqual(filterSignedIn(rows, { office: 'miami', name: 'SMITH', review: 'approved' }, reviews).map(row => row.ticketId), ['1']);
  assert.deepEqual(filterSignedIn(rows, { review: 'denied' }, reviews).map(row => row.ticketId), ['2']);
  assert.deepEqual(filterSignedIn(rows, { review: 'pending' }, reviews).map(row => row.ticketId), ['3']);
  assert.deepEqual(filterSignedIn(rows, { sort: 'name-asc' }, reviews).map(row => row.ticketId), ['2', '3', '1']);
  assert.deepEqual(filterSignedIn(rows, { sort: 'name-desc' }, reviews).map(row => row.ticketId), ['1', '3', '2']);
  assert.deepEqual(rows.map(row => row.ticketId), ['1', '2', '3']);
  assert.equal(filterSignedIn(rows, { review: 'pending' }, reviews, false).length, 0);
});
test('invalid signed-in filters fail closed', () => {
  for (const input of [{ review: 'invalid' }, { sort: 'invalid' }, { name: 'x'.repeat(201) }]) assert.throws(() => signedInFilters(input));
});
