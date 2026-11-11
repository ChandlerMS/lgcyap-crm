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
  assert.equal(v.photoId.type, 'image/jpeg');
});

test('Tampa is no longer an office', async () => {
  const result = await validateSignIn(validForm({ office: 'tampa' }));
  assert.deepEqual(result.errors, { office: 'required' });
});

test('unlicensed sign-ins ignore NPN and contracted-before answers', async () => {
  const result = await validateSignIn(validForm({ licenseStatus: 'unlicensed', npn: 'not a number', contractedBefore: undefined }));
  assert.equal(result.ok, true);
  assert.equal(result.value.npn, undefined);
  assert.equal(result.value.contractedBefore, undefined);
});

test('missing required answers are reported per field', async () => {
  const form = validForm({ firstName: '', email: 'not-an-email', phone: '123', office: 'denver', heardAbout: 'referral', referredBy: '', consent: undefined, photoId: null });
  const result = await validateSignIn(form);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, {
    firstName: 'required', email: 'invalid', phone: 'invalid', office: 'required', referredBy: 'required', consent: 'required', photoId: 'required',
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

test('contracted before = Yes needs who they are contracted with', async () => {
  let result = await validateSignIn(validForm({ contractedBefore: 'yes' }));
  assert.deepEqual(result.errors, { contractedWith: 'required' });
  result = await validateSignIn(validForm({ contractedBefore: 'yes', contractedWith: 'Example Agency' }));
  assert.equal(result.value.contractedWith, 'Example Agency');
});

test('social media and job posting need the specific site', async () => {
  let result = await validateSignIn(validForm({ heardAbout: 'social', referredBy: undefined }));
  assert.deepEqual(result.errors, { heardAboutDetail: 'required' });
  result = await validateSignIn(validForm({ heardAbout: 'social', heardAboutDetail: 'indeed', referredBy: undefined }));
  assert.deepEqual(result.errors, { heardAboutDetail: 'required' });
  result = await validateSignIn(validForm({ heardAbout: 'job_posting', heardAboutDetail: 'ziprecruiter', referredBy: undefined }));
  assert.equal(result.value.heardAboutDetail, 'ziprecruiter');
  result = await validateSignIn(validForm({ heardAbout: 'tiktok', referredBy: undefined }));
  assert.deepEqual(result.errors, { heardAbout: 'required' });
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

test('the photo ID must be a real image within the size limit', async () => {
  const notImage = new Blob([new Uint8Array(5000).fill(0x25)], { type: 'image/jpeg' });
  assert.equal((await validateSignIn(validForm({ photoId: notImage }))).errors.photoId, 'not_image');
  assert.equal((await validateSignIn(validForm({ photoId: jpegBlob(2_600_000) }))).errors.photoId, 'too_large');
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
