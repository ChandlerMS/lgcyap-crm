import { json, log, nowIso, randomToken, redirect, sha256 } from './http';

// Google access for LGCY Onboard, three ways:
// - the team approval (GOOGLE_TEAM_REFRESH_TOKEN, scripts/authorize-calendar.mjs): sends email as MAIL_FROM and
//   reads/writes TEAM_CALENDARS;
// - the inbox approval (GOOGLE_INBOX_REFRESH_TOKEN, scripts/authorize-inbox.mjs): reads Indeed notices;
// - each person's own calendar, connected from Settings (/api/google/connect).
export class GoogleError extends Error {
  constructor(public why: string, detail?: string) { super(detail || why); }
}

export const clientReady = (env: Env): boolean => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const teamReady = (env: Env): boolean => clientReady(env) && !!env.GOOGLE_TEAM_REFRESH_TOKEN;
export const inboxReady = (env: Env): boolean => clientReady(env) && !!env.GOOGLE_INBOX_REFRESH_TOKEN;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';

// Access tokens live about an hour; they are cached in kv next to a fingerprint of the refresh token they came from.
export async function accessToken(env: Env, refresh: string, key: string): Promise<string> {
  const k = 'tok:' + key; const fp = (await sha256(refresh)).slice(0, 16);
  const hit = await env.DB.prepare('SELECT value FROM onboard.kv WHERE key = ?').bind(k).first<{ value: string }>();
  if (hit) { const v = JSON.parse(hit.value) as { t: string; exp: number; fp: string }; if (v.fp === fp && v.exp > Date.now() + 60_000) return v.t; }
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }) });
  const d = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !d.access_token) {
    log('google_token_failed', { key, status: r.status, error: d.error });
    throw new GoogleError(d.error === 'invalid_grant' ? 'reauthorize' : 'google_token_' + r.status);
  }
  await env.DB.prepare('INSERT INTO onboard.kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').bind(k, JSON.stringify({ t: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000, fp })).run();
  return d.access_token;
}

export const teamToken = (env: Env): Promise<string> => accessToken(env, env.GOOGLE_TEAM_REFRESH_TOKEN, 'team');
export const inboxToken = (env: Env): Promise<string> => accessToken(env, env.GOOGLE_INBOX_REFRESH_TOKEN, 'inbox');

interface TokenRow { email: string; google_email: string; refresh_token: string; scope: string | null; connected_at: string }
export const connectedRows = async (env: Env): Promise<TokenRow[]> =>
  (await env.DB.prepare('SELECT email, google_email, refresh_token, scope, connected_at FROM onboard.google_tokens').all<TokenRow>()).results;

// A calendar is read and written with its owner's own connection when they made one, else with the team approval.
export async function calendarToken(env: Env, calendar: string): Promise<string> {
  const own = await env.DB.prepare('SELECT email, refresh_token FROM onboard.google_tokens WHERE google_email = ? OR email = ? LIMIT 1').bind(calendar, calendar).first<{ email: string; refresh_token: string }>();
  if (own) return accessToken(env, own.refresh_token, 'user:' + own.email);
  if (!teamReady(env)) throw new GoogleError('not_configured');
  return teamToken(env);
}

export async function gapi<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {} as T;
  const d = await r.json().catch(() => ({})) as T & { error?: { message?: string; status?: string } };
  if (!r.ok) {
    log('google_api_failed', { method, url: url.split('?')[0], status: r.status, message: d.error?.message });
    throw new GoogleError(r.status === 401 ? 'reauthorize' : r.status === 404 ? 'not_found' : 'google_' + r.status, d.error?.message);
  }
  return d;
}

// ---- Each person's own Google Calendar (Settings → My Google Calendar) ----

const BACKS = ['settings', 'calendar'];

export async function connect(env: Env, req: Request, email: string): Promise<Response> {
  const url = new URL(req.url); const back = BACKS.includes(url.searchParams.get('back') || '') ? url.searchParams.get('back')! : 'settings';
  if (!clientReady(env)) return redirect(`/#${back}?google=not_configured`);
  const state = randomToken(24);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM onboard.oauth_states WHERE created_at < ?').bind(Date.now() - 600_000),
    env.DB.prepare('INSERT INTO onboard.oauth_states (state, email, back, created_at) VALUES (?, ?, ?, ?)').bind(state, email, back, Date.now()),
  ]);
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/api/google/callback', response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', login_hint: email, state });
  return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}

export async function callback(env: Env, req: Request, email: string): Promise<Response> {
  const url = new URL(req.url); const p = url.searchParams;
  const st = await env.DB.prepare('SELECT email, back, created_at FROM onboard.oauth_states WHERE state = ?').bind(p.get('state') || '').first<{ email: string; back: string; created_at: number }>();
  if (st) await env.DB.prepare('DELETE FROM onboard.oauth_states WHERE state = ?').bind(p.get('state')).run();
  const back = st?.back || 'settings'; const done = (why: string) => redirect(`/#${back}?google=${why}`);
  if (!st || st.email !== email || st.created_at < Date.now() - 600_000) return done('expired');
  if (p.get('error')) return done(p.get('error') === 'access_denied' ? 'denied' : 'error');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: p.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + '/api/google/callback', grant_type: 'authorization_code' }) });
  const d = await r.json().catch(() => ({})) as { refresh_token?: string; scope?: string; id_token?: string };
  if (!r.ok || !d.refresh_token) { log('google_connect_failed', { status: r.status }); return done('error'); }
  if (!/calendar/.test(d.scope || '')) return done('no_calendar');
  // The id_token comes straight from Google's token endpoint over TLS, so its payload can be read as is.
  let googleEmail = email;
  try { googleEmail = String(JSON.parse(atob((d.id_token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || email).toLowerCase(); } catch { /* keep the sign-in email */ }
  await env.DB.prepare('INSERT INTO onboard.google_tokens (email, google_email, refresh_token, scope, connected_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET google_email = EXCLUDED.google_email, refresh_token = EXCLUDED.refresh_token, scope = EXCLUDED.scope, connected_at = EXCLUDED.connected_at').bind(email, googleEmail, d.refresh_token, d.scope || null, nowIso()).run();
  await env.DB.prepare('DELETE FROM onboard.kv WHERE key = ?').bind('tok:user:' + email).run();
  log('google_connected', { email, googleEmail });
  return done('connected');
}

export async function status(env: Env, email: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT google_email, connected_at FROM onboard.google_tokens WHERE email = ?').bind(email).first<{ google_email: string; connected_at: string }>();
  return json({ configured: clientReady(env), connected: !!row, googleEmail: row?.google_email ?? null, connectedAt: row?.connected_at ?? null });
}

export async function disconnect(env: Env, email: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT refresh_token FROM onboard.google_tokens WHERE email = ?').bind(email).first<{ refresh_token: string }>();
  if (row) await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: row.refresh_token }) }).catch(() => null);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM onboard.google_tokens WHERE email = ?').bind(email),
    env.DB.prepare('DELETE FROM onboard.kv WHERE key = ?').bind('tok:user:' + email),
  ]);
  return json({ ok: true });
}
