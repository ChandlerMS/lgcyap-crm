import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalPhone, formatPhone, sniffImage, validateSignIn } from '../lib/validate.mjs';
import { jpegBlob, validForm } from './helpers.mjs';

test('a complete licensed sign-in is accepted and normalized', async () => {
  const result = await validateSignIn(validForm());
  assert.equal(result.ok, true);
  const v = result.value;
  assert.equal(v.email, 'testy.sample@example.invalid');
  assert.equal(v.phone, '+14075550142');
  assert.equal(v.office, 'orlando');
  assert.equal(v.referredBy, 'Pat Example');
  assert.equal(v.npn, '12345678');
  assert.equal(v.contractedBefore, 'no');
  assert.equal(v.source, 'lobby');
  assert.equal(v.licenseFront.type, 'image/jpeg');
  assert.equal(v.licenseBack.ext, 'jpg');
});

test('unlicensed sign-ins ignore NPN and contracted-before answers', async () => {
  const result = await validateSignIn(validForm({ licenseStatus: 'unlicensed', npn: 'not a number', contractedBefore: undefined, licenseBack: null }));
  assert.equal(result.ok, true);
  assert.equal(result.value.npn, undefined);
  assert.equal(result.value.contractedBefore, undefined);
  assert.equal(result.value.licenseBack, null);
});

test('missing required answers are reported per field', async () => {
  const form = validForm({ firstName: '', email: 'not-an-email', phone: '123', office: 'denver', heardAbout: 'referral', referredBy: '', consent: undefined, licenseFront: null });
  const result = await validateSignIn(form);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, {
    firstName: 'required', email: 'invalid', phone: 'invalid', office: 'required', referredBy: 'required', consent: 'required', licenseFront: 'required',
  });
});

test('licensed sign-ins need the contracted-before answer; NPN is optional but numeric', async () => {
  let result = await validateSignIn(validForm({ contractedBefore: undefined, npn: '' }));
  assert.deepEqual(result.errors, { contractedBefore: 'required' });
  result = await validateSignIn(validForm({ npn: '12AB' }));
  assert.deepEqual(result.errors, { npn: 'invalid' });
  result = await validateSignIn(validForm({ npn: '123-456' }));
  assert.equal(result.value.npn, '123456');
});

test('"Other" needs a description', async () => {
  const result = await validateSignIn(validForm({ heardAbout: 'other', referredBy: undefined }));
  assert.deepEqual(result.errors, { heardAboutOther: 'required' });
});

test('honeypot and too-fast submissions are flagged as bots', async () => {
  assert.deepEqual(await validateSignIn(validForm({ website: 'http://spam.invalid' })), { ok: false, bot: true });
  assert.deepEqual(await validateSignIn(validForm({ elapsedMs: '900' })), { ok: false, bot: true });
  assert.deepEqual(await validateSignIn(validForm({ elapsedMs: undefined })), { ok: false, bot: true });
});

test('names reject markup and control characters', async () => {
  let result = await validateSignIn(validForm({ firstName: '<script>' }));
  assert.equal(result.errors.firstName, 'invalid');
  result = await validateSignIn(validForm({ lastName: "O'Neil-Ávila Jr." }));
  assert.equal(result.ok, true);
});

test('license files must be real images within the size limit', async () => {
  const pdf = new Blob([new Uint8Array(5000).fill(0x25)], { type: 'image/jpeg' });
  let form = validForm({ licenseFront: null });
  form.append('licenseFront', pdf, 'x.jpg');
  assert.equal((await validateSignIn(form)).errors.licenseFront, 'not_image');

  form = validForm({ licenseFront: null });
  form.append('licenseFront', jpegBlob(2_600_000), 'big.jpg');
  assert.equal((await validateSignIn(form)).errors.licenseFront, 'too_large');
});

test('phone numbers are US-only and canonical', () => {
  assert.equal(canonicalPhone('407-555-0142'), '+14075550142');
  assert.equal(canonicalPhone('+1 (407) 555 0142'), '+14075550142');
  assert.equal(canonicalPhone('1 407 555 0142'), '+14075550142');
  assert.equal(canonicalPhone('012-555-0142'), null);
  assert.equal(canonicalPhone('407-155-0142'), null);
  assert.equal(canonicalPhone('407555014'), null);
  assert.equal(canonicalPhone('call me'), null);
  assert.equal(formatPhone('+14075550142'), '(407) 555-0142');
});

test('image sniffing recognizes phone formats only', () => {
  const heic = new Uint8Array(16);
  heic.set([0, 0, 0, 24, ...'ftypheic'].map(c => typeof c === 'string' ? c.charCodeAt(0) : c));
  assert.equal(sniffImage(heic).type, 'image/heic');
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])).type, 'image/png');
  assert.equal(sniffImage(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});
