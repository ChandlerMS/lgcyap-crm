const RECORD_ID = /^[1-9]\d{0,29}$/;
const RECORD_ROOT = 'https://app.hubspot.com/contacts/50894788/record/0-5/';
const TRACKING_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

/** Pins the existing recruiting record and removes its known tracking parameters. */
export function safeRecruitCommunicationUrl(recruitId, hubspotUrl) {
  if (typeof recruitId !== 'string' || !RECORD_ID.test(recruitId) || typeof hubspotUrl !== 'string') return null;
  const expected = `${RECORD_ROOT}${recruitId}`;
  try {
    const url = new URL(hubspotUrl);
    if (url.origin !== 'https://app.hubspot.com' || url.username || url.password || url.hash
      || url.pathname !== `/contacts/50894788/record/0-5/${recruitId}`
      || [...url.searchParams.keys()].some(key => !TRACKING_KEYS.has(key))) return null;
    return expected;
  } catch { return null; }
}

export function communicationAction(recruitId, hubspotUrl, action) {
  if (!['call', 'email'].includes(action)) return { href: null, reason: 'This HubSpot action is unavailable.' };
  const recordUrl = safeRecruitCommunicationUrl(recruitId, hubspotUrl);
  if (!recordUrl) return { href: null, reason: 'This recruiting record link could not be verified. Use Refresh to try again.' };
  // Email's interaction parameter was verified against the native ticket UI.
  // Calling has no verified composer URL: open the record for the native Call step.
  return action === 'email'
    ? { href: `${recordUrl}?interaction=email`, reason: 'Compose email in HubSpot.' }
    : { href: recordUrl, reason: 'Open recruiting record in HubSpot, then choose Call.' };
}
