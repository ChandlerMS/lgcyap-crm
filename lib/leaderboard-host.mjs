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

// TV pages a signed-in screen may return to, by their path on either host, and the
// display options a TV may keep. Anything else returns to the rotating root.
const TV_RETURN_PATHS = Object.freeze({
  '/': '/', '/leaderboard-tv': '/',
  '/standard': '/standard', '/leaderboard-tv/standard': '/standard',
  '/shopper': '/shopper', '/leaderboard-tv/shopper': '/shopper',
});
const TV_OPTIONS = Object.freeze(['boards', 'periods', 'seconds', 'rows']);

/** The leaderboard.lgcyap.com page to show after sign-in, from the access request's return_to. Never another site. */
export function leaderboardReturnPath(requestUrl) {
  let target;
  try { target = new URL(new URL(requestUrl).searchParams.get('return_to') ?? '/', 'https://tv.invalid'); } catch { return '/'; }
  if (target.origin !== 'https://tv.invalid') return '/';
  const path = TV_RETURN_PATHS[target.pathname.replace(/\/+$/, '') || '/'] ?? '/';
  const kept = new URLSearchParams();
  for (const key of TV_OPTIONS) {
    const value = target.searchParams.get(key);
    if (value && /^[a-z0-9,]{1,60}$/i.test(value)) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${path}?${query}` : path;
}

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
 * Leaderboard cookie and sends the browser back to its leaderboard.lgcyap.com page. The URL
 * only chooses among the fixed TV pages and display options; no identity or credential is
 * read from or written to a URL. Sign-out or revocation ends the same database session on both hosts.
 */
export async function leaderboardAccessResponse(request, { baseURL, getSession, authorize, clock = Date.now }) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' };
  if (baseURL !== CRM_ORIGIN || new URL(request.url).origin !== CRM_ORIGIN) return new Response('Not found', { status: 404, headers });
  try {
    const returnPath = leaderboardReturnPath(request.url);
    const access = returnPath === '/' ? '/leaderboard-access' : `/leaderboard-access?return_to=${encodeURIComponent(returnPath)}`;
    const session = await getSession(request.headers);
    if (!session) return new Response(null, { status: 307, headers: { ...headers, Location: `${CRM_ORIGIN}/sign-in?return_to=${encodeURIComponent(access)}` } });
    const signed = getSessionCookie(request);
    const expiry = new Date(session.session?.expiresAt ?? 0).getTime();
    if (!signed || signed.slice(0, signed.lastIndexOf('.')) !== session.session?.token || !authorize(session) || !Number.isFinite(expiry) || expiry <= clock()) {
      return new Response('Session unavailable. Sign in again.', { status: 403, headers });
    }
    const expires = new Date(Math.min(expiry, clock() + MAX_COOKIE_MS)).toUTCString();
    return new Response(null, { status: 307, headers: {
      ...headers,
      Location: `${LEADERBOARD_ORIGIN}${returnPath}`,
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(signed)}; Domain=lgcyap.com; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`,
    } });
  } catch {
    return new Response('Employee sign-in is temporarily unavailable. Please try again.', { status: 503, headers });
  }
}
