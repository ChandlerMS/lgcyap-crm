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

/** Both HTTP 429 and the tool's HTTP-200 unavailable envelope can carry a cooldown. */
export function hubspotRetryDeadline(value, rateLimited = false, now = Date.now()) {
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : rateLimited ? 60 : 0;
  return delay ? now + Math.ceil(delay * 1000) : null;
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
