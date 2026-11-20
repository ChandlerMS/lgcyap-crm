export const TRAINING_ZONE = 'America/New_York';
export function classError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function trainingClassError(error) {
  const status = [400, 401, 403, 409, 413].includes(error?.status) ? error.status : 503;
  return { status, error: status === 503 ? 'Training classes are temporarily unavailable. Refresh to try again.' : error.message };
}
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TRAINING_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function easternInput(iso) {
  const values = Object.fromEntries(parts.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
export function easternLocalToIso(value, occurrence = 'earlier') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !['earlier', 'later'].includes(occurrence)) throw classError('Enter a valid date and time.');
  const base = Date.parse(`${value}:00.000Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 16) !== value) throw classError('Enter a valid date and time.');
  const candidates = [4, 5].map(hours => new Date(base + hours * 3600000).toISOString()).filter(iso => easternInput(iso) === value);
  if (!candidates.length) throw classError('This Eastern Time does not exist because the clocks move forward. Choose another time.');
  return occurrence === 'later' ? candidates.at(-1) : candidates[0];
}
export function repeatedOccurrence(iso) {
  return easternLocalToIso(easternInput(iso), 'later') === new Date(iso).toISOString() ? 'later' : 'earlier';
}
function text(value, label, max, required = false, multiline = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw classError(`Enter a valid ${label}.`);
  const result = value.trim();
  if (result.length > max || (required && !result) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(result)) throw classError(`Enter a valid ${label} (up to ${max} characters).`);
  return result;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || Number(value.slice(0, 4)) < 2000 || Number(value.slice(0, 4)) > 2100) throw classError('Enter a valid class date between 2000 and 2100.');
  return value;
}
export function validateClass(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw classError('Enter valid class details.');
  const result = { name: text(input.name, 'class name', 160, true), startAt: timestamp(input.startAt), endAt: timestamp(input.endAt), trainer: text(input.trainer, 'trainer', 160), location: text(input.location, 'location', 240), meetingUrl: text(input.meetingUrl, 'meeting link', 2000), notes: text(input.notes, 'notes', 4000, false, true) };
  if (result.endAt <= result.startAt) throw classError('The class end must be after its start.');
  if (result.meetingUrl) {
    let url;
    try { url = new URL(result.meetingUrl); } catch { throw classError('Enter a complete HTTPS meeting link.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw classError('Use an HTTPS meeting link without embedded credentials.');
  }
  return result;
}
export function classIdentity(input) {
  if (!input || typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1) throw classError('Refresh the schedule before editing this class.');
  return { id: input.id, version: input.version };
}
