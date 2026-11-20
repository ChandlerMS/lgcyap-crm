// Made-up applicant data for tests. Nothing here is a real person.
export function jpegBytes(size = 4000) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  return bytes;
}

export function pdfBytes(size = 4000) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n%test'));
  return bytes;
}

export function baseAnswers(overrides = {}) {
  return {
    legalName: 'Testy Q Applicant',
    email: 'Testy.Applicant@Example.com',
    phone: '(407) 555-0142',
    city: 'Orlando',
    state: 'Florida',
    zip: '32801',
    office: 'Orlando',
    licenseStatus: 'Not licensed',
    age18: 'yes', workAuth: 'yes', ssn: 'yes', hours: 'yes',
    transport: 'yes',
    startDate: 'Immediately',
    nameMatch: 'yes', felony: 'no', pending: 'no', licDenied: 'no', firedFraud: 'no', bankruptcy: 'no',
    emp1: 'Example Retail', title1: 'Associate', dates1: '01/2022 to 10/2026', why1: 'Customer service.\nLooking to grow.',
    jobsHistory: 'Example Diner, server, 2021 to 2022',
    certify: 'yes',
    signature: 'Testy Q Applicant',
    ...overrides,
  };
}

// The form no longer asks for a photo; tests that need one pass `file`.
export function applicationForm({ answers = baseAnswers(), file = null, fileType = 'image/jpeg', elapsedMs = 120000, website = '' } = {}) {
  const form = new FormData();
  form.append('answers', typeof answers === 'string' ? answers : JSON.stringify(answers));
  if (file) form.append('dlPhoto', new Blob([file], { type: fileType }), 'license.jpg');
  form.append('elapsedMs', String(elapsedMs));
  form.append('website', website);
  return form;
}
