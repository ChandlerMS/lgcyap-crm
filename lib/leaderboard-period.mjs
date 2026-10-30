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
