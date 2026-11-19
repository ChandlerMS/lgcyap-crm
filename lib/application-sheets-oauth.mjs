import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const SHEETS_OWNER = 'chandler@lgcyap.com';
export const SHEETS_SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const COOKIE = 'application_sheets_oauth';
export const SHEETS_STATE_PREFIX = 'application-sheets.';
export const sheetsOwner = user => user?.email?.toLowerCase() === SHEETS_OWNER;
// Each monthly Sheet is shared with these people as editors. The sync rewrites its managed columns, so their own
// notes belong to the right of the table or on another tab.
export const SHEETS_SHARE_WITH = Object.freeze(['sarah@lgcyap.com', 'carlos@fam1life.net']);
export const sheetsViewer = user => sheetsOwner(user) || SHEETS_SHARE_WITH.includes(user?.email?.toLowerCase());
const key = secret => {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Google Sheets encryption is not configured.');
  return createHash('sha256').update(`application-sheets-v1:${secret}`).digest();
};
export function seal(value, secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function unseal(value, secret) {
  const data = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', key(secret), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export function sheetsOAuthConfig(env) {
  const base = new URL(env.BETTER_AUTH_URL);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || (base.protocol !== 'https:' && base.hostname !== 'localhost')) throw new Error('Google Sheets OAuth is not configured.');
  key(env.BETTER_AUTH_SECRET);
  return { redirectUri: `${base.origin}/api/auth/callback/google`, secure: base.protocol === 'https:' };
}
export const clearSheetsCookie = env => `${COOKIE}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${new URL(env.BETTER_AUTH_URL).protocol === 'https:' ? '; Secure' : ''}`;
export function startSheetsConnection({ user, env, now = new Date(), report = 'applications' }) {
  if (!sheetsOwner(user)) throw new Error('Only the Sheets owner can connect.');
  if (!['applications', 'sign-ins'].includes(report)) throw new Error('Unknown Sheets report.');
  if (env.VERCEL_ENV !== 'production') throw new Error('Connect Google Sheets in production.');
  const { redirectUri, secure } = sheetsOAuthConfig(env);
  const nonce = SHEETS_STATE_PREFIX + randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const state = seal(JSON.stringify({ userId: user.userId, nonce, verifier, at: now.getTime(), report }), env.BETTER_AUTH_SECRET);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SHEETS_SCOPE, access_type: 'offline', prompt: 'consent select_account', login_hint: SHEETS_OWNER, include_granted_scopes: 'false', state: nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { url: url.href, cookie: `${COOKIE}=${state}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}` };
}

/** Provider bodies are intentionally never surfaced in errors or logs. */
export async function googleJson(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, redirect: 'error', cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(12000) });
  if (!response.ok) {
    const error = new Error('Google Sheets request failed.');
    error.code = response.status === 401 || response.status === 403 ? 'GOOGLE_PERMISSION_REQUIRED' : 'GOOGLE_UNAVAILABLE';
    throw error;
  }
  try { return await response.json(); } catch { throw new Error('Google returned an invalid response.'); }
}
export async function finishSheetsConnection(request, { user, env, db, fetchImpl = fetch, now = new Date() }) {
  if (!sheetsOwner(user) || env.VERCEL_ENV !== 'production') throw new Error('Only the Sheets owner can connect in production.');
  const { redirectUri } = sheetsOAuthConfig(env);
  const url = new URL(request.url);
  if (url.origin !== new URL(env.BETTER_AUTH_URL).origin) throw new Error('Invalid Google OAuth origin.');
  let state;
  try {
    const cookie = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    state = JSON.parse(unseal(cookie ?? '', env.BETTER_AUTH_SECRET));
    if (!['applications', 'sign-ins'].includes(state.report ?? 'applications')) throw new Error();
    const incoming = Buffer.from(url.searchParams.get('state') ?? ''), expected = Buffer.from(state.nonce);
    if (state.userId !== user.userId || now.getTime() - state.at < 0 || now.getTime() - state.at > 600000 || incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) throw new Error();
  } catch { throw new Error('Invalid or expired Google OAuth state.'); }
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || !code || code.length > 4096) throw new Error('Google Sheets authorization was not completed.');
  const token = await googleJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: state.verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) }, fetchImpl);
  if (!token.access_token || !token.refresh_token || !String(token.scope).split(' ').includes('https://www.googleapis.com/auth/drive.file')) throw new Error('Google Sheets offline permission is required.');
  const profile = await googleJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }, fetchImpl);
  if (profile.email?.toLowerCase() !== SHEETS_OWNER || profile.email_verified !== true) throw new Error('Choose the chandler@lgcyap.com Google account.');
  await db.query(`INSERT INTO application_sheets_connection (id, email, refresh_token, connected_at) VALUES (1, $1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token, connected_at = EXCLUDED.connected_at, last_error = NULL`, [SHEETS_OWNER, seal(token.refresh_token, env.BETTER_AUTH_SECRET), now]);
  return { report: state.report ?? 'applications' };
}
