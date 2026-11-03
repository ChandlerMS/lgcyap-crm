import test from 'node:test';
import assert from 'node:assert/strict';
import { recruitSubmissionState } from '../app/recruit-intake-import.mjs';

const valid = { firstName: 'Avery', lastName: 'Example', phone: '4075550123', email: '', recruitingPath: 'genpop' };
const entry = (values = {}, status = 'draft') => ({ status, values: { firstName: '', lastName: '', phone: '', email: '', ...values } });

test('blank padding is ignored and a complete row with optional blank email is ready', () => {
  assert.equal(recruitSubmissionState([entry()]).canSubmit, false);
  const state = recruitSubmissionState([entry(valid), entry()]);
  assert.equal(state.readyCount, 1);
  assert.equal(state.canSubmit, true);
});

test('missing names, whitespace, malformed phones and optional malformed emails block the whole batch', () => {
  for (const patch of [{ firstName: '' }, { lastName: '  ' }, { phone: 'invalid' }, { email: 'bad' }]) {
    const state = recruitSubmissionState([entry({ ...valid, ...patch }), entry({ ...valid, phone: '4075550124' })]);
    assert.equal(state.readyCount, 1);
    assert.equal(state.invalidCount, 1);
    assert.equal(state.canSubmit, false);
  }
});

test('canonical duplicates and invalid rows beyond the first page block submission', () => {
  const duplicates = recruitSubmissionState([entry(valid), entry({ ...valid, phone: '+14075550123' })]);
  assert.equal(duplicates.readyCount, 0);
  assert.equal(duplicates.invalidCount, 2);
  const state = recruitSubmissionState([entry(valid), ...Array.from({ length: 9 }, () => entry()), entry({ firstName: 'Incomplete' })]);
  assert.equal(state.canSubmit, false);
  assert.equal(state.invalidCount, 1);
});

test('failed rows are validated; confirmed and unresolved rows are never queued again', () => {
  for (const status of ['created', 'already_exists', 'partial', 'uncertain', 'submitting']) {
    assert.equal(recruitSubmissionState([entry(valid, status)]).canSubmit, false);
  }
  assert.equal(recruitSubmissionState([entry(valid, 'failed')]).canSubmit, true);
  assert.equal(recruitSubmissionState([entry({ firstName: 'Incomplete' }, 'failed')]).canSubmit, false);
  assert.equal(recruitSubmissionState([entry(valid), entry(valid, 'created')]).canSubmit, false);
});
