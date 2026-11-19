import { signedInFilters, filterSignedIn } from './signed-in-filters.mjs';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApplicationExportError, DRIVE_EXPORT_SCOPE, exportGoogleSheet } from './applications-export.mjs';
import { attendancePeopleWorkbook } from './attendance-people-download.mjs';
export function exportFilters(input) {
  const { startDate = '', endDate = '' } = input ?? {};
  const valid = value => value === '' || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(startDate) || !valid(endDate) || startDate && endDate && startDate > endDate) throw new ApplicationExportError('Choose valid sign-in dates before exporting.');
  return { startDate, endDate, ...signedInFilters(input ?? {}) };
}
import { isAllowedOrigin } from './hubspot.mjs';

const COOKIE = 'crm_attendance_export';
export const EXPORT_STATE_PREFIX = 'attendance-export.';
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const signature = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');
const cookie = (value, origin, age) => `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;
function configuration(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) throw new ApplicationExportError('Google Drive export is not configured.', 503);
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  return { origin, redirect: `${origin}/api/auth/callback/google` };
}
function authorized(user) { if (!user?.userId || !user?.email) throw new ApplicationExportError('Sign in to the CRM before exporting.', 401); }
export function startApplicationExport(request, { user, env, now = Date.now() }) {
  authorized(user);
  const { origin, redirect } = configuration(env);
  if (!isAllowedOrigin(request, origin)) throw new ApplicationExportError('Open the CRM directly before exporting.', 403);
  return async input => {
    const filters = exportFilters(input);
    const state = `${EXPORT_STATE_PREFIX}${randomBytes(24).toString('base64url')}`;
    const verifier = randomBytes(32).toString('base64url');
    const pending = Buffer.from(JSON.stringify({ state, verifier, userId: user.userId, email: user.email, filters, expires: now + 10 * 60 * 1000 })).toString('base64url');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: `openid email profile ${DRIVE_EXPORT_SCOPE}`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', login_hint: user.email, access_type: 'online', prompt: 'select_account' })) url.searchParams.set(key, value);
    return Response.json({ url: url.href }, { headers: { ...privateHeaders, 'Set-Cookie': cookie(`${pending}.${signature(pending, env.BETTER_AUTH_SECRET)}`, origin, 600) } });
  };
}
function pendingExport(request, { user, env, now }) {
  authorized(user);
  const value = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
  const [payload, signed, extra] = value.split('.');
  if (!payload || !signed || extra || value.length > 4096) throw new ApplicationExportError('The Google export connection expired. Start the export again.');
  const expected = Buffer.from(signature(payload, env.BETTER_AUTH_SECRET));
  const actual = Buffer.from(signed);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApplicationExportError('The Google export connection could not be verified.');
  let pending;
  try { pending = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new ApplicationExportError('The Google export connection could not be verified.'); }
  if (pending.expires <= now || pending.expires > now + 600000 || pending.userId !== user.userId || pending.email !== user.email || pending.state !== new URL(request.url).searchParams.get('state')) throw new ApplicationExportError('The Google export connection expired or belongs to another sign-in. Start again.');
  pending.filters = exportFilters(pending.filters);
  return pending;
}
function completion(result, origin, status = 200) {
  const nonce = randomBytes(16).toString('base64');
  const message = JSON.stringify({ type: 'crm:attendance-export', ...result }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signed In export</title></head><body><h1>Signed In export</h1><p id="message"></p><a id="sheet" hidden>Open Google Sheet</a><p>You can close this window and return to the CRM.</p><script nonce="${nonce}">const result=${message};document.getElementById('message').textContent=result.error||('Saved '+result.count+' recruits to your Google Drive.');if(result.url){const link=document.getElementById('sheet');link.href=result.url;link.hidden=false;}if(window.opener){window.opener.postMessage(result,${JSON.stringify(origin)});window.close();}</script></body></html>`;
  return new Response(html, { status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie('', origin, 0), 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` } });
}
export async function finishApplicationExport(request, { user, env, readData, fetcher = fetch, now = Date.now() }) {
  let origin = 'https://crm.lgcyap.com';
  try {
    const config = configuration(env); origin = config.origin;
    if (new URL(request.url).origin !== origin) throw new ApplicationExportError('Open the CRM directly before exporting.', 403);
    const pending = pendingExport(request, { user, env, now });
    const params = new URL(request.url).searchParams;
    if (params.has('error')) throw new ApplicationExportError('Google Drive permission was not granted. You can start the export again.');
    const code = params.get('code');
    if (!code || code.length > 4096) throw new ApplicationExportError('Google did not return a valid authorization code.');
    const tokenResponse = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: pending.verifier, grant_type: 'authorization_code', redirect_uri: config.redirect }), signal: AbortSignal.timeout(20000) });
    const tokens = tokenResponse.ok ? await tokenResponse.json() : null;
    if (!tokens?.access_token || !String(tokens.scope ?? '').split(' ').includes(DRIVE_EXPORT_SCOPE)) throw new ApplicationExportError('Google Drive authorization expired or was not granted. Start a new export.');
    const identityResponse = await fetcher('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const identity = identityResponse.ok ? await identityResponse.json() : null;
    if (identity?.verified_email !== true || String(identity.email ?? '').toLowerCase() !== user.email.toLowerCase()) throw new ApplicationExportError('Choose the same Google account you use to sign in to the CRM. No recruits were exported.', 403);
    const report = await readData();
    if (report.partial) throw new ApplicationExportError('The attendance read is incomplete. Refresh and narrow the filters before exporting.', 409);
    if (pending.filters.review !== 'all' && !report.reviewComplete) throw new ApplicationExportError('Approval statuses could not be fully loaded. Refresh before exporting by status.', 409);
    const { startDate, endDate } = pending.filters;
    const onDate = day => (!startDate || day >= startDate) && (!endDate || day <= endDate);
    const days = new Map();
    for (const visit of report.visits) days.set(visit.ticketId, [...(days.get(visit.ticketId) ?? []), visit.day]);
    const dated = report.attendees.filter(person => !startDate && !endDate || (days.get(person.ticketId) ?? [person.firstDay, person.lastDay]).some(onDate));
    const applications = filterSignedIn(dated, pending.filters, report.reviews);
    if (!applications.length) throw new ApplicationExportError('No signed-in recruits match these dates.');
    const result = await exportGoogleSheet({ accessToken: tokens.access_token, applications, reviews: report.reviews, reviewComplete: report.reviewComplete, workbook: attendancePeopleWorkbook(applications), reportName: 'Signed In recruits', now: new Date(now), fetcher });
    return completion(result, origin);
  } catch (error) {
    const known = error instanceof ApplicationExportError;
    return completion({ error: known ? error.message : 'The export could not be completed. Return to the CRM and start again.' }, origin, known ? error.status : 502);
  }
}
