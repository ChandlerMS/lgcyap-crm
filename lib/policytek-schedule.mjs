export const POLICYTEK_REFRESH_MS = 300000;
export const POLICYTEK_STALE_MS = 900000;
export const POLICYTEK_REFRESH_HOURS = '9 AM–9 PM Eastern';
const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function elapsedSinceOpening(now) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  return hour >= 9 && hour < 21 ? ((hour - 9) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 : null;
}

/** Daily Eastern local-time window; Intl handles daylight saving transitions. */
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
