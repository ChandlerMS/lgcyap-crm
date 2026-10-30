export const HUBSPOT_VIEW_ZONE = 'America/New_York';
const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: HUBSPOT_VIEW_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function hubspotDateKey(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(dateParts.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentHubspotMonth(now = new Date()) {
  return hubspotDateKey(now)?.slice(0, 7) ?? null;
}

function monthParts(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 ? { year, month } : null;
}

function utcDay(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function shiftHubspotMonth(value, amount) {
  const parts = monthParts(value);
  if (!parts || !Number.isInteger(amount)) return value;
  const date = utcDay(parts.year, parts.month + amount, 1);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return value;
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Calendar rows represent CRM meeting start dates; no external-calendar events are invented. */
export function hubspotMonthDays(value, records = []) {
  const parts = monthParts(value);
  if (!parts) return [];
  const first = utcDay(parts.year, parts.month, 1);
  const daysInMonth = utcDay(parts.year, parts.month + 1, 0).getUTCDate();
  const dates = [];
  for (let padding = 0; padding < first.getUTCDay(); padding += 1) dates.push(null);
  const unique = [...new Map(records.map(record => [record.id, record])).values()];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${value}-${String(day).padStart(2, '0')}`;
    dates.push({ key, day, records: unique.filter(record => hubspotDateKey(record.scheduledAt) === key) });
  }
  while (dates.length % 7) dates.push(null);
  return dates;
}

export function filterHubspotRows(records, query) {
  const normalized = String(query ?? '').trim().toLocaleLowerCase('en-US');
  if (!normalized) return records;
  const fields = ['title', 'subtitle', 'status', 'owner', 'phone', 'email', 'company', 'health', 'preview'];
  return records.filter(record => fields.some(field => typeof record[field] === 'string' && record[field].toLocaleLowerCase('en-US').includes(normalized)));
}

const sortableFields = new Set(['title', 'subtitle', 'status', 'owner', 'createdAt', 'updatedAt', 'scheduledAt', 'endedAt', 'phone', 'email', 'company', 'health']);
const dateFields = new Set(['createdAt', 'updatedAt', 'scheduledAt', 'endedAt']);
const textCollator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
/** Sort the entire loaded cohort before pagination. Missing values stay last in either direction. */
export function sortHubspotRows(records, sort) {
  if (!sort || !sortableFields.has(sort.field) || !['asc', 'desc'].includes(sort.direction)) return [...records];
  const valueOf = record => {
    const value = record[sort.field];
    if (typeof value !== 'string' || !value.trim()) return null;
    if (!dateFields.has(sort.field)) return value.trim();
    const instant = Date.parse(value);
    return Number.isFinite(instant) ? instant : null;
  };
  return records.map((record, index) => ({ record, index, value: valueOf(record) })).sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === null && b.value === null ? a.index - b.index : a.value === null ? 1 : -1;
    const result = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : textCollator.compare(a.value, b.value);
    return result ? result * (sort.direction === 'asc' ? 1 : -1) : a.index - b.index;
  }).map(item => item.record);
}

/** Both HTTP 429 and the tool's HTTP-200 unavailable envelope can carry a cooldown. */
export function hubspotRetryDeadline(value, rateLimited = false, now = Date.now()) {
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : rateLimited ? 60 : 0;
  return delay ? now + Math.ceil(delay * 1000) : null;
}

export function normalizeHubspotSearchQuery(value) {
  if (typeof value !== 'string') return { query: null, error: 'Enter a search phrase.' };
  const query = value.trim();
  if (!query) return { query: null, error: null };
  if (query.length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) return { query: null, error: 'Use 2–200 characters without line breaks or control characters.' };
  return { query, error: null };
}

export function hubspotSearchResponseMatches(requestedQuery, returnedQuery) {
  return requestedQuery === null ? returnedQuery === null : typeof requestedQuery === 'string' && requestedQuery === returnedQuery;
}

/** Links remain on the fixed account; never render provider-supplied external destinations. */
export function safeHubspotViewLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'app.hubspot.com' && url.port === ''
      && !url.username && !url.password && url.pathname.split('/').includes('50894788') ? url.href : null;
  } catch { return null; }
}
