import { getSessionCookie } from 'better-auth/cookies';

export const CRM_ORIGIN = 'https://crm.lgcyap.com';
export const QUEUE_ORIGIN = 'https://queue.lgcyap.com';

/** Keep the PolicyTek POST boundary same-origin on either explicitly supported host. */
export function queueReadOrigin(request, canonicalOrigin) {
  return canonicalOrigin === CRM_ORIGIN && new URL(request.url).origin === QUEUE_ORIGIN ? QUEUE_ORIGIN : canonicalOrigin;
}

/** Translate the separate Queue cookie only for server-side verification on its own host.
 * Canonical CRM cookies remain host-only and keep their original login/sign-out lifecycle.
 */
export function queueSessionHeaders(headers, canonicalOrigin) {
  if (canonicalOrigin !== CRM_ORIGIN || headers.get('host') !== 'queue.lgcyap.com') return headers;
  const signed = getSessionCookie(headers, { cookiePrefix: 'lgcy-queue' });
  if (!signed) return headers;
  const adapted = new Headers(headers);
  adapted.set('cookie', `__Secure-better-auth.session_token=${encodeURIComponent(signed)}`);
  return adapted;
}

/**
 * Google OAuth remains entirely on the canonical CRM origin. After real session
 * verification, share its verified signed session under a distinct Queue cookie name.
 * No identity or credential is accepted from a URL or sent in the redirect.
 * Revocation/sign-out still invalidates this same database session on both hosts.
 */
export async function queueAccessResponse(request, { baseURL, getSession, authorize, clock = Date.now }) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' };
  if (baseURL !== CRM_ORIGIN || new URL(request.url).origin !== CRM_ORIGIN) return new Response('Not found', { status: 404, headers });
  try {
    const session = await getSession(request.headers);
    const embedded = new URL(request.url).searchParams.get('embedded') === '1';
    if (!session && embedded) return new Response('<main><h1>Queues</h1><p>Your session expired. <a href="/sign-in?return_to=%2F%23queue" target="_top">Sign in again</a> to view the queues.</p></main>', { status: 401, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    if (!session) return new Response(null, { status: 307, headers: { ...headers, Location: `${CRM_ORIGIN}/sign-in?return_to=%2Fqueue-access` } });
    const signed = getSessionCookie(request);
    const expiry = new Date(session.session?.expiresAt ?? 0).getTime();
    if (!signed || signed.slice(0, signed.lastIndexOf('.')) !== session.session?.token || !authorize(session) || !Number.isFinite(expiry) || expiry <= clock()) return new Response('Session unavailable. Sign in again.', { status: 403, headers });
    // The browser needs a parent-domain cookie to reach both subdomains. OAuth
    // state and all other cookies retain their existing host-only scope.
    const expires = new Date(Math.min(expiry, clock() + 8 * 3600e3)).toUTCString();
    return new Response(null, { status: 307, headers: {
      ...headers,
      Location: `${QUEUE_ORIGIN}/${embedded ? "?embedded=1" : ""}`,
      'Set-Cookie': `__Secure-lgcy-queue.session_token=${encodeURIComponent(signed)}; Domain=lgcyap.com; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`,
    } });
  } catch {
    return new Response('Employee sign-in is temporarily unavailable. Please try again.', { status: 503, headers });
  }
}
