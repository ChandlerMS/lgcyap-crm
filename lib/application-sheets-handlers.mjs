import { getApplicationSheetsDb } from '../db/application-sheets.mjs';
import { editorAllowed } from './hubspot-write.mjs';
import { cronAuthorized } from './recruit-lifecycle-sync.mjs';
import { applicationSheetsStatus, syncApplicationSheets } from './application-sheets-sync.mjs';
import { clearSheetsCookie, finishSheetsConnection, sheetsOwner, startSheetsConnection } from './application-sheets-oauth.mjs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });

export async function handleApplicationSheets(request, { getUser, env = process.env, getDb = getApplicationSheetsDb, sync = syncApplicationSheets, status = applicationSheetsStatus, report = 'applications' }) {
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to view the application Sheet connection.' }, 401);
    if (!editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) return json({ error: 'Application access is required.' }, 403);
    const origin = new URL(env.BETTER_AUTH_URL).origin;
    if (new URL(request.url).origin !== origin) return json({ error: 'Open the CRM directly.' }, 403);
    if (request.method === 'GET' && !sheetsOwner(user)) return json({ visible: false });
    if (request.method === 'GET') return json({ visible: true, ...await status({ db: await getDb(), user }), available: env.VERCEL_ENV === 'production' });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
    if (!sheetsOwner(user) || request.headers.get('origin') !== origin) return json({ error: 'Only Chandler can manage the Google Sheets connection from the CRM.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send a JSON request.' }, 415);
    // No applicant data is accepted by this endpoint.
    const input = await request.text();
    if (input.length > 256) return json({ error: 'Request is too large.' }, 413);
    let action;
    try { action = JSON.parse(input).action; } catch { return json({ error: 'Invalid request.' }, 400); }
    if (action === 'connect') {
      const start = startSheetsConnection({ user, env, report });
      return json({ url: start.url }, 200, { 'Set-Cookie': start.cookie });
    }
    if (action !== 'sync') return json({ error: 'Choose connect or sync.' }, 400);
    const db = await getDb();
    const result = await sync({ db, env, force: true });
    return json({ ...await status({ db, user }), result });
  } catch { return json({ error: 'The Google Sheets connection is unavailable. Try again, or reconnect Google Sheets if permission expired.' }, 503); }
}

export async function handleApplicationSheetsJob(request, { env = process.env, getDb = getApplicationSheetsDb, sync = syncApplicationSheets, notification = false, notificationKey = 'APPLICATION_SHEETS_NOTIFY_SECRET' } = {}) {
  if (request.method !== (notification ? 'POST' : 'GET')) return json({ error: 'Method not allowed.' }, 405);
  const secret = notification ? env[notificationKey] : env.CRON_SECRET;
  if (!cronAuthorized(request, secret)) return json({ error: 'Unauthorized' }, 401);
  if (env.VERCEL_ENV !== 'production') return json({ status: 'disabled' });
  try { return json(await sync({ db: await getDb(), env })); }
  catch { return json({ error: 'Application Sheets sync failed. The next scheduled run will retry.' }, 503); }
}

export async function handleApplicationSheetsCallback(request, { getUser, env = process.env, getDb = getApplicationSheetsDb, defer = promise => { void promise; }, finish = finishSheetsConnection, sync = syncApplicationSheets }) {
  let success = false, report = 'applications';
  try {
    const user = await getUser();
    if (!sheetsOwner(user)) return json({ error: 'Sign in as chandler@lgcyap.com, then connect Google Sheets again.' }, 401);
    const db = await getDb();
    const connected = await finish(request, { user, env, db });
    report = connected?.report === 'sign-ins' ? 'sign-ins' : 'applications';
    if (report === 'sign-ins') throw new Error('Monthly sign-in reports have been retired.');
    success = true;
    const work = sync({ db, env, force: true });
    defer(work.catch(() => { /* Persisted status reports the failure; cron retries. */ }));
  } catch { /* Only a fixed result is returned; no OAuth codes or provider text. */ }
  const url = new URL(env.BETTER_AUTH_URL);
  url.pathname = '/'; url.search = `?application_sheets=${success ? 'connected' : 'error'}`; url.hash = report === 'sign-ins' ? 'event-attendance' : 'applications';
  return new Response(null, { status: 303, headers: { ...headers, Location: url.href, 'Set-Cookie': clearSheetsCookie(env) } });
}
