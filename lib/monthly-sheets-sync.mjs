import { createHash, randomUUID } from 'node:crypto';
import { readApplications } from './applications.mjs';
import { readEventAttendance } from './event-attendance.mjs';
import { buildSignInWorkbooks } from './sign-in-sheets-layout.mjs';
import { buildApplicationWorkbooks, easternSyncTime } from './application-sheets-layout.mjs';
import { createSheetsGoogle } from './application-sheets-google.mjs';
import { SHEETS_OWNER, SHEETS_SHARE_WITH, sheetsOwner, sheetsViewer, unseal } from './application-sheets-oauth.mjs';
import { readRecruitRecords } from './recruit-sheet-record.mjs';
// Approve/Deny decisions and each recruit's current ticket fields ride along, so a status or field change in the CRM
// changes the month's fingerprint and rewrites its rows on the next check. A failed review read writes nothing.
export async function withRecords(report, ticketIds, options) {
  if (report.reviewNotice) throw new Error('Review decisions could not be read.');
  return { ...report, records: await readRecruitRecords(ticketIds, options) };
}
const REPORTS = {
  applications: { months: 'application_sheets_months', state: 'application_sheets_connection', title: 'Applications', layout: buildApplicationWorkbooks, count: report => report.applications.length,
    source: async options => { const report = await readApplications({ ...options, includeReviews: true }); return withRecords(report, report.applications.map(item => item.ticket?.id), options); } },
  'sign-ins': { months: 'sign_in_sheets_months', state: 'sign_in_sheets_state', title: 'Recruits', layout: buildSignInWorkbooks, count: report => report.visits.length,
    source: async options => { const report = await readEventAttendance({ ...options, includeReviews: true }); return withRecords(report, report.visits.map(visit => visit.ticketId), options); } },
};
const reviewSecrets = env => [env.EVENT_REVIEW_HMAC_SECRET, env.BETTER_AUTH_SECRET, ...(env.EVENT_REVIEW_PREVIOUS_SECRETS ?? '').split(',')].filter(Boolean);
const definition = kind => { if (!Object.hasOwn(REPORTS, kind)) throw new Error('Unknown Sheets report.'); return REPORTS[kind]; };
// A fixed, provider-free code naming the step that failed, such as HUBSPOT:HUBSPOT_RATE_LIMITED or GOOGLE_SHEETS:GOOGLE_PERMISSION_REQUIRED.
export function failureCode(stage, error, signal) {
  const detail = signal?.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : /^[A-Z][A-Z_]{2,39}$/.test(String(error?.code ?? '')) ? error.code : /partial/i.test(String(error?.message ?? '')) ? 'PARTIAL' : 'FAILED';
  return `${stage}:${detail}`;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function monthlySheetsStatus({ kind, db, user, now = new Date() }) {
  const config = definition(kind);
  const connection = (await db.query('SELECT email, connected_at, last_success_at, last_error FROM application_sheets_connection WHERE id = 1')).rows[0];
  const state = kind === 'applications' ? connection : (await db.query(`SELECT last_success_at, last_error FROM ${config.state} WHERE id = 1`)).rows[0];
  const month = easternSyncTime(now).day.slice(0, 7);
  const current = (await db.query(`SELECT month, spreadsheet_id, synced_at, shared_with, share_error FROM ${config.months} WHERE month = $1`, [month])).rows[0];
  return { owner: SHEETS_OWNER, canConnect: sheetsOwner(user), canView: sheetsViewer(user), connected: Boolean(connection), lastSuccessAt: state?.last_success_at ?? null, error: state?.last_error ?? null,
    current: current?.synced_at ? { title: `${month.slice(5)}-${month.slice(2, 4)} ${config.title}`, url: `https://docs.google.com/spreadsheets/d/${current.spreadsheet_id}/edit`, syncedAt: current.synced_at,
      sharedWith: SHEETS_SHARE_WITH.filter(email => (current.shared_with ?? []).includes(email)), sharePending: SHEETS_SHARE_WITH.filter(email => !(current.shared_with ?? []).includes(email)), shareFailed: Boolean(current.share_error) } : null };
}

/** One shared path for cron, manual refresh and submission notifications. Only complete reads can write. */
export async function syncMonthlySheets({ kind, db, env = process.env, now = new Date(), fetchImpl = fetch, readReport, force = false }) {
  const config = definition(kind);
  if (env.VERCEL_ENV !== 'production') return { status: 'disabled' };
  const connection = (await db.query('SELECT * FROM application_sheets_connection WHERE id = 1')).rows[0];
  if (!connection) return { status: 'not_connected' };
  const state = kind === 'applications' ? connection : (await db.query(`SELECT * FROM ${config.state} WHERE id = 1`)).rows[0];
  if (!state) throw new Error('Report state is not initialized.');
  const lease = randomUUID();
  // The production route has maxDuration=60. The two-minute lease survives a killed function.
  const claim = await db.query(`UPDATE ${config.state} SET lease_owner = $1, lease_until = $2
    WHERE id = 1 AND (lease_until IS NULL OR lease_until <= $3) RETURNING id`, [lease, new Date(now.getTime() + 120000), now]);
  if (!claim.rows.length) return { status: 'busy' };
  let stage = 'START', signal;
  try {
    signal = AbortSignal.timeout(50000);
    const budgetFetch = (url, init = {}) => fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
    stage = 'HUBSPOT';
    const report = await (readReport ? readReport() : config.source({ accessToken: env.HUBSPOT_ACCESS_TOKEN, fetchImpl: budgetFetch, strictComplete: true, reviewSecrets: reviewSecrets(env) }));
    stage = 'LAYOUT';
    const existing = new Map((await db.query(`SELECT * FROM ${config.months}`)).rows.map(row => [row.month, row]));
    const books = config.layout(report, now, [...existing.keys()]);
    if (force) await db.query(`UPDATE ${config.months} SET needs_repair = true`);
    const clock = easternSyncTime(now), daily = clock.daily && state.last_daily_day !== clock.day;
    let google, written = 0;
    for (const book of books) {
      signal.throwIfAborted();
      const fingerprint = digest(book), previous = existing.get(book.month);
      if (!force && !previous?.needs_repair && !(daily && previous?.repaired_day !== clock.day) && previous?.fingerprint === fingerprint) continue;
      stage = 'GOOGLE_AUTH';
      google ??= await createSheetsGoogle({ reportKind: kind, env, refreshToken: unseal(connection.refresh_token, env.BETTER_AUTH_SECRET), fetchImpl: budgetFetch, signal });
      stage = 'GOOGLE_DRIVE';
      const id = previous?.spreadsheet_id ?? await google.ensureWorkbook(book);
      if (!previous) await db.query(`INSERT INTO ${config.months} (month, spreadsheet_id) VALUES ($1, $2)`, [book.month, id]);
      await db.query(`UPDATE ${config.months} SET needs_repair = true WHERE month = $1`, [book.month]);
      stage = 'GOOGLE_SHEETS';
      await google.writeWorkbook(id, book, previous?.managed_columns ?? 0);
      await db.query(`UPDATE ${config.months} SET fingerprint = $1, managed_columns = $2, synced_at = $3, needs_repair = false, repaired_day = CASE WHEN $5 THEN $6 ELSE repaired_day END WHERE month = $4`, [fingerprint, book.tabs[0].values[0].length, now, book.month, daily, clock.day]);
      written++;
    }
    // Sharing is separate from the rows: a refused share (for example an outside address blocked by Workspace policy)
    // never blocks the data. A new month or a new recipient is tried at once; a failure retries after 9 am the next
    // day, or on Sync now.
    let shared = 0;
    for (const row of (await db.query(`SELECT month, spreadsheet_id, shared_with, share_checked_day FROM ${config.months} ORDER BY month`)).rows) {
      const missing = SHEETS_SHARE_WITH.filter(email => !(row.shared_with ?? []).includes(email));
      if (!missing.length || !(force || !row.share_checked_day || clock.daily && row.share_checked_day !== clock.day)) continue;
      signal.throwIfAborted();
      stage = 'GOOGLE_AUTH';
      google ??= await createSheetsGoogle({ reportKind: kind, env, refreshToken: unseal(connection.refresh_token, env.BETTER_AUTH_SECRET), fetchImpl: budgetFetch, signal });
      let failed = false;
      for (const email of missing) {
        try {
          await google.shareWorkbook(row.spreadsheet_id, email);
          await db.query(`UPDATE ${config.months} SET shared_with = array_append(shared_with, $1) WHERE month = $2 AND NOT ($1 = ANY(shared_with))`, [email, row.month]);
          shared++;
        } catch (error) { if (signal.aborted) throw error; failed = true; }
      }
      await db.query(`UPDATE ${config.months} SET share_checked_day = $1, share_error = $2 WHERE month = $3`, [clock.day, failed ? 'SHARE_FAILED' : null, row.month]);
    }
    await db.query(`UPDATE ${config.state} SET last_success_at = $1, last_error = NULL,
      last_daily_day = CASE WHEN $2 THEN $3 ELSE last_daily_day END WHERE id = 1 AND lease_owner = $4`, [now, daily, clock.day, lease]);
    return { status: 'synced', written, shared, [kind === 'applications' ? 'applications' : 'signIns']: config.count(report), daily };
  } catch (error) {
    const code = failureCode(stage, error, signal);
    // Only the fixed code is stored and logged, never provider text, tokens or applicant data.
    console.error(`Monthly ${config.title} Sheets sync failed: ${code}`);
    await db.query(`UPDATE ${config.state} SET last_error = $1 WHERE id = 1 AND lease_owner = $2`, [code, lease]);
    throw error;
  } finally {
    await db.query(`UPDATE ${config.state} SET lease_owner = NULL, lease_until = NULL WHERE id = 1 AND lease_owner = $1`, [lease]);
  }
}
