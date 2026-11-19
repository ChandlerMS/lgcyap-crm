import { createHash, randomUUID } from 'node:crypto';
import { readApplications } from './applications.mjs';
import { buildApplicationWorkbooks, easternSyncTime } from './application-sheets-layout.mjs';
import { createSheetsGoogle } from './application-sheets-google.mjs';
import { SHEETS_OWNER, sheetsOwner, unseal } from './application-sheets-oauth.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function applicationSheetsStatus({ db, user, now = new Date() }) {
  const connection = (await db.query('SELECT email, connected_at, last_success_at, last_error FROM application_sheets_connection WHERE id = 1')).rows[0];
  const month = easternSyncTime(now).day.slice(0, 7);
  const current = (await db.query('SELECT month, spreadsheet_id, synced_at FROM application_sheets_months WHERE month = $1', [month])).rows[0];
  return { owner: SHEETS_OWNER, canConnect: sheetsOwner(user), connected: Boolean(connection), lastSuccessAt: connection?.last_success_at ?? null, error: connection?.last_error ?? null,
    current: current?.synced_at ? { title: `${month.slice(5)}-${month.slice(2, 4)} Applications`, url: `https://docs.google.com/spreadsheets/d/${current.spreadsheet_id}/edit`, syncedAt: current.synced_at } : null };
}

/** One shared path for cron, manual refresh and submission notifications. Only complete reads can write. */
export async function syncApplicationSheets({ db, env = process.env, now = new Date(), fetchImpl = fetch, readReport, force = false }) {
  if (env.VERCEL_ENV !== 'production') return { status: 'disabled' };
  const connection = (await db.query('SELECT * FROM application_sheets_connection WHERE id = 1')).rows[0];
  if (!connection) return { status: 'not_connected' };
  const lease = randomUUID();
  // The production route has maxDuration=60. The two-minute lease survives a killed function.
  const claim = await db.query(`UPDATE application_sheets_connection SET lease_owner = $1, lease_until = $2
    WHERE id = 1 AND (lease_until IS NULL OR lease_until <= $3) RETURNING id`, [lease, new Date(now.getTime() + 120000), now]);
  if (!claim.rows.length) return { status: 'busy' };
  try {
    const signal = AbortSignal.timeout(50000);
    const budgetFetch = (url, init = {}) => fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
    const report = await (readReport ? readReport() : readApplications({ accessToken: env.HUBSPOT_ACCESS_TOKEN, fetchImpl: budgetFetch, strictComplete: true }));
    const existing = new Map((await db.query('SELECT * FROM application_sheets_months')).rows.map(row => [row.month, row]));
    const books = buildApplicationWorkbooks(report, now, [...existing.keys()]);
    if (force) await db.query('UPDATE application_sheets_months SET needs_repair = true');
    const clock = easternSyncTime(now), daily = clock.daily && connection.last_daily_day !== clock.day;
    let google, written = 0;
    for (const book of books) {
      signal.throwIfAborted();
      const fingerprint = digest(book), previous = existing.get(book.month);
      if (!force && !previous?.needs_repair && !(daily && previous?.repaired_day !== clock.day) && previous?.fingerprint === fingerprint) continue;
      google ??= await createSheetsGoogle({ env, refreshToken: unseal(connection.refresh_token, env.BETTER_AUTH_SECRET), fetchImpl: budgetFetch, signal });
      const id = previous?.spreadsheet_id ?? await google.ensureWorkbook(book);
      if (!previous) await db.query('INSERT INTO application_sheets_months (month, spreadsheet_id) VALUES ($1, $2)', [book.month, id]);
      await db.query('UPDATE application_sheets_months SET needs_repair = true WHERE month = $1', [book.month]);
      await google.writeWorkbook(id, book, previous?.managed_columns ?? 0);
      await db.query('UPDATE application_sheets_months SET fingerprint = $1, managed_columns = $2, synced_at = $3, needs_repair = false, repaired_day = CASE WHEN $5 THEN $6 ELSE repaired_day END WHERE month = $4', [fingerprint, book.tabs[0].values[0].length, now, book.month, daily, clock.day]);
      written++;
    }
    await db.query(`UPDATE application_sheets_connection SET last_success_at = $1, last_error = NULL,
      last_daily_day = CASE WHEN $2 THEN $3 ELSE last_daily_day END WHERE id = 1 AND lease_owner = $4`, [now, daily, clock.day, lease]);
    return { status: 'synced', written, applications: report.applications.length, daily };
  } catch (error) {
    await db.query('UPDATE application_sheets_connection SET last_error = $1 WHERE id = 1 AND lease_owner = $2', ['SYNC_FAILED', lease]);
    throw error;
  } finally {
    await db.query('UPDATE application_sheets_connection SET lease_owner = NULL, lease_until = NULL WHERE id = 1 AND lease_owner = $1', [lease]);
  }
}
