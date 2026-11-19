import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { editorAllowed, hostingAllowsWrites } from './hubspot-write.mjs';

export const GMAIL_STATE_PREFIX = 'gmail.';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GMAIL_SCOPE = `openid email ${GMAIL_COMPOSE_SCOPE}`;
const COOKIE = 'gmail_oauth';
const STATE_AGE_MS = 600000;

export function gmailError(code = 'GMAIL_UNAVAILABLE', status = 503) {
  const message = code === 'GMAIL_CONNECTION_REQUIRED' ? 'Connect your Google account to create Gmail drafts.'
    : code === 'GMAIL_PERMISSION_REQUIRED' ? 'Reconnect your Google account to allow Gmail drafts.'
      : 'The Gmail connection is unavailable. Try again.';
  return Object.assign(new Error(message), { code, status });
}

const encryptionKey = secret => {
  if (typeof secret !== 'string' || secret.trim().length < 32) throw gmailError();
  return createHash('sha256').update(`gmail-v1:${secret}`).digest();
};
function seal(value, secret, context) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
function unseal(value, secret, context) {
  if (typeof value !== 'string' || value.length > 32768 || !/^[A-Za-z0-9_-]+$/.test(value)) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
  const data = Buffer.from(value, 'base64url');
  if (data.length < 29) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
const tokenContext = (user, sub) => JSON.stringify(['refresh', user.userId, user.email.trim().toLowerCase(), sub]);
export const encryptGmailRefreshToken = (token, user, sub, secret) => seal(token, secret, tokenContext(user, sub));
export function decryptGmailRefreshToken(token, user, sub, secret) {
  try { return unseal(token, secret, tokenContext(user, sub)); }
  catch { throw gmailError('GMAIL_PERMISSION_REQUIRED', 409); }
}

export function gmailOAuthConfig(env) {
  try {
    const base = new URL(env.BETTER_AUTH_URL);
    if (base.origin !== env.BETTER_AUTH_URL || base.username || base.password || base.search || base.hash
      || base.protocol !== 'https:' || !env.GOOGLE_CLIENT_ID?.trim() || !env.GOOGLE_CLIENT_SECRET?.trim()) throw new Error();
    encryptionKey(env.BETTER_AUTH_SECRET);
    return { origin: base.origin, redirectUri: `${base.origin}/api/auth/callback/google` };
  } catch { throw gmailError(); }
}
export const clearGmailCookie = () => `${COOKIE}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
export function requireGmailEditor(user, env) {
  if (!editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) throw gmailError('GMAIL_PERMISSION_REQUIRED', 403);
  if (!hostingAllowsWrites({ vercel: env.VERCEL, vercelEnv: env.VERCEL_ENV })) throw gmailError('GMAIL_PERMISSION_REQUIRED', 403);
}
export const hasGmailScope = scope => typeof scope === 'string' && scope.split(/\s+/).includes(GMAIL_COMPOSE_SCOPE);
export const validGmailToken = token => typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/[\x00-\x20\x7f]/.test(token);

export function startGmailConnection({ user, env, now = new Date() }) {
  requireGmailEditor(user, env);
  const { redirectUri } = gmailOAuthConfig(env);
  const nonce = GMAIL_STATE_PREFIX + randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const state = seal(JSON.stringify({ userId: user.userId, email: user.email.trim().toLowerCase(), nonce, verifier, at: now.getTime() }), env.BETTER_AUTH_SECRET, 'oauth-state');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPE,
    access_type: 'offline', prompt: 'consent select_account', login_hint: user.email.trim().toLowerCase(), include_granted_scopes: 'false', state: nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { url: url.href, cookie: `${COOKIE}=${state}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=600; Secure` };
}

/** Provider response bodies and transport errors are never returned or logged. */
export async function gmailGoogleJson(url, init = {}, fetchImpl = fetch) {
  let response;
  try { response = await fetchImpl(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000) }); }
  catch { throw gmailError(); }
  if (!response.ok) throw gmailError([400, 401, 403].includes(response.status) ? 'GMAIL_PERMISSION_REQUIRED' : 'GMAIL_UNAVAILABLE', [400, 401, 403].includes(response.status) ? 409 : 503);
  try {
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw gmailError(); }
}

export async function googleSubjectBound({ db, user, sub }) {
  if (typeof sub !== 'string' || !sub || sub.length > 255) return false;
  const result = await db.query('SELECT id FROM "account" WHERE "userId"=$1 AND "providerId"=$2 AND "accountId"=$3', [user.userId, 'google', sub]);
  return result.rows.length === 1;
}
export async function verifyGmailProfile({ accessToken, user, sub, db, fetchImpl = fetch }) {
  const profile = await gmailGoogleJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } }, fetchImpl);
  if (profile.email_verified !== true || typeof profile.email !== 'string' || profile.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    || (sub !== undefined && profile.sub !== sub) || !await googleSubjectBound({ db, user, sub: profile.sub })) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
  return profile;
}

export async function finishGmailConnection(request, { user, env, db, fetchImpl = fetch, now = new Date() }) {
  requireGmailEditor(user, env);
  const { origin, redirectUri } = gmailOAuthConfig(env), url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin || url.pathname !== '/api/auth/callback/google') throw gmailError('GMAIL_PERMISSION_REQUIRED', 403);
  let state;
  try {
    const cookies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
    if (cookies.length !== 1 || url.searchParams.getAll('state').length !== 1) throw new Error();
    state = JSON.parse(unseal(cookies[0].slice(COOKIE.length + 1), env.BETTER_AUTH_SECRET, 'oauth-state'));
    const incoming = Buffer.from(url.searchParams.get('state') ?? ''), expected = Buffer.from(state.nonce);
    const age = now.getTime() - state.at;
    if (state.userId !== user.userId || state.email !== user.email.trim().toLowerCase() || !Number.isFinite(state.at) || !Number.isFinite(age) || age < 0 || age > STATE_AGE_MS
      || typeof state.verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(state.verifier) || !state.nonce.startsWith(GMAIL_STATE_PREFIX)
      || incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) throw new Error();
  } catch { throw gmailError('GMAIL_PERMISSION_REQUIRED', 409); }
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !code || code.length > 4096) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
  const token = await gmailGoogleJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: state.verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) }, fetchImpl);
  if (!validGmailToken(token.access_token) || !validGmailToken(token.refresh_token) || !hasGmailScope(token.scope)) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
  const profile = await verifyGmailProfile({ accessToken: token.access_token, user, db, fetchImpl });
  await db.query(`INSERT INTO gmail_connection (user_id,email,google_sub,refresh_token,scope,connected_at) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (user_id) DO UPDATE SET email=EXCLUDED.email, google_sub=EXCLUDED.google_sub, refresh_token=EXCLUDED.refresh_token, scope=EXCLUDED.scope, connected_at=EXCLUDED.connected_at`,
  [user.userId, user.email.trim().toLowerCase(), profile.sub, encryptGmailRefreshToken(token.refresh_token, user, profile.sub, env.BETTER_AUTH_SECRET), token.scope, now]);
}
