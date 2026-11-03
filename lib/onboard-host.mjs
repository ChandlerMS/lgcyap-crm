import { appHtml, envFrom, postgres, findMember, readState, putState, TEAM, handle, randomToken, sha256 } from './generated/onboard-runtime.mjs';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status) => Response.json(body, { status, headers: PRIVATE_HEADERS });

// Never pass the CRM's HubSpot, Google login, RingCentral or email credentials
// into the independent app. Only explicit ONBOARD_* integrations are available.
export function onboardEnvironment(values, db = postgres(values.ONBOARD_DATABASE_URL || values.DATABASE_URL)) {
  const settings = { VERCEL: values.VERCEL || '1' };
  for (const key of ['OWNER_EMAILS', 'MAIL_FROM', 'MAIL_FROM_NAME', 'TEAM_CALENDARS', 'INDEED_INBOX', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TEAM_REFRESH_TOKEN', 'GOOGLE_INBOX_REFRESH_TOKEN', 'CRON_SECRET']) {
    if (values[`ONBOARD_${key}`]) settings[key] = values[`ONBOARD_${key}`];
  }
  return envFrom(settings, db);
}

// Hosting-only changes: namespace root URLs and make sign-out use the shared
// login. No CSS, layout, controls, app logic or sample datasets are rewritten.
export function mountOnboardHtml(source = appHtml) {
  return source
    .replaceAll('"/brand/', '"/v2/brand/')
    .replaceAll("'/brand/", "'/v2/brand/")
    .replaceAll("'/api/", "'/api/v2/")
    .replaceAll('"/api/', '"/api/v2/')
    .replaceAll("const API = '/api';", "const API = '/api/v2';")
    .replaceAll('href="/"', 'href="/v2/app"')
    .replaceAll("location.replace('/')", "window.top.location.replace('/sign-in?return_to=%2Fv2')")
    .replaceAll("location.replace('/login')", "window.top.location.replace('/sign-in?return_to=%2Fv2')")
    .replace("fetch(API + '/logout', { method: 'POST' }).finally(() => window.top.location.replace('/sign-in?return_to=%2Fv2'))", "window.top.location.assign('/sign-out')");
}

export function onboardDocument() {
  return new Response(mountOnboardHtml(), { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}

// Existing source users retain their original roles. A newly approved CRM login
// gets an ordinary recruiter profile, never an inferred admin/owner role.
async function ensureMember(env, user) {
  const existing = await findMember(env, user.email);
  if (existing) return existing;
  const member = { name: user.displayName, email: user.email, role: 'Recruiter', roles: ['recruiter'], access: ['recruiter'], status: 'active', ini: user.displayName.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(), color: '#e3bf5e' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await env.DB.prepare('SELECT version FROM onboard.record WHERE id = 1').first();
    const state = await readState(env) || { v: 1, cands: [], tasks: [], team: structuredClone(TEAM), nextId: 1 };
    const found = state.team?.find(person => String(person.email || '').toLowerCase() === user.email);
    if (found) return found;
    state.team = [...(state.team || structuredClone(TEAM)), member];
    const result = await putState(env, new Request('https://onboard.internal/api/state', { method: 'PUT', headers: { 'if-match': String(row?.version ?? 0) }, body: JSON.stringify(state) }), 'Shared sign-in');
    if (result.ok) return member;
    if (result.status !== 409) throw new Error('Could not provision Version 2 access');
  }
  throw new Error('Version 2 is busy. Try again.');
}

/**
 * @param {Request} request
 * @param {{user?: {email:string, displayName:string}|null, env: ReturnType<typeof onboardEnvironment>, waitUntil?: (work:Promise<unknown>) => void, publicApplication?:boolean}} options
 */
export async function serveOnboard(request, { user = null, env, waitUntil = () => {}, publicApplication = false }) {
  const url = new URL(request.url);
  const path = url.pathname.startsWith('/api/v2/') ? url.pathname.replace('/api/v2/', '/api/') : url.pathname.replace(/^\/v2/, '');
  const isPublicApplication = publicApplication && (path === '/api/apply' || path === '/apply' || path.startsWith('/apply/'));
  if (!isPublicApplication && !user) return json({ error: 'sign_in' }, 401);
  if (['/api/cron', '/api/logout'].includes(path) || path.startsWith('/api/login/')) return json({ error: 'not_found' }, 404);
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== url.origin) return json({ error: 'origin' }, 403);
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
  if (body && Buffer.byteLength(body) > 4 * 1024 * 1024) return json({ error: 'too_large' }, 413);
  const headers = new Headers(request.headers);
  headers.delete('cookie'); headers.delete('authorization');
  let sessionId;
  try {
    if (!isPublicApplication) {
      const member = await ensureMember(env, user);
      if (member.status === 'inactive') return json({ error: 'sign_in' }, 403);
      // A one-request internal session lets the original signedIn() perform its
      // own member/role check. This token is never sent to the browser.
      const token = randomToken(); sessionId = await sha256(token);
      const now = Date.now();
      await env.DB.prepare('INSERT INTO onboard.sessions (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(sessionId, user.email, now, now + 60000).run();
      headers.set('cookie', `lgcy_session=${token}`);
    }
    const internalUrl = new URL(url); internalUrl.pathname = path;
    const response = await handle(new Request(internalUrl, { method: request.method, headers, body }), env, { waitUntil });
    const resultHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) resultHeaders.set(name, value);
    resultHeaders.delete('set-cookie');
    const location = resultHeaders.get('location');
    if (location?.startsWith('/') && !location.startsWith('//')) resultHeaders.set('location', location.startsWith('/#') ? `/v2/app${location.slice(1)}` : `/v2${location}`);
    if (resultHeaders.get('content-type')?.includes('text/html')) return new Response(mountOnboardHtml(await response.text()), { status: response.status, headers: resultHeaders });
    return new Response(response.body, { status: response.status, headers: resultHeaders });
  } finally {
    if (sessionId) await env.DB.prepare('DELETE FROM onboard.sessions WHERE id = ?').bind(sessionId).run();
  }
}
