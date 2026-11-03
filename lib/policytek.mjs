import { leaderboardPeriod, leaderboardCustomPeriod } from './leaderboard-period.mjs';
import { validateLeaderboardInput } from './leaderboard.mjs';

import { policytekRefreshActive, policytekSnapshotStale, POLICYTEK_REFRESH_HOURS } from './policytek-schedule.mjs';
export { POLICYTEK_REFRESH_MS, POLICYTEK_STALE_MS } from './policytek-schedule.mjs';
const AGENCY = 'Legacy Agency Ffl';
const keys = ['leads', 'quoted', 'submitted', 'premium', 'spend'];
const invalid = () => new Error('PolicyTek capture was rejected: verify agency, dates, filters and complete report table.');
const boardOk = board => ['shopper', 'source'].includes(board);
const dateLabel = date => `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}`;

/** Only documented, visible report page parameters are used. Never replays browser credentials. */
export function policytekReportUrl(board, from, to) {
  if (!boardOk(board)) throw invalid();
  const bounds = leaderboardCustomPeriod(from, to);
  const url = new URL('https://app.policytek.com/reporting');
  const params = { createdAt_start: new Date(bounds.startMs).toISOString(), createdAt_end: new Date(bounds.endMs - 1).toISOString(), selectedSegment: board === 'shopper' ? 'agent' : 'sources', selectedAgentReportType: 'leads', selectedCarrierReportType: 'company', selectedPersistencyReportType: 'agent', selectedCategoryReportType: 'category', selectedDateType: 'submit', groupBy: 'state', sourceGroupBy: 'seller_source', sortBy: 'count', order: 'desc', limit: '999' };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

function numeric(value, money) {
  if (typeof value !== 'string' || !/^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(value)) throw invalid();
  const number = Number(value.replace(/[$,]/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) > 1e12 || (!money && (!Number.isSafeInteger(number) || number < 0))) throw invalid();
  return number;
}

/** Validate a UI observation before any database write; retain only aggregate report fields. */
export function parsePolicytekCapture(capture, now = Date.now()) {
  if (!capture || !boardOk(capture.board) || capture.agency !== AGENCY) throw invalid();
  let expected;
  try { expected = new URL(policytekReportUrl(capture.board, capture.startDate, capture.endDate)); } catch { throw invalid(); }
  let actual;
  try { actual = new URL(capture.url); } catch { throw invalid(); }
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.username || actual.password) throw invalid();
  if ([...actual.searchParams.keys()].some(key => !expected.searchParams.has(key))) throw invalid();
  for (const [key, value] of expected.searchParams) if (actual.searchParams.getAll(key).length !== 1 || actual.searchParams.get(key) !== value) throw invalid();
  const captured = Date.parse(capture.capturedAt);
  if (!Number.isFinite(captured) || captured > now + 60000 || captured < now - 1200000) throw invalid();
  const filters = [`Edit Created Date ${dateLabel(capture.startDate)} – ${dateLabel(capture.endDate)}`, capture.board === 'shopper' ? 'Edit Date Type Submit Date' : 'Edit Group By Seller Sources'];
  if (!Array.isArray(capture.filters) || capture.filters.length !== 2 || filters.some(filter => !capture.filters.includes(filter))) throw invalid();
  const table = capture.table;
  if (!Array.isArray(table) || table.length < 2 || table.length > 1002 || table.some(row => !Array.isArray(row) || row.some(value => typeof value !== 'string' || value.length > 250))) throw invalid();
  const headers = table[0], nameHeader = capture.board === 'shopper' ? 'Agent' : 'Source';
  const columns = { name: nameHeader, leads: 'Total', quoted: 'Quoted', submitted: 'Submitted', premium: 'Submitted Premium', spend: 'Total Spend' };
  const indexes = Object.fromEntries(Object.entries(columns).map(([key, label]) => [key, headers.indexOf(label)]));
  if (Object.values(indexes).some(index => index < 0) || new Set(headers).size !== headers.length) throw invalid();
  const rows = [], seen = new Set(); let reportTotals = null;
  for (const cells of table.slice(1)) {
    if (cells.length !== headers.length) throw invalid();
    const name = cells[indexes.name].trim().normalize('NFC');
    const row = Object.fromEntries(keys.map(key => [key, numeric(cells[indexes[key]], ['premium', 'spend'].includes(key))]));
    if ((capture.board === 'shopper' && name === 'Agency') || (capture.board === 'source' && name === '')) {
      if (reportTotals) throw invalid();
      reportTotals = row;
    } else {
      if (!name || name.length > 200 || /[\u0000-\u001f\u007f<>]/.test(name) || seen.has(name)) throw invalid();
      seen.add(name); rows.push({ name, ...row });
    }
  }
  if (!reportTotals || (!rows.length && keys.some(key => reportTotals[key] !== 0))) throw invalid();
  const partial = rows.length >= 999 || keys.some(key => Math.abs(rows.reduce((sum, row) => sum + Math.round(row[key] * 100), 0) - Math.round(reportTotals[key] * 100)) > (['premium', 'spend'].includes(key) ? Math.max(rows.length, 1) : 0));
  return { board: capture.board, startDate: capture.startDate, endDate: capture.endDate, capturedAt: new Date(captured).toISOString(), rows, reportTotals, partial };
}

/** A single atomic upsert cannot replace a newer capture or erase the last good data on failure. */
export async function savePolicytekSnapshot(db, snapshot) {
  const result = await db.query(`INSERT INTO policytek_snapshots (board, start_date, end_date, captured_at, rows, report_totals, partial)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
    ON CONFLICT (board,start_date,end_date) DO UPDATE SET captured_at=EXCLUDED.captured_at, rows=EXCLUDED.rows, report_totals=EXCLUDED.report_totals, partial=EXCLUDED.partial
    WHERE policytek_snapshots.captured_at < EXCLUDED.captured_at RETURNING board`,
  [snapshot.board, snapshot.startDate, snapshot.endDate, snapshot.capturedAt, JSON.stringify(snapshot.rows), JSON.stringify(snapshot.reportTotals), snapshot.partial]);
  return result.rows.length > 0;
}

export async function readPolicytekLeaderboard(input, { db, now = Date.now() }) {
  const selected = validateLeaderboardInput(input);
  if (!boardOk(selected.board)) throw invalid();
  const bounds = selected.period === 'custom' ? leaderboardCustomPeriod(selected.from, selected.to) : leaderboardPeriod(selected.period, now);
  const refreshActive = policytekRefreshActive(now);
  const base = { ...selected, source: 'PolicyTek · browser sync', startDate: bounds.startDate, endDate: bounds.endDate, rows: [], partial: false, refreshSeconds: 300, refreshActive, refreshHours: POLICYTEK_REFRESH_HOURS };
  const params = [selected.board, bounds.startDate, bounds.endDate];
  const { rows } = await db.query('SELECT captured_at, rows, report_totals, partial FROM policytek_snapshots WHERE board=$1 AND start_date=$2 AND end_date=$3', params);
  // Queue both boards for a Custom selection so switching tabs keeps the same scope.
  // Touching a request renews interest; never substitutes another range's snapshot.
  const requestedBoards = selected.period === 'custom' ? ['shopper', 'source'] : [selected.board];
  await db.query(`INSERT INTO policytek_report_requests (board,start_date,end_date,requested_at)
    SELECT board, $2::date, $3::date, $4::timestamptz FROM unnest($1::text[]) AS requested(board)
    ON CONFLICT (board,start_date,end_date) DO UPDATE
    SET requested_at=GREATEST(policytek_report_requests.requested_at, EXCLUDED.requested_at)`,
  [requestedBoards, bounds.startDate, bounds.endDate, new Date(now).toISOString()]);
  const saved = rows[0];
  if (!saved) return { ...base, status: 'unavailable', notice: `This exact date range is queued for browser sync during ${POLICYTEK_REFRESH_HOURS}. The computer and PolicyTek session must remain available.`, error: { code: 'POLICYTEK_PENDING', message: refreshActive ? 'Waiting for this date range to be captured from PolicyTek. Active Custom selections refresh first.' : 'Automatic updates are paused until 9 AM Eastern. This date range is queued for the next refresh window.' } };
  const stamp = new Date(saved.captured_at).toISOString(), stale = policytekSnapshotStale(stamp, now);
  const basis = selected.board === 'shopper' ? 'Agent Report · Submit Date.' : 'Source Performance · Created Date · Seller Sources. Leads without a Seller Source may be excluded from the named rows.';
  return { ...base, status: 'available', rows: saved.rows, reportTotals: saved.report_totals, partial: saved.partial, fetchedAt: stamp, stale,
    notice: `${basis} Totals are PolicyTek report totals; ranks use displayed named rows.${saved.partial ? ' Named rows do not reconcile to every report total, so rankings may be incomplete.' : ''}${stale ? ' Updates are overdue; showing the last successful capture.' : ''} ${!refreshActive ? 'Automatic updates are paused until 9 AM Eastern. Showing the last successful capture. ' : ''}Browser sync runs every five minutes during ${POLICYTEK_REFRESH_HOURS}, while the computer, Codex, and signed-in PolicyTek session are available.` };
}

/** Recent Custom selections first, then standard reports; at most eight jobs. */
export async function policytekSyncPlan(db, now = Date.now()) {
  if (!policytekRefreshActive(now)) return [];
  const standard = new Map(), jobs = new Map();
  const keyFor = (board, from, to) => `${board}:${from}:${to}`;
  const add = (target, board, from, to) => target.set(keyFor(board, from, to), { board, startDate: from, endDate: to, url: policytekReportUrl(board, from, to) });
  for (const period of ['day', 'week', 'month']) {
    const bounds = leaderboardPeriod(period, now);
    for (const board of ['shopper', 'source']) add(standard, board, bounds.startDate, bounds.endDate);
  }
  // Do not skip a current range because its previous capture completed a few
  // minutes after the last tick: that would silently turn a 5-minute cadence into 10.
  const pending = await db.query(`SELECT board, start_date::text, end_date::text FROM policytek_report_requests
    WHERE requested_at > $1::timestamptz - interval '24 hours'
    ORDER BY requested_at DESC, start_date DESC, end_date DESC, board ASC LIMIT 20`, [new Date(now).toISOString()]);
  let extras = 0;
  for (const row of pending.rows) {
    const key = keyFor(row.board, row.start_date, row.end_date);
    if (jobs.has(key)) continue;
    if (!standard.has(key)) { if (extras === 2) continue; extras++; }
    add(jobs, row.board, row.start_date, row.end_date);
  }
  for (const [key, job] of standard) if (!jobs.has(key)) jobs.set(key, job);
  return [...jobs.values()];
}
