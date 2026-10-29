import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactPhone, validateContactInput } from '../lib/contact-input.mjs';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = overrides => ({ requestId, firstName: ' José ', lastName: '李', phone: '(407) 555-0123', licensed: false, ...overrides });

test('contact input normalizes Unicode names, explicit license boolean and US/international phone values', () => {
  assert.deepEqual(validateContactInput(input()), { requestId, firstName: 'José', lastName: '李', phone: '+14075550123', licensed: false });
  assert.equal(validateContactInput(input({ firstName: 'Jose\u0301', licensed: true })).firstName, 'José');
  for (const [raw, normalized] of [['407.555.0123', '+14075550123'], ['1 407 555 0123', '+14075550123'], ['+44 (20) 1234-5678', '+442012345678']]) {
    assert.equal(normalizeContactPhone(raw), normalized);
  }
});

test('contact input rejects unsupported authority, missing fields, long names and invalid phones without echoing PII', () => {
  for (const value of [input({ licensed: undefined }), input({ licensed: 'false' }), input({ requestId: 'bad' }), input({ firstName: '' }), input({ lastName: 'x'.repeat(101) }), input({ firstName: 'SecretName\n' }), input({ ownerId: '1' }), input({ phone: '407-555-0123 ext 4' }), input({ phone: '+01234567' }), input({ phone: '5550123' }), input({ phone: '00442012345678' })]) {
    assert.throws(() => validateContactInput(value), error => error.code === 'INVALID_CONTACT' && !error.message.includes('SecretName'));
  }
});
