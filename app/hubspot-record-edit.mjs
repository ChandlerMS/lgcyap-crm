const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID = /^[1-9]\d{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uncertainMessage = 'The save outcome could not be confirmed. Reload and check the record before trying again. Your draft has been kept.';
const localDateTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function hubspotDateTimeInput(value) {
  if (!hubspotRecordVersion(value)) return '';
  const parts = Object.fromEntries(localDateTime.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Resolve an Eastern wall-clock time without silently guessing through a DST gap or fold. */
export function hubspotDateTimeToIso(value, previousValue = '') {
  if (!value) return { value: '', error: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { value, error: 'Choose a valid date and time.' };
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59) return { value, error: 'Choose a real date and time.' };
  if (hubspotDateTimeInput(previousValue) === value) return { value: previousValue, error: null };
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const instant = wallTime + hours * 3600000;
    const parts = Object.fromEntries(localDateTime.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    offsets.add(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant);
  }
  const candidates = [...offsets].map(offset => new Date(wallTime - offset).toISOString()).filter(instant => hubspotDateTimeInput(instant) === value);
  return candidates.length === 1 ? { value: candidates[0], error: null } : { value, error: candidates.length ? 'This Eastern time occurs twice when daylight saving time ends. Choose another time, or set it in HubSpot.' : 'This Eastern time does not exist when daylight saving time starts. Choose another time.' };
}

export function hubspotRecordVersion(value) {
  return typeof value === 'string' && VERSION.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function hubspotRecordSnapshotAvailable(record, fields) {
  return typeof record?.id === 'string' && ID.test(record.id) && hubspotRecordVersion(record.updatedAt)
    && Array.isArray(fields) && fields.length > 0 && fields.every(field => typeof record.editValues?.[field.property] === 'string');
}

export function hubspotEditBaseline(record, fields) {
  return Object.fromEntries(fields.map(field => [field.property, record.editValues?.[field.property] ?? '']));
}

export function hubspotEditChanges(draft, baseline, fields) {
  return Object.fromEntries(fields.flatMap(field => {
    const raw = String(draft[field.property] ?? '');
    if (raw === baseline[field.property]) return [];
    const trimmed = raw.trim();
    const normalized = field.type === 'email' || field.property === 'domain' ? trimmed.toLowerCase() : trimmed;
    return normalized === baseline[field.property] ? [] : [[field.property, normalized]];
  }));
}

export function validateHubspotEditChanges(changes, fields, baseline = {}) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return 'Review the changed fields.';
  if (Object.keys(changes).some(property => !fields.some(field => field.property === property))) return 'This field cannot be edited here.';
  for (const field of fields) {
    if (!Object.hasOwn(changes, field.property)) continue;
    const value = changes[field.property];
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return `Enter a valid ${field.label.toLowerCase()}.`;
    if (field.required && !value) return `${field.label} cannot be empty.`;
    if (value.length > (field.maxLength ?? 250)) return `${field.label} is too long.`;
    if (field.type === 'select' && !field.options?.some(option => option.value === value)) return `Choose a valid ${field.label.toLowerCase()}.`;
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.';
    if (field.property === 'domain' && value && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value)) return 'Enter a company domain such as example.com.';
    if (field.type === 'tel' && value && !/\d/.test(value)) return 'Enter a valid phone number.';
    if (field.type === 'datetime' && value && !hubspotRecordVersion(value)) return `Choose a valid date and time for ${field.label.toLowerCase()}.`;
    if (field.type === 'date' && value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return `Choose a valid ${field.label.toLowerCase()}.`;
      const [, year, month, day] = match.map(Number);
      if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return `Choose a real ${field.label.toLowerCase()}.`;
    }
  }
  if (['hs_meeting_start_time', 'hs_meeting_end_time'].some(property => Object.hasOwn(changes, property))) {
    const merged = { ...baseline, ...changes };
    if (merged.hs_meeting_end_time && (!merged.hs_meeting_start_time || merged.hs_meeting_end_time < merged.hs_meeting_start_time)) return 'Meeting end must follow its start.';
  }
  return null;
}

export class HubspotRecordSaveError extends Error {
  constructor(code, message, { status = null, uncertain = false, retryAfterSeconds = null } = {}) {
    super(message); this.name = 'HubspotRecordSaveError'; this.code = code; this.status = status; this.uncertain = uncertain; this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** One reviewed request only. The caller owns the fixed same-origin endpoint and fresh snapshot. */
export async function saveHubspotRecordSnapshot({ endpoint, record, fields, changes, requestId, fetchImpl = fetch, signal }) {
  if (typeof endpoint !== 'string' || !/^\/api\/[a-z0-9/-]{1,200}$/.test(endpoint) || !hubspotRecordSnapshotAvailable(record, fields)
    || typeof requestId !== 'string' || !UUID.test(requestId) || !Object.keys(changes ?? {}).length || validateHubspotEditChanges(changes, fields, hubspotEditBaseline(record, fields))) {
    throw new HubspotRecordSaveError('INVALID_SAVE', 'Reload the record and review your changes before saving.');
  }
  const baseline = hubspotEditBaseline(record, fields);
  const expectedValues = Object.fromEntries(Object.keys(changes).map(property => [property, baseline[property]]));
  let response, result;
  try {
    response = await fetchImpl(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, expectedUpdatedAt: record.updatedAt, expectedValues, changes }), signal });
  } catch { throw new HubspotRecordSaveError('SAVE_UNCERTAIN', uncertainMessage, { uncertain: true }); }
  if (response.status === 401) throw new HubspotRecordSaveError('UNAUTHORIZED', 'Sign in again before saving.', { status: 401 });
  try { result = await response.json(); } catch { throw new HubspotRecordSaveError('SAVE_UNCERTAIN', uncertainMessage, { uncertain: true }); }
  if (!response.ok) {
    const retry = Number(result?.retryAfterSeconds ?? response.headers.get('Retry-After'));
    const retryAfterSeconds = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86400) : response.status === 429 ? 60 : null;
    const options = { status: response.status, retryAfterSeconds };
    if (result?.error?.code === 'RECORD_CHANGED') throw new HubspotRecordSaveError('RECORD_CHANGED', 'This record changed in HubSpot after you opened it. Reload the latest values before saving. Your draft has been kept.', options);
    if (result?.error?.code === 'SAVE_UNCERTAIN' || response.status >= 500) throw new HubspotRecordSaveError('SAVE_UNCERTAIN', uncertainMessage, { ...options, uncertain: true });
    throw new HubspotRecordSaveError(result?.error?.code ?? 'SAVE_FAILED', typeof result?.error?.message === 'string' ? result.error.message : 'The changes were not saved. Reload the record before trying again.', options);
  }
  const saved = result?.record;
  if (result?.status !== 'saved' || result.requestId !== requestId || saved?.id !== record.id || !hubspotRecordSnapshotAvailable(saved, fields)) {
    throw new HubspotRecordSaveError('SAVE_UNCERTAIN', uncertainMessage, { uncertain: true });
  }
  if (Object.entries(changes).some(([property, value]) => saved.editValues[property] !== value)) {
    if (result.replayed === true) throw new HubspotRecordSaveError('REPLAY_RECORD_CHANGED', 'Your earlier save completed, but this record has changed again since then. Reload its latest values before editing further. Your draft has been kept.');
    throw new HubspotRecordSaveError('SAVE_UNCERTAIN', uncertainMessage, { uncertain: true });
  }
  return { record: saved, replayed: result.replayed === true };
}
