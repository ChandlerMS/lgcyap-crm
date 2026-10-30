export const RINGCENTRAL_ORIGIN = 'https://apps.ringcentral.com';
const BASE = `${RINGCENTRAL_ORIGIN}/integration/ringcentral-embeddable/3.0.0/`;

export function ringCentralUrl(clientId) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(clientId)) return null;
  const url = new URL('app.html', BASE);
  for (const [key, value] of Object.entries({ clientId, redirectUri: `${BASE}redirect.html`, defaultCallWith: 'browser', disableMeeting: '1', disableGlip: '1', disableMinimize: '1', enableAnalytics: '0', enableSMSTemplate: '0', enableLoadMoreCalls: '1' })) url.searchParams.set(key, value);
  return url.toString();
}

/** Only phone numbers, never URIs, extensions, control characters or dial sequences. */
export function communicationPhone(input) {
  if (typeof input !== 'string' || !/^\+?[\d ().-]{7,40}$/.test(input.trim())) return null;
  const raw = input.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Commands prepare the provider UI only. They never dial or send a message. */
export function communicationCommand(action, phone, isDemo = false) {
  const phoneNumber = communicationPhone(phone);
  if (isDemo || !phoneNumber) return null;
  if (action === 'call') return { type: 'rc-adapter-new-call', phoneNumber, toCall: false };
  if (action === 'text') return { type: 'rc-adapter-new-sms', phoneNumber, conversation: true };
  return null;
}

export function ringCentralStatus(event, frameWindow) {
  if (!frameWindow || event.origin !== RINGCENTRAL_ORIGIN || event.source !== frameWindow || !event.data || typeof event.data !== 'object') return null;
  const data = event.data;
  if (data.type === 'rc-login-status-notify' && typeof data.loggedIn === 'boolean') return { loggedIn: data.loggedIn };
  if (data.type === 'rc-dialer-status-notify' && typeof data.ready === 'boolean') return { ready: data.ready };
  return null;
}
