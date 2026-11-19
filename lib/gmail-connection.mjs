import { getGmailDb } from '../db/gmail.mjs';
import { editorAllowed, hostingAllowsWrites } from './hubspot-write.mjs';
import { clearGmailCookie, decryptGmailRefreshToken, encryptGmailRefreshToken, finishGmailConnection, gmailError, gmailGoogleJson, gmailOAuthConfig, googleSubjectBound, hasGmailScope, requireGmailEditor, startGmailConnection, validGmailToken, verifyGmailProfile } from './gmail-oauth.mjs';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
export function gmailLinks(email) {
  const base = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}`;
  return { inboxUrl: `${base}#inbox`, draftsUrl: `${base}#drafts` };
}
async function ownConnection({ user, db }) {
  const result = await db.query('SELECT user_id,email,google_sub,refresh_token,scope FROM gmail_connection WHERE user_id=$1', [user.userId]);
  const row = result.rows[0];
  if (!row || row.email !== user.email.trim().toLowerCase() || !hasGmailScope(row.scope)
    || !await googleSubjectBound({ db, user, sub: row.google_sub })) return null;
  return row;
}
export async function getGmailAccess({ user, env = process.env, db, fetchImpl = fetch }) {
  requireGmailEditor(user, env);
  gmailOAuthConfig(env);
  const connection = await ownConnection({ user, db });
  if (!connection) throw gmailError('GMAIL_CONNECTION_REQUIRED', 409);
  const refreshToken = decryptGmailRefreshToken(connection.refresh_token, user, connection.google_sub, env.BETTER_AUTH_SECRET);
  const token = await gmailGoogleJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }) }, fetchImpl);
  if (!validGmailToken(token.access_token) || (token.scope !== undefined && !hasGmailScope(token.scope))) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
  await verifyGmailProfile({ accessToken: token.access_token, user, sub: connection.google_sub, db, fetchImpl });
  if (token.refresh_token !== undefined) {
    if (!validGmailToken(token.refresh_token)) throw gmailError('GMAIL_PERMISSION_REQUIRED', 409);
    await db.query('UPDATE gmail_connection SET refresh_token=$1 WHERE user_id=$2 AND email=$3 AND google_sub=$4 AND refresh_token=$5',
      [encryptGmailRefreshToken(token.refresh_token, user, connection.google_sub, env.BETTER_AUTH_SECRET), user.userId, connection.email, connection.google_sub, connection.refresh_token]);
  }
  return { accessToken: token.access_token, email: connection.email };
}
function publicStatus({ user, env, connected = false, error }) {
  let available = hostingAllowsWrites({ vercel: env.VERCEL, vercelEnv: env.VERCEL_ENV });
  try { gmailOAuthConfig(env); } catch { available = false; }
  return { available, email: user.email, connected, ...gmailLinks(user.email), ...(error ? { error } : {}) };
}
async function readAction(request) {
  const reader = request.body?.getReader();
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 256) { await reader.cancel(); return { error: 'Request is too large.', status: 413 }; }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const value = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !['connect', 'disconnect'].includes(value.action)) throw new Error();
    return value;
  } catch { return { error: 'Choose connect or disconnect.', status: 400 }; }
}

export async function handleGmailConnection(request, { getUser, env = process.env, getDb = getGmailDb }) {
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to manage your Gmail connection.' }, 401);
    if (!editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) return json({ error: 'Employee access is required.' }, 403);
    const origin = new URL(env.BETTER_AUTH_URL).origin;
    if (new URL(request.url).origin !== origin) return json({ error: 'Open the CRM directly.' }, 403);
    if (request.method === 'GET') {
      const status = publicStatus({ user, env });
      if (!status.available) return json(status);
      return json(publicStatus({ user, env, connected: Boolean(await ownConnection({ user, db: await getDb() })) }));
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
    if (!hostingAllowsWrites({ vercel: env.VERCEL, vercelEnv: env.VERCEL_ENV }) || request.headers.get('origin') !== origin) return json({ error: 'Manage Gmail from the production CRM.' }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Send a JSON request.' }, 415);
    const action = await readAction(request);
    if (action.error) return json({ error: action.error }, action.status);
    if (action.action === 'connect') {
      const start = startGmailConnection({ user, env });
      return json({ url: start.url }, 200, { 'Set-Cookie': start.cookie });
    }
    // Never revoke Google's grant: sign-in and Sheets may share this OAuth client.
    await (await getDb()).query('DELETE FROM gmail_connection WHERE user_id=$1', [user.userId]);
    return json(publicStatus({ user, env }), 200, { 'Set-Cookie': clearGmailCookie() });
  } catch { return json({ error: 'The Gmail connection is unavailable. Try again.' }, 503); }
}

export async function handleGmailCallback(request, { getUser, env = process.env, getDb = getGmailDb, fetchImpl = fetch }) {
  let connected = false;
  try {
    const user = await getUser();
    requireGmailEditor(user, env);
    await finishGmailConnection(request, { user, env, db: await getDb(), fetchImpl });
    connected = true;
  } catch { /* Fixed callback results never include OAuth codes, tokens or provider text. */ }
  try {
    const url = new URL(gmailOAuthConfig(env).origin);
    url.search = `?gmail=${connected ? 'connected' : 'error'}`;
    url.hash = 'email';
    return new Response(null, { status: 303, headers: { ...headers, Location: url.href, 'Set-Cookie': clearGmailCookie() } });
  } catch { return json({ error: 'The Gmail connection is unavailable. Open the CRM and try again.' }, 503, { 'Set-Cookie': clearGmailCookie() }); }
}
