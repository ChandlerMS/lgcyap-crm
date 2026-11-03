export const LEADERBOARD_TIME_ZONE = 'America/New_York';
const calendar = new Intl.DateTimeFormat('en-US', { timeZone: LEADERBOARD_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
function agencyDate(time) { const parts = Object.fromEntries(calendar.formatToParts(time).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
function midnight(key) {
  const noon = Date.parse(`${key}T12:00:00.000Z`); let low = noon - 27 * 3600000, high = noon;
  while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (agencyDate(mid) === key) high = mid; else low = mid; }
  return high;
}
/** Calendar period to date, including the whole current Eastern calendar day. */
export function leaderboardPeriod(period, now) {
  const time = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN;
  if (!['day', 'week', 'month'].includes(period) || !Number.isFinite(time)) throw new TypeError('Choose a valid leaderboard period.');
  const today = agencyDate(time), date = new Date(`${today}T12:00:00.000Z`);
  let startDate = today;
  if (period === 'week') { const weekday = date.getUTCDay(); date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1)); startDate = date.toISOString().slice(0, 10); }
  if (period === 'month') startDate = `${today.slice(0, 7)}-01`;
  const tomorrow = new Date(`${today}T12:00:00.000Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { startDate, endDate: today, startMs: midnight(startDate), endMs: midnight(tomorrow.toISOString().slice(0, 10)), timeZone: LEADERBOARD_TIME_ZONE };
}

export function leaderboardCustomPeriod(from, to = from) {
  const valid = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new TypeError('Choose an ordered date range of up to 366 days.');
  const next = new Date(`${to}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { startDate: from, endDate: to, startMs: midnight(from), endMs: midnight(next.toISOString().slice(0, 10)), timeZone: LEADERBOARD_TIME_ZONE };
}

export function leaderboardQuickRange(preset, now = Date.now()) {
  const today = leaderboardPeriod('day', now).startDate;
  const date = new Date(`${today}T12:00:00Z`), key = value => value.toISOString().slice(0, 10);
  if (preset === 'yesterday') { date.setUTCDate(date.getUTCDate() - 1); return { from: key(date), to: key(date) }; }
  if (preset === 'lastweek') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 1);
    const to = key(date); date.setUTCDate(date.getUTCDate() - 6); return { from: key(date), to };
  }
  if (preset === 'lastmonth') { date.setUTCDate(0); return { from: `${key(date).slice(0, 7)}-01`, to: key(date) }; }
  throw new TypeError('Choose a valid quick range.');
}
