import { normalizeRecruitIntakeRow, RecruitIntakeInputError } from './recruit-intake-input.mjs';
import { OFFICES } from './recruiting-config.mjs';

// One imported hiring-event attendee. Shared by the browser preview and the server,
// so a row that previews as ready is the row the server accepts.
export const ATTENDEE_FIELDS = Object.freeze(['firstName', 'lastName', 'phone', 'email', 'office', 'eventDate']);
export const MAX_ATTENDEE_ROWS = 200;
const EVENT_DAYS_BACK = 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;

const isoDay = time => new Date(time).toISOString().slice(0, 10);
function calendarDay(year, month, day) {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Accepts 2026-11-17, 11/17/2026, 11/17/26, an Excel date cell or an Excel day number. Returns YYYY-MM-DD or ''. */
export function attendeeEventDay(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? calendarDay(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) : '';
  const text = String(value ?? '').trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return calendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (match) return calendarDay(match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]), Number(match[1]), Number(match[2]));
  // Excel stores dates as days since 1899-12-30 when a cell is not formatted as a date.
  if (/^\d{5}$/.test(text) && Number(text) >= 40000 && Number(text) <= 80000) return isoDay(Date.UTC(1899, 11, 30) + Number(text) * DAY_MS);
  return '';
}

/** Orlando, Miami or Tampa, by key or label. Returns the office key or ''. */
export function attendeeOffice(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (Object.hasOwn(OFFICES, text)) return text;
  return Object.entries(OFFICES).find(([, label]) => label.toLowerCase() === text)?.[0] ?? '';
}

export function earliestEventDay(today) { return isoDay(Date.parse(`${today}T12:00:00Z`) - EVENT_DAYS_BACK * DAY_MS); }

export function normalizeAttendeeRow(row, { today }) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !ATTENDEE_FIELDS.includes(key))) throw new RecruitIntakeInputError();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) throw new RecruitIntakeInputError();
  const fieldErrors = {};
  let contact = null;
  try { contact = normalizeRecruitIntakeRow({ firstName: row.firstName, lastName: row.lastName, phone: row.phone, email: row.email ?? '', recruitingPath: 'genpop' }); }
  catch (error) { if (!(error instanceof RecruitIntakeInputError)) throw error; Object.assign(fieldErrors, error.fieldErrors); }
  const office = attendeeOffice(row.office);
  if (!office) fieldErrors.office = `Enter the office: ${Object.values(OFFICES).join(', ')}.`;
  const eventDate = typeof row.eventDate === 'string' ? attendeeEventDay(row.eventDate) : '';
  if (!eventDate) fieldErrors.eventDate = 'Enter the event date, for example 11/17/2026.';
  else if (eventDate > today) fieldErrors.eventDate = 'The event date cannot be in the future.';
  else if (eventDate < earliestEventDay(today)) fieldErrors.eventDate = 'Import events from the last 12 months only.';
  if (Object.keys(fieldErrors).length) throw new RecruitIntakeInputError(fieldErrors);
  return { firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone, email: contact.email, office, eventDate };
}

export function validateAttendeeImportInput(input, { today }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new RecruitIntakeInputError();
  const { requestId, ...row } = input;
  return { requestId: requestId.toLowerCase(), ...normalizeAttendeeRow(row, { today }) };
}

/** Field problems per row, plus the same person listed twice for the same day. */
export function attendeeRowIssues(rows, { today }) {
  const issues = rows.map(() => ({}));
  const seen = new Map();
  rows.forEach((row, index) => {
    let normalized;
    try { normalized = normalizeAttendeeRow(row, { today }); }
    catch (error) { issues[index] = error.fieldErrors && Object.keys(error.fieldErrors).length ? error.fieldErrors : { firstName: 'Check this row.' }; return; }
    const key = `${normalized.phone}|${normalized.eventDate}`;
    if (seen.has(key)) {
      issues[seen.get(key)].phone = 'This person is listed more than once for this day.';
      issues[index].phone = 'This person is listed more than once for this day.';
    } else seen.set(key, index);
  });
  return issues;
}
