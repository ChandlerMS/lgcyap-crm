import { applyPage, sendApplication, submitApplication } from './apply';
import { invite, loginStart, loginVerify, logout, me, signedIn, type Who } from './auth';
import type { Ctx } from './env';
import * as gcal from './gcal';
import * as google from './google';
import { html, json, log, sameSecret } from './http';
import * as indeed from './indeed';
import APP_HTML from './pages/app.html';
import LOGIN_HTML from './pages/login.html';
import { getState, getVersion, putState } from './record';

// LGCY Onboard. Signed out, every page is the sign-in page except the public application (/apply) and the brand
// images; signed in, / is the CRM (src/pages/app.html) and the CRM talks to /api/*. The brand images are static
// files (public/brand), served before a request ever reaches this code.
export async function handle(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  try {
    return await route(req, env, ctx, url);
  } catch (e) {
    log('error', { path: url.pathname, error: e instanceof Error ? e.stack || e.message : String(e) });
    return url.pathname.startsWith('/api/') ? json({ error: 'server' }, 500) : new Response('Something went wrong. Try again in a minute.', { status: 500 });
  }
}

// Read the Google Calendars and the Indeed inbox, and clear expired sign-in codes and sessions.
export async function sync(env: Env): Promise<unknown[]> {
  const results = (await Promise.allSettled([gcal.pull(env), indeed.pull(env)])).map((x) => (x.status === 'fulfilled' ? x.value : String(x.reason)));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM onboard.sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('DELETE FROM onboard.login_codes WHERE expires_at < ? AND window_start < ?').bind(Date.now(), Date.now() - 3_600_000),
  ]);
  log('sync', { results });
  return results;
}

// The demo synced every 10 minutes from a timer. Here the CRM's own 12-second check (GET /api/state/version) starts a
// sync when the last one is 10 minutes old, so it runs whenever someone has the CRM open, on any Vercel plan. The daily
// cron job (scripts/build.mjs) covers the hours nobody does. The write below only succeeds if `sync:at` still holds
// the value just read, so when several requests find a sync due at once, exactly one of them runs it.
const SYNC_EVERY = 10 * 60_000;
async function syncIfDue(env: Env): Promise<void> {
  const now = Date.now();
  const last = await env.DB.prepare("SELECT value FROM onboard.kv WHERE key = 'sync:at'").first<{ value: string }>();
  if (last && now - Number(last.value) < SYNC_EVERY) return;
  const claim = await env.DB.prepare("INSERT INTO onboard.kv (key, value) VALUES ('sync:at', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE onboard.kv.value = ?")
    .bind(String(now), last?.value ?? '').run();
  if (claim.meta.changes) await sync(env);
}

async function route(req: Request, env: Env, ctx: Ctx, url: URL): Promise<Response> {
  const p = url.pathname; const m = req.method;
  if (p.startsWith('/brand/')) return new Response(null, { status: 404 });
  if (p === '/apply' || p.startsWith('/apply/')) return m === 'GET' || m === 'HEAD' ? applyPage(env, decodeURIComponent(p.slice(7))) : new Response(null, { status: 405 });

  // Vercel's cron job, which sends CRON_SECRET as a bearer token.
  if (p === '/api/cron') {
    const ok = m === 'GET' && !!env.CRON_SECRET && await sameSecret(req.headers.get('authorization') || '', `Bearer ${env.CRON_SECRET}`);
    return ok ? json({ ok: true, results: await sync(env) }) : json({ error: 'sign_in' }, 401);
  }

  // Writes must come from this site's own pages.
  const origin = req.headers.get('origin');
  if (m !== 'GET' && m !== 'HEAD' && origin && origin !== url.origin) return json({ error: 'origin' }, 403);

  if (m === 'POST' && p === '/api/apply') return submitApplication(env, req);
  if (m === 'POST' && p === '/api/login/start') return loginStart(env, req);
  if (m === 'POST' && p === '/api/login/verify') return loginVerify(env, req);

  const who = await signedIn(env, req);
  if (p.startsWith('/api/')) return who ? api(req, env, ctx, p, m, who) : json({ error: 'sign_in' }, 401);
  if (!who || p === '/login') return html(LOGIN_HTML);
  if (p === '/') return html(APP_HTML);
  return new Response(null, { status: 404 });
}

async function api(req: Request, env: Env, ctx: Ctx, p: string, m: string, who: Who): Promise<Response> {
  const key = `${m} ${p}`;
  switch (key) {
    case 'GET /api/me': return me(env, who);
    case 'POST /api/logout': return logout(env, req);
    case 'GET /api/state': return getState(env);
    case 'PUT /api/state': return putState(env, req, who.name);
    case 'GET /api/state/version':
      ctx.waitUntil(syncIfDue(env).catch((e) => log('error', { path: p, error: String(e) })));
      return getVersion(env);
    case 'POST /api/invite': return invite(env, req, who);
    case 'POST /api/apply/send': return sendApplication(env, req, who);
    case 'GET /api/google/status': return google.status(env, who.email);
    case 'GET /api/google/connect': return google.connect(env, req, who.email);
    case 'GET /api/google/callback': return google.callback(env, req, who.email);
    case 'POST /api/google/disconnect': return google.disconnect(env, who.email);
    case 'GET /api/gcal/events': return gcal.events(env);
    case 'POST /api/gcal/pull': return gcal.pullNow(env);
    case 'POST /api/gcal/invite': return gcal.invite(env, req, who);
    case 'POST /api/gcal/move': return gcal.move(env, req, who);
    case 'POST /api/gcal/group-review': return gcal.groupReview(env, req, who);
    case 'GET /api/indeed/status': return indeed.status(env);
    case 'POST /api/indeed/pull': return indeed.pullNow(env);
  }
  return json({ error: 'not_found' }, 404);
}
