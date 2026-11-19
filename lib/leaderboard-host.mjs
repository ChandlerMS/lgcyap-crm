import { getSessionCookie } from 'better-auth/cookies';
import { CRM_ORIGIN } from './queue-host.mjs';

// leaderboard.lgcyap.com shows the TV leaderboard from this same app, following the
// queue.lgcyap.com design: Google sign-in stays on the CRM origin, and only a verified,
// unexpired session is copied into a Leaderboard-only cookie on the parent domain.
export const LEADERBOARD_HOST = 'leaderboard.lgcyap.com';
export const LEADERBOARD_ORIGIN = `https://${LEADERBOARD_HOST}`;
const COOKIE_PREFIX = 'lgcy-leaderboard';
const COOKIE_NAME = `__Secure-${COOKIE_PREFIX}.session_token`;
// A TV stays signed in for at most twelve hours, or less if the CRM session ends sooner.
const MAX_COOKIE_MS = 12 * 3600e3;

/** Leaderboard reads accept the exact Leaderboard origin as well as the CRM's own. */
export function leaderboardReadOrigin(request, canonicalOrigin) {
  return canonicalOrigin === CRM_ORIGIN && new URL(request.url).origin === LEADERBOARD_ORIGIN ? LEADERBOARD_ORIGIN : canonicalOrigin;
}

/** On the Leaderboard host only, present its cookie to Better Auth as the standard session cookie. */
export function leaderboardSessionHeaders(headers, canonicalOrigin) {
  if (canonicalOrigin !== CRM_ORIGIN || headers.get('host') !== LEADERBOARD_HOST) return headers;
  const signed = getSessionCookie(headers, { cookiePrefix: COOKIE_PREFIX });
  if (!signed) return headers;
  const adapted = new Headers(headers);
  adapted.set('cookie', `__Secure-better-auth.session_token=${encodeURIComponent(signed)}`);
  return adapted;
}

/**
 * Runs on crm.lgcyap.com/leaderboard-access. After real session verification, sets the
 * Leaderboard cookie and sends the browser to leaderboard.lgcyap.com. Nothing is read from
 * or written to a URL; sign-out or revocation ends the same database session on both hosts.
 */
export async function leaderboardAccessResponse(request, { baseURL, getSession, authorize, clock = Date.now }) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' };
  if (baseURL !== CRM_ORIGIN || new URL(request.url).origin !== CRM_ORIGIN) return new Response('Not found', { status: 404, headers });
  try {
    const session = await getSession(request.headers);
    if (!session) return new Response(null, { status: 307, headers: { ...headers, Location: `${CRM_ORIGIN}/sign-in?return_to=%2Fleaderboard-access` } });
    const signed = getSessionCookie(request);
    const expiry = new Date(session.session?.expiresAt ?? 0).getTime();
    if (!signed || signed.slice(0, signed.lastIndexOf('.')) !== session.session?.token || !authorize(session) || !Number.isFinite(expiry) || expiry <= clock()) {
      return new Response('Session unavailable. Sign in again.', { status: 403, headers });
    }
    const expires = new Date(Math.min(expiry, clock() + MAX_COOKIE_MS)).toUTCString();
    return new Response(null, { status: 307, headers: {
      ...headers,
      Location: `${LEADERBOARD_ORIGIN}/`,
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(signed)}; Domain=lgcyap.com; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`,
    } });
  } catch {
    return new Response('Employee sign-in is temporarily unavailable. Please try again.', { status: 503, headers });
  }
}
