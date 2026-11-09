import { APP_FORM } from '../public/form.js';
import { isRequired, visibleItems } from '../public/rules.js';
import { LIMITS } from './config.mjs';

const KNOWN_IDS = new Set(APP_FORM.flatMap(section => section.items.map(item => item.id)));
const LINE_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

// US numbers only: 10 digits, or 11 starting with 1. Returned in E.164 like the CRM.
export function canonicalPhone(value) {
  if (typeof value !== 'string' || value.length > 40 || /[^\d\s().+-]/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits) || /^\d{3}[01]/.test(digits)) return null;
  return `+1${digits}`;
}

export function formatPhone(e164) {
  const d = String(e164).slice(2);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Splits "Full legal name" into HubSpot first and last name. */
export function splitName(full) {
  const parts = full.split(' ').filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

// Formats phones produce, plus PDF scans. Identified by content, never by the file name.
export function sniffUpload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  if (ascii.startsWith('%PDF-')) return { type: 'application/pdf', ext: 'pdf' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (/^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii.slice(4, 12))) return { type: 'image/heic', ext: 'heic' };
  return null;
}

function line(value, max) {
  if (typeof value !== 'string') return { error: 'invalid' };
  const clean = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (LINE_CONTROL.test(clean) || clean.length > max) return { error: 'invalid' };
  return { value: clean };
}

function paragraph(value, max) {
  if (typeof value !== 'string') return { error: 'invalid' };
  const clean = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (TEXT_CONTROL.test(clean) || clean.length > max) return { error: 'invalid' };
  return { value: clean };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Normalizes one answer by question type. Returns { value } (empty string = not answered) or { error }. */
function normalize(item, raw) {
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: 'invalid' };
  switch (item.type) {
    case 'long': return paragraph(raw, LIMITS.long);
    case 'yesno': return raw === '' || raw === 'yes' || raw === 'no' ? { value: raw } : { error: 'invalid' };
    case 'check': return raw === '' || raw === 'yes' ? { value: raw } : { error: 'invalid' };
    case 'choice': return raw === '' || item.options.includes(raw) ? { value: raw } : { error: 'invalid' };
    case 'date': {
      const v = raw.trim();
      return v === '' || validDate(v) ? { value: v } : { error: 'invalid' };
    }
    case 'number': {
      const v = raw.trim();
      if (v === '') return { value: '' };
      return /^\d{1,4}(\.\d{1,2})?$/.test(v) && Number(v) <= 9999 ? { value: String(Number(v)) } : { error: 'invalid' };
    }
    case 'email': {
      const r = line(raw, 254);
      if (r.error || r.value === '') return r;
      const v = r.value.toLowerCase();
      return EMAIL.test(v) ? { value: v } : { error: 'invalid' };
    }
    case 'tel': {
      if (!raw.trim()) return { value: '' };
      const phone = canonicalPhone(raw);
      return phone ? { value: phone } : { error: 'invalid' };
    }
    default: return line(raw, LIMITS.text);
  }
}

async function readUpload(entry) {
  if (entry === null || entry === undefined || entry === '') return { error: 'required' };
  if (typeof entry === 'string' || typeof entry.arrayBuffer !== 'function') return { error: 'invalid' };
  if (entry.size === 0) return { error: 'required' };
  if (entry.size > LIMITS.maxFileBytes) return { error: 'too_large' };
  if (entry.size < LIMITS.minFileBytes) return { error: 'invalid' };
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const kind = sniffUpload(bytes);
  return kind ? { value: { bytes, ...kind } } : { error: 'not_supported' };
}

/**
 * Validates one application from multipart FormData: `answers` (JSON), `dlPhoto` (file),
 * `website` (honeypot) and `elapsedMs`. Only questions the applicant could see are kept.
 * Returns { ok: true, answers, license } | { ok: false, errors } | { ok: false, bot: true }.
 */
export async function validateApplication(form) {
  const honeypot = form.get('website');
  if (typeof honeypot === 'string' && honeypot.trim()) return { ok: false, bot: true };
  const elapsed = Number(form.get('elapsedMs'));
  if (!Number.isFinite(elapsed) || elapsed < LIMITS.minFillMs) return { ok: false, bot: true };

  const rawJson = form.get('answers');
  if (typeof rawJson !== 'string' || rawJson.length > LIMITS.maxAnswersBytes) return { ok: false, errors: { form: 'invalid' } };
  let raw;
  try { raw = JSON.parse(rawJson); } catch { return { ok: false, errors: { form: 'invalid' } }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: { form: 'invalid' } };

  // Normalize every known answer first, so visibility rules see clean values.
  const errors = {};
  const clean = {};
  for (const id of KNOWN_IDS) {
    if (id === 'dlPhoto' || !Object.hasOwn(raw, id)) continue;
    const item = APP_FORM.flatMap(s => s.items).find(i => i.id === id);
    const result = normalize(item, raw[id]);
    if (result.error) errors[id] = result.error; else if (result.value !== '') clean[id] = result.value;
  }
  // Onboard ticks "I hold, or have held, a license" when a licensed status is picked.
  if (/^(currently licensed|licensed in)/i.test(clean.licenseStatus || '')) clean.everLicensed = 'yes';

  const answers = {};
  for (const item of visibleItems(clean)) {
    if (item.type === 'file') continue;
    const value = clean[item.id];
    if (value !== undefined) answers[item.id] = value;
    if (errors[item.id]) continue;
    if (isRequired(item) && (value === undefined || (item.type === 'check' && value !== 'yes'))) errors[item.id] = 'required';
  }
  // Errors on hidden questions do not matter: those answers are dropped.
  for (const id of Object.keys(errors)) {
    if (!visibleItems(clean).some(item => item.id === id)) delete errors[id];
  }
  if (answers.legalName && !errors.legalName && answers.legalName.split(' ').filter(Boolean).length < 2) errors.legalName = 'full_name';
  if (answers.zip && !errors.zip && !/^\d{5}(-\d{4})?$/.test(answers.zip)) errors.zip = 'invalid';

  const license = await readUpload(form.get('dlPhoto'));
  if (license.error) errors.dlPhoto = license.error;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, answers, license: license.value };
}
