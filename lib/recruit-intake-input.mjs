import { normalizeContactPhone, ContactInputError } from './contact-input.mjs';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const RECRUIT_INTAKE_FIELDS = Object.freeze(['firstName', 'lastName', 'phone', 'email', 'recruitingPath']);

export class RecruitIntakeInputError extends Error {
  constructor(fieldErrors = {}) {
    super('Check the highlighted recruit fields.'); this.name = 'RecruitIntakeInputError';
    this.code = 'INVALID_INTAKE'; this.status = 400; this.fieldErrors = fieldErrors;
  }
}

export function normalizeRecruitIntakeRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).some(key => !RECRUIT_INTAKE_FIELDS.includes(key))) throw new RecruitIntakeInputError();
  const fieldErrors = {};
  const name = (key, label) => {
    const value = typeof row[key] === 'string' ? row[key].trim().normalize('NFC') : '';
    if (!value || CONTROLS.test(value) || [...value].length > 100) fieldErrors[key] = `Enter a ${label} of 1–100 characters.`;
    return value;
  };
  const firstName = name('firstName', 'first name'), lastName = name('lastName', 'last name');
  // The existing app edits Ticket subjects up to 180 characters, including this prefix.
  if (`Recruiting: ${firstName} ${lastName}`.length > 180) fieldErrors.lastName = 'Keep the combined first and last name within 168 characters.';
  let phone = '';
  try { phone = normalizeContactPhone(row.phone); }
  catch (error) { if (!(error instanceof ContactInputError)) throw error; fieldErrors.phone = 'Use 10 US digits or an international number beginning with +, without extensions.'; }
  const rawEmail = row.email === undefined ? '' : row.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (typeof rawEmail !== 'string' || email.length > 254 || CONTROLS.test(email)
    || (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) fieldErrors.email = 'Enter a valid email address or leave it blank.';
  const recruitingPath = row.recruitingPath;
  if (!['genpop', 'mass_recruiting'].includes(recruitingPath)) fieldErrors.recruitingPath = 'Choose GenPop or Mass Recruiting for this recruit.';
  if (Object.keys(fieldErrors).length) throw new RecruitIntakeInputError(fieldErrors);
  return { firstName, lastName, phone, email, recruitingPath };
}

export function validateRecruitIntakeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['requestId', ...RECRUIT_INTAKE_FIELDS].includes(key))
    || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new RecruitIntakeInputError();
  const { requestId, ...row } = input;
  return { requestId: requestId.toLowerCase(), ...normalizeRecruitIntakeRow(row) };
}
