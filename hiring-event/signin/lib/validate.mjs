import { CONTRACTED_BEFORE, HEARD_ABOUT, LICENSE_STATUS, LIMITS, OFFICES, SIGN_IN_SOURCES } from './config.mjs';

const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .,-]*$/u;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

function text(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (CONTROL.test(clean)) return null;
  return clean.length > max ? null : clean;
}

function choice(value, options) {
  return typeof value === 'string' && Object.hasOwn(options, value) ? value : null;
}

// US numbers only: 10 digits, or 11 starting with 1. Returned in E.164 like the CRM.
export function canonicalPhone(value) {
  if (typeof value !== 'string' || value.length > 40 || /[^\d\s().+-]/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits) || /^\d{3}[01]/.test(digits)) return null;
  return `+1${digits}`;
}

export function formatPhone(e164) {
  const d = e164.slice(2);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Recognize the image formats phones produce. The browser re-encodes photos to JPEG
// before upload, but HEIC can still arrive when a browser cannot decode it.
export function sniffImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  const brand = ascii.slice(4, 12);
  if (/^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return { type: 'image/heic', ext: 'heic' };
  return null;
}

async function readFile(entry, required) {
  if (entry === null || entry === undefined || entry === '') return required ? { error: 'required' } : { value: null };
  if (typeof entry === 'string' || typeof entry.arrayBuffer !== 'function') return { error: 'invalid' };
  if (entry.size === 0) return required ? { error: 'required' } : { value: null };
  if (entry.size > LIMITS.maxFileBytes) return { error: 'too_large' };
  if (entry.size < LIMITS.minFileBytes) return { error: 'invalid' };
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { error: 'not_image' };
  return { value: { bytes, ...kind } };
}

/**
 * Validates one sign-in submission from multipart FormData.
 * Returns { ok: true, value } or { ok: false, errors } with field -> error code.
 * Bot checks (honeypot, fill time) are reported separately as { ok: false, bot: true }.
 */
export async function validateSignIn(form) {
  const get = key => form.get(key);
  const honeypot = get('website');
  if (typeof honeypot === 'string' && honeypot.trim()) return { ok: false, bot: true };
  const elapsed = Number(get('elapsedMs'));
  if (!Number.isFinite(elapsed) || elapsed < LIMITS.minFillMs) return { ok: false, bot: true };

  const errors = {};
  const value = {};

  for (const key of ['firstName', 'lastName']) {
    const v = text(get(key), 80);
    if (!v) errors[key] = v === null ? 'invalid' : 'required';
    else if (!NAME.test(v)) errors[key] = 'invalid';
    else value[key] = v;
  }

  const email = text(get('email'), 254);
  if (!email) errors.email = email === null ? 'invalid' : 'required';
  else if (!EMAIL.test(email.toLowerCase())) errors.email = 'invalid';
  else value.email = email.toLowerCase();

  const rawPhone = get('phone');
  if (!rawPhone || !String(rawPhone).trim()) errors.phone = 'required';
  else {
    const phone = canonicalPhone(String(rawPhone));
    if (!phone) errors.phone = 'invalid'; else value.phone = phone;
  }

  value.office = choice(get('office'), OFFICES);
  if (!value.office) errors.office = 'required';

  value.heardAbout = choice(get('heardAbout'), HEARD_ABOUT);
  if (!value.heardAbout) errors.heardAbout = 'required';
  if (value.heardAbout === 'referral') {
    const v = text(get('referredBy'), 120);
    if (!v) errors.referredBy = v === null ? 'invalid' : 'required'; else value.referredBy = v;
  }
  if (value.heardAbout === 'other') {
    const v = text(get('heardAboutOther'), 120);
    if (!v) errors.heardAboutOther = v === null ? 'invalid' : 'required'; else value.heardAboutOther = v;
  }

  value.licenseStatus = choice(get('licenseStatus'), LICENSE_STATUS);
  if (!value.licenseStatus) errors.licenseStatus = 'required';
  if (value.licenseStatus === 'licensed') {
    value.contractedBefore = choice(get('contractedBefore'), CONTRACTED_BEFORE);
    if (!value.contractedBefore) errors.contractedBefore = 'required';
    const npn = text(get('npn') ?? '', 20);
    if (npn === null) errors.npn = 'invalid';
    else if (npn) {
      const digits = npn.replace(/[\s-]/g, '');
      if (!/^\d{1,10}$/.test(digits)) errors.npn = 'invalid'; else value.npn = digits;
    }
  }

  if (get('consent') !== 'yes') errors.consent = 'required';

  value.source = choice(get('source'), SIGN_IN_SOURCES) ?? 'direct';

  const front = await readFile(get('licenseFront'), true);
  if (front.error) errors.licenseFront = front.error; else value.licenseFront = front.value;
  const back = await readFile(get('licenseBack'), false);
  if (back.error) errors.licenseBack = back.error; else value.licenseBack = back.value;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}
