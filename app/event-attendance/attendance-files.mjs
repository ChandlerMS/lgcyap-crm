import { parseRecruitImport, RecruitImportError } from '../recruit-intake-import.mjs';
import { leaderboardCsvCell } from '../leaderboard-data.mjs';
import { attendeeEventDay, MAX_ATTENDEE_ROWS } from '../../lib/event-attendee-input.mjs';
import { PIPELINE_ID, PORTAL_ID } from '../../lib/recruiting-config.mjs';

// HubSpot's ticket list, filtered to the Recruiting pipeline and the tickets the sign-in and
// application pages (and imported lists) create. HubSpot keeps its own pipeline picker per user.
export const HUBSPOT_SOURCE_URL = `https://app.hubspot.com/contacts/${PORTAL_ID}/objects/0-5/views/all/list?filters=${encodeURIComponent(JSON.stringify([
  { property: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID },
  { property: 'source_type', operator: 'EQ', value: 'FORM' },
]))}`;

export const ATTENDEE_TEMPLATE_CSV = 'First Name,Last Name,Phone Number,Email,Office,Event Date\r\n';

const HEADERS = new Map([
  ['firstname', 'firstName'], ['first', 'firstName'], ['givenname', 'firstName'],
  ['lastname', 'lastName'], ['last', 'lastName'], ['surname', 'lastName'], ['familyname', 'lastName'],
  ['name', 'fullName'], ['fullname', 'fullName'],
  ['phone', 'phone'], ['phonenumber', 'phone'], ['mobile', 'phone'], ['mobilephone', 'phone'], ['cell', 'phone'], ['cellphone', 'phone'],
  ['email', 'email'], ['emailaddress', 'email'],
  ['office', 'office'], ['location', 'office'],
  ['eventdate', 'eventDate'], ['eventday', 'eventDate'], ['date', 'eventDate'], ['signindate', 'eventDate'], ['dateattended', 'eventDate'],
]);
const LABELS = { firstName: 'First Name', lastName: 'Last Name', fullName: 'Name', phone: 'Phone Number', email: 'Email', office: 'Office', eventDate: 'Event Date' };

function cellText(value, key) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date && key === 'eventDate') return attendeeEventDay(value) || 'unreadable date';
  if (typeof value !== 'string' && typeof value !== 'number') throw new RecruitImportError(`${LABELS[key]} cells must be plain text or numbers. Format phone cells as Text in Excel.`);
  const text = String(value).trim();
  if (text.length > 2000) throw new RecruitImportError('A cell is too long. Keep names, phone numbers, emails, offices and dates only.');
  if (/^=/.test(text)) throw new RecruitImportError('Formula cells are not imported. Replace formulas with plain values and try again.');
  return text;
}

/** Maps a sign-in sheet's columns. A single Name column is split at its first space. */
export function attendeeRowsFromCells(cells) {
  if (!Array.isArray(cells)) throw new RecruitImportError('The file does not contain a readable table.');
  const headerIndex = cells.findIndex(row => Array.isArray(row) && row.some(value => value !== null && value !== undefined && String(value).trim()));
  if (headerIndex < 0) throw new RecruitImportError('The file is empty. Include column headers and at least one attendee.');
  const columns = new Map();
  cells[headerIndex].forEach((value, index) => {
    const key = HEADERS.get(String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!key) return;
    if (columns.has(key)) throw new RecruitImportError(`The file has more than one ${LABELS[key]} column. Keep one and try again.`);
    columns.set(key, index);
  });
  const named = columns.has('firstName') && columns.has('lastName');
  if ((!named && !columns.has('fullName')) || !columns.has('phone') || !columns.has('office') || !columns.has('eventDate')) {
    throw new RecruitImportError('Include First Name, Last Name (or Name), Phone Number, Office and Event Date headers. Email is optional.');
  }
  const rows = [];
  for (let index = headerIndex + 1; index < cells.length; index += 1) {
    const line = cells[index];
    if (!Array.isArray(line)) throw new RecruitImportError('A row in the file could not be read.');
    const read = key => columns.has(key) ? cellText(line[columns.get(key)], key) : '';
    let firstName = read('firstName'), lastName = read('lastName');
    if (!named) { const parts = read('fullName').split(/\s+/).filter(Boolean); firstName = parts[0] ?? ''; lastName = parts.slice(1).join(' '); }
    const row = { firstName, lastName, phone: read('phone'), email: read('email'), office: read('office'), eventDate: read('eventDate') };
    if (Object.values(row).every(value => !value)) continue;
    rows.push(row);
    if (rows.length > MAX_ATTENDEE_ROWS) throw new RecruitImportError(`Import at most ${MAX_ATTENDEE_ROWS} attendees at a time. Split this file into smaller files.`);
  }
  if (!rows.length) throw new RecruitImportError('No attendee rows were found below the headers.');
  return rows;
}

/** CSV or .xlsx, with the same file-safety checks as Add Recruits. */
export function parseAttendeeFile(file, options = {}) {
  return parseRecruitImport(file, { ...options, rowsFromCells: attendeeRowsFromCells });
}

/** The attendance table as shown, newest day first, with a total row. Counts only. */
export function attendanceCsv(report) {
  const offices = report.offices ?? [];
  const lines = [['Event day', ...offices.map(office => office.label), 'Sign-ins', 'Online applications']];
  const total = { offices: {}, signIns: 0, applications: 0 };
  for (const row of report.days ?? []) {
    lines.push([row.day, ...offices.map(office => row.offices?.[office.key] ?? 0), row.signIns, row.applications]);
    for (const office of offices) total.offices[office.key] = (total.offices[office.key] ?? 0) + (row.offices?.[office.key] ?? 0);
    total.signIns += row.signIns; total.applications += row.applications;
  }
  lines.push(['Total', ...offices.map(office => total.offices[office.key] ?? 0), total.signIns, total.applications]);
  return lines.map(line => line.map(leaderboardCsvCell).join(',')).join('\r\n') + '\r\n';
}

const EASTERN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Named for the Eastern day the numbers were read, e.g. event-attendance-2026-11-18.csv. */
export function attendanceCsvFilename(fetchedAt) {
  const time = Date.parse(String(fetchedAt ?? ''));
  return `event-attendance${Number.isFinite(time) ? `-${EASTERN_DAY.format(time)}` : ''}.csv`;
}
