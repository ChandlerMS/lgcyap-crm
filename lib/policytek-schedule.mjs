export const POLICYTEK_REFRESH_MS = 300000;
export const POLICYTEK_STALE_MS = 900000;
export const POLICYTEK_REFRESH_HOURS = '9 AM–9 PM Eastern';
/** Shopper and Source captures: every 15 minutes, Monday–Friday only. */
export const POLICYTEK_CAPTURE_MS = 900000;
/** Two missed captures plus run time before a board is marked overdue. */
export const POLICYTEK_CAPTURE_STALE_MS = 2100000;
export const POLICYTEK_CAPTURE_HOURS = '9 AM–9 PM Eastern, Monday–Friday';
const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function easternClock(now) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second) };
}

function elapsedSinceOpening(now) {
  const { hour, seconds } = easternClock(now);
  return hour >= 9 && hour < 21 ? (seconds - 9 * 3600) * 1000 : null;
}

function elapsedSinceCaptureOpening(now) {
  return ['Sat', 'Sun'].includes(easternClock(now).weekday) ? null : elapsedSinceOpening(now);
}

/** Daily Eastern local-time window for the RingCX and Lead Data syncs; Intl handles daylight saving transitions. */
export function policytekRefreshActive(now = Date.now()) {
  return elapsedSinceOpening(now) !== null;
}

/** Overnight is a scheduled pause. Allow one freshness grace period after opening. */
export function policytekSnapshotStale(capturedAt, now = Date.now()) {
  const elapsed = elapsedSinceOpening(now);
  return elapsed !== null && Math.min(elapsed, now - Date.parse(capturedAt)) > POLICYTEK_STALE_MS;
}

/** Align visible-page polling with :00, :05, :10, etc., rather than mount time. */
export function policytekNextRefreshDelay(now = Date.now()) {
  return POLICYTEK_REFRESH_MS - (now % POLICYTEK_REFRESH_MS);
}

/** PolicyTek report captures run 9 AM–9 PM Eastern on weekdays only. */
export function policytekCaptureActive(now = Date.now()) {
  return elapsedSinceCaptureOpening(now) !== null;
}

/** Nights and weekends are scheduled pauses. Allow one freshness grace period after each opening. */
export function policytekCaptureStale(capturedAt, now = Date.now()) {
  const elapsed = elapsedSinceCaptureOpening(now);
  return elapsed !== null && Math.min(elapsed, now - Date.parse(capturedAt)) > POLICYTEK_CAPTURE_STALE_MS;
}

/** When paused captures resume: the next weekday at 9 AM Eastern. */
export function policytekCaptureResumes(now = Date.now()) {
  const { weekday, hour } = easternClock(now);
  return weekday === 'Sat' || weekday === 'Sun' || (weekday === 'Fri' && hour >= 21) ? 'Monday at 9 AM Eastern' : '9 AM Eastern';
}
