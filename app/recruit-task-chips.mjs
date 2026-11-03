const DAY = 86_400_000;
const ZONE = 'America/New_York';
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', year: 'numeric' });
const DAY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
// Eastern calendar day as a whole number, so "Today" and "late" follow the office's date rather than UTC.
function easternDay(ms) {
  const part = Object.fromEntries(DAY_PARTS.formatToParts(ms).map(({ type, value }) => [type, value]));
  return Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day)) / DAY;
}
// Only HubSpot's own pages are linked; the app has no Tasks page of its own.
export function hubspotHref(value) {
  try { return new URL(value).origin === 'https://app.hubspot.com' ? value : undefined; } catch { return undefined; }
}
// Open HubSpot tasks as chips: anything not Completed, soonest due first so overdue work leads, undated last.
export function openTaskChips(records, now) {
  if (!Number.isFinite(now) || now <= 0) return [];
  const today = easternDay(now);
  return records.filter(record => record?.id && record.status !== 'Completed').map(record => {
    const id = String(record.id), due = Date.parse(record.scheduledAt ?? '');
    const chip = { id, href: hubspotHref(record.hubspotUrl), external: true, name: record.title || 'Untitled task', due: Number.isFinite(due) ? due : null };
    if (chip.due === null) return { ...chip, detail: 'no due date' };
    const late = today - easternDay(due);
    if (late > 0) return { ...chip, badge: `${late}d late`, detail: `${late} day${late === 1 ? '' : 's'} overdue, due ${LONG_DATE.format(due)}` };
    if (late === 0) return { ...chip, badge: 'Today', detail: 'due today' };
    return { ...chip, badge: SHORT_DATE.format(due), detail: `due ${LONG_DATE.format(due)}` };
  }).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.id.localeCompare(b.id));
}
