import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_FORM } from '../public/form.js';
import { evaluateApplication, isLicensed, visibleItems } from '../public/rules.js';
import { canonicalPhone, splitName, validateApplication } from '../lib/validate.mjs';
import { applicationForm, baseAnswers, pdfBytes } from './fixtures.mjs';

test('form keeps the live /apply sections and questions in order', () => {
  assert.deepEqual(APP_FORM.map(s => s.id), ['info', 'license', 'eligibility', 'work', 'about', 'found', 'part2', 'certify']);
  assert.deepEqual(APP_FORM.find(s => s.id === 'info').items.map(i => i.id), ['legalName', 'preferred', 'email', 'phone', 'city', 'state', 'zip', 'office', 'dlPhoto']);
  assert.deepEqual(APP_FORM.find(s => s.id === 'eligibility').items.map(i => i.id), ['age18', 'workAuth', 'english', 'ssn', 'hours', 'transport', 'commuteMin', 'startDate', 'nameMatch', 'felony', 'pending', 'licDenied', 'firedFraud', 'bankruptcy', 'eligExplain']);
  assert.equal(APP_FORM.flatMap(s => s.items).length, 60);
  assert.deepEqual(APP_FORM.find(s => s.id === 'info').items.find(i => i.id === 'office').options, ['Orlando', 'Miami']);
  assert.equal(APP_FORM.flatMap(s => s.items).filter(i => i.essential).length, 5);
});

test('Part 2 opens for licensed applicants and the "ever licensed" box', () => {
  assert.equal(isLicensed({ licenseStatus: 'Not licensed yet' }), false);
  assert.equal(isLicensed({ licenseStatus: 'Currently licensed in Florida' }), true);
  assert.equal(isLicensed({ licenseStatus: 'Licensed in another state' }), true);
  assert.equal(isLicensed({ licenseStatus: 'Studying for my license exam', everLicensed: 'yes' }), true);
  assert.ok(!visibleItems({ licenseStatus: 'Not licensed yet' }).some(i => i.id === 'carriers'));
  assert.ok(visibleItems({ everLicensed: 'yes' }).some(i => i.id === 'carriers'));
});

test('evaluation matches Onboard: essentials fail, review answers flag', () => {
  const pass = evaluateApplication(baseAnswers());
  assert.deepEqual(pass, { pass: true, failed: [], review: [] });
  const fail = evaluateApplication(baseAnswers({ age18: 'no', felony: 'yes', nameMatch: 'no' }));
  assert.equal(fail.pass, false);
  assert.deepEqual(fail.failed, ['being at least 18 years old']);
  assert.equal(fail.review.length, 2);
});

test('a complete application validates and is normalized', async () => {
  const result = await validateApplication(applicationForm());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.answers.email, 'testy.applicant@example.com');
  assert.equal(result.answers.phone, '+14075550142');
  assert.equal(result.answers.why1, 'Customer service.\nLooking to grow.');
  assert.equal(result.license.type, 'image/jpeg');
  assert.ok(!('referredBy' in result.answers), 'blank answers are dropped');
});

test('required, essential and format errors are reported per question', async () => {
  const answers = baseAnswers({ legalName: 'Cher', email: 'not-an-email', phone: '555', zip: 'abc', age18: '', whyRole: '', certify: '' });
  const result = await validateApplication(applicationForm({ answers }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.legalName, 'full_name');
  assert.equal(result.errors.email, 'invalid');
  assert.equal(result.errors.phone, 'invalid');
  assert.equal(result.errors.zip, 'invalid');
  assert.equal(result.errors.age18, 'required');
  assert.equal(result.errors.whyRole, 'required');
  assert.equal(result.errors.certify, 'required');
});

test('answers outside the options and hidden questions are not kept', async () => {
  const bad = await validateApplication(applicationForm({ answers: baseAnswers({ office: 'Tampa' }) }));
  assert.equal(bad.errors.office, 'invalid');
  const hidden = await validateApplication(applicationForm({ answers: baseAnswers({ carriers: 'Should be dropped', npn: '123', examDate: '2026-12-01', unknownKey: 'x' }) }));
  assert.equal(hidden.ok, true);
  assert.ok(!('carriers' in hidden.answers));
  assert.ok(!('npn' in hidden.answers));
  assert.ok(!('examDate' in hidden.answers));
  assert.ok(!('unknownKey' in hidden.answers));
});

test('a licensed applicant keeps Part 2 answers and the NPN', async () => {
  const answers = baseAnswers({ licenseStatus: 'Currently licensed in Florida', npn: '1234567', carriers: 'Example Life', corebridgeMoo: 'yes', corebridgeDate: '05/2025', appointedElsewhere: 'yes', needRelease: 'Yes' });
  const result = await validateApplication(applicationForm({ answers }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.answers.everLicensed, 'yes');
  assert.equal(result.answers.carriers, 'Example Life');
  assert.equal(result.answers.npn, '1234567');
  assert.equal(result.answers.needRelease, 'Yes');
});

test('the license must be a real image or PDF', async () => {
  const missing = await validateApplication(applicationForm({ file: null }));
  assert.equal(missing.errors.dlPhoto, 'required');
  const text = await validateApplication(applicationForm({ file: new TextEncoder().encode('just some text, not an image at all, padded'.repeat(40)), fileType: 'image/jpeg' }));
  assert.equal(text.errors.dlPhoto, 'not_supported');
  const pdf = await validateApplication(applicationForm({ file: pdfBytes(), fileType: 'application/pdf' }));
  assert.equal(pdf.ok, true);
  assert.equal(pdf.license.ext, 'pdf');
});

test('bots: honeypot or a too-fast submission is flagged', async () => {
  assert.deepEqual(await validateApplication(applicationForm({ website: 'spam.example' })), { ok: false, bot: true });
  assert.deepEqual(await validateApplication(applicationForm({ elapsedMs: 900 })), { ok: false, bot: true });
});

test('malformed answers are rejected', async () => {
  const result = await validateApplication(applicationForm({ answers: '{not json' }));
  assert.deepEqual(result, { ok: false, errors: { form: 'invalid' } });
  const control = await validateApplication(applicationForm({ answers: baseAnswers({ city: 'Orl\u0000ando' }) }));
  assert.equal(control.errors.city, 'invalid');
});

test('phones and names', () => {
  assert.equal(canonicalPhone('407-555-0142'), '+14075550142');
  assert.equal(canonicalPhone('+1 (407) 555 0142'), '+14075550142');
  assert.equal(canonicalPhone('123-555-0142'), null);
  assert.deepEqual(splitName('Mary Anne de la Cruz'), { firstName: 'Mary', lastName: 'Anne de la Cruz' });
});
