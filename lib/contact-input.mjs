const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContactInputError extends Error {
  constructor(message = 'Check the required contact fields.', fieldErrors) {
    super(message); this.code = 'INVALID_CONTACT'; this.status = 400; this.fieldErrors = fieldErrors;
  }
}

export function normalizeContactPhone(raw) {
  const invalid = () => { throw new ContactInputError('Enter a valid phone number without extensions.', { phone: 'Use 10 US digits or an international number beginning with +.' }); };
  if (typeof raw !== 'string' || raw.length > 80 || CONTROLS.test(raw)) return invalid();
  const value = raw.trim();
  if (!/^\+?[0-9 ().-]+$/.test(value)) return invalid();
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) {
    if (!/^[1-9]\d{6,14}$/.test(digits)) return invalid();
    return `+${digits}`;
  }
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return invalid();
}

export function validateContactInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['requestId', 'firstName', 'lastName', 'phone', 'licensed'].includes(key))
    || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new ContactInputError();
  const name = (key, label) => {
    const raw = input[key];
    if (typeof raw !== 'string' || CONTROLS.test(raw)) throw new ContactInputError('Check the required contact fields.', { [key]: `Enter a ${label} of 1–100 characters.` });
    const value = raw.trim().normalize('NFC');
    if (!value || [...value].length > 100) throw new ContactInputError('Check the required contact fields.', { [key]: `Enter a ${label} of 1–100 characters.` });
    return value;
  };
  if (typeof input.licensed !== 'boolean') throw new ContactInputError('Choose the license status.', { licensed: 'Choose whether an active 2-14/2-15 license is recorded.' });
  return { requestId: input.requestId.toLowerCase(), firstName: name('firstName', 'first name'), lastName: name('lastName', 'last name'), phone: normalizeContactPhone(input.phone), licensed: input.licensed };
}
