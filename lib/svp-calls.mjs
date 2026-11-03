// Standard vs. Preferred answered calls imported from the "Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx" workbooks,
// and from RingCX (lib/svp-ringcx-calls.mjs) from SVP_RINGCX_BOARD_DATE on.
import { LEADERBOARD_TIME_ZONE, leaderboardPeriod } from './leaderboard-period.mjs';

export const SVP_CALLS_SOURCE = 'Agent Daily Calls reports · spreadsheet import';
/** First day the board shows RingCX counts; earlier days keep their imported workbook numbers. */
export const SVP_RINGCX_BOARD_DATE = '2026-11-03';
const RINGCX_STALE_MS = 1200000;
const READ_TIME = new Intl.DateTimeFormat('en-US', { timeZone: LEADERBOARD_TIME_ZONE, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const HEADER = ['Date', 'Agent Full Name', 'Total Calls Connected'];
const FILE_MONTH = /^Agent_Daily_Calls_(20\d{2}-(?:0[1-9]|1[0-2]))_[A-Za-z]+_20\d{2}\.xlsx$/;
const DAY_SHEET = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const UNASSIGNED = 'unassigned (no agent)';

/** Messages name files, sheets and row numbers only, never agent names or counts. */
export class SvpCallsImportError extends Error { constructor(message) { super(message); this.name = 'SvpCallsImportError'; } }

export function svpCallsReportMonth(fileName) {
  const match = FILE_MONTH.exec(fileName);
  if (!match) throw new SvpCallsImportError(`${fileName}: expected a file named "Agent_Daily_Calls_YYYY-MM_Month_YYYY.xlsx".`);
  return match[1];
}
const text = value => typeof value === 'string' ? value.trim() : '';
const dateText = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : text(value);
/** Agent names are matched case-insensitively with whitespace collapsed. */
export const svpAgentKey = value => text(value).replace(/\s+/g, ' ').toLowerCase();

/**
 * Validates one monthly workbook: every YYYY-MM-DD sheet has the header on row 4, agent rows below it, and a closing "Total" row.
 * The Monthly_Summary sheet is ignored because its totals are formulas without saved values.
 */
export function parseSvpCallsReport({ fileName, sha256, sheets }) {
  const month = svpCallsReportMonth(fileName);
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new SvpCallsImportError(`${fileName}: missing file checksum.`);
  const days = (sheets ?? []).filter(({ sheet }) => DAY_SHEET.test(sheet));
  if (!days.length) throw new SvpCallsImportError(`${fileName}: no daily YYYY-MM-DD sheets were found.`);
  const calls = new Map(), dates = [];
  let unassigned = 0;
  for (const { sheet, data } of days) {
    const where = `${fileName} · ${sheet}`;
    if (sheet.slice(0, 7) !== month) throw new SvpCallsImportError(`${where}: sheet is outside ${month}.`);
    const actual = (data[3] ?? []).slice(0, 3).map(text);
    if (HEADER.some((label, index) => actual[index] !== label)) throw new SvpCallsImportError(`${where}: row 4 must be the header ${HEADER.join(' | ')}.`);
    let closed = false;
    data.slice(4).forEach((row, index) => {
      const at = `${where} row ${index + 5}`;
      if (closed || !row?.some(value => value !== null && value !== undefined && value !== '')) return;
      if (text(row[0]) === 'Total') { closed = true; return; }
      if (dateText(row[0]) !== sheet) throw new SvpCallsImportError(`${at}: Date must match the sheet date.`);
      const agent = text(row[1]).replace(/\s+/g, ' ');
      if (!agent || agent.length > 200) throw new SvpCallsImportError(`${at}: Agent Full Name must be 1–200 characters.`);
      if (!Number.isInteger(row[2]) || row[2] < 0) throw new SvpCallsImportError(`${at}: Total Calls Connected must be a whole number of at least zero.`);
      const key = svpAgentKey(agent);
      if (key === UNASSIGNED) { unassigned += row[2]; return; }
      const entry = calls.get(`${sheet}|${key}`) ?? { date: sheet, key, name: agent, connected: 0 };
      entry.connected += row[2];
      calls.set(`${sheet}|${key}`, entry);
    });
    if (!closed) throw new SvpCallsImportError(`${where}: the closing Total row is missing.`);
    dates.push(sheet);
  }
  dates.sort();
  return { month, fileName, sha256, firstDate: dates[0], lastDate: dates.at(-1), days: dates.length, unassigned, calls: [...calls.values()] };
}

/** Replaces each listed month in one transaction; other months are untouched. */
export async function importSvpCallsReports(db, reports, now = Date.now()) {
  const months = new Set();
  for (const report of reports) { if (months.has(report.month)) throw new SvpCallsImportError(`${report.month} appears more than once.`); months.add(report.month); }
  const importedAt = new Date(now).toISOString();
  await db.query('BEGIN');
  try {
    for (const report of reports) {
      const from = `${report.month}-01`;
      await db.query("DELETE FROM svp_calls_daily WHERE call_date >= $1::date AND call_date < ($1::date + interval '1 month')", [from]);
      if (report.calls.length) await db.query(`INSERT INTO svp_calls_daily (call_date, agent_key, agent_name, connected)
        SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::int[])`, [report.calls.map(row => row.date), report.calls.map(row => row.key), report.calls.map(row => row.name), report.calls.map(row => row.connected)]);
      await db.query(`INSERT INTO svp_calls_import_months (month, source_file, source_sha256, first_date, last_date, days, unassigned, imported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (month) DO UPDATE SET source_file=EXCLUDED.source_file, source_sha256=EXCLUDED.source_sha256, first_date=EXCLUDED.first_date, last_date=EXCLUDED.last_date, days=EXCLUDED.days, unassigned=EXCLUDED.unassigned, imported_at=EXCLUDED.imported_at`,
      [report.month, report.fileName, report.sha256, report.firstDate, report.lastDate, report.days, report.unassigned, importedAt]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  return { months: [...months].sort(), rows: reports.reduce((total, report) => total + report.calls.length, 0), importedAt };
}

/**
 * Answered calls per agent for one Eastern date range. A day RingCX has fully read uses RingCX; other days use the import.
 * Coverage runs from the first such day to the last; a range wholly outside it returns not-covered so the caller can keep its other call source.
 */
export async function readSvpCalls(db, { startDate, endDate }, now = Date.now()) {
  const { rows: imports } = await db.query("SELECT to_char(min(first_date), 'YYYY-MM-DD') AS first, to_char(max(last_date), 'YYYY-MM-DD') AS last FROM svp_calls_import_months");
  const { rows: synced } = await db.query("SELECT to_char(call_date, 'YYYY-MM-DD') AS date FROM svp_ringcx_days WHERE call_date >= $1::date ORDER BY call_date", [SVP_RINGCX_BOARD_DATE]);
  const imported = imports[0]?.first ?? null, syncedDates = synced.map(row => row.date);
  const first = [imported, syncedDates[0]].filter(Boolean).sort()[0] ?? null, last = [imports[0]?.last, syncedDates.at(-1)].filter(Boolean).sort().at(-1) ?? null;
  if (!first || endDate < first || startDate > last) return { status: 'not-covered', coverageStart: first, coverageEnd: last, total: null, byAgent: new Map() };
  const live = syncedDates.filter(date => date >= startDate && date <= endDate);
  const { rows } = await db.query(`SELECT agent_key, sum(connected)::bigint AS connected FROM (
      SELECT agent_key, connected FROM svp_calls_daily WHERE call_date BETWEEN $1::date AND $2::date AND NOT call_date = ANY($3::date[])
      UNION ALL
      SELECT key, value::int FROM svp_ringcx_windows, jsonb_each_text(counts) WHERE call_date = ANY($3::date[])
    ) calls GROUP BY agent_key`, [startDate, endDate, live]);
  const byAgent = new Map(rows.map(row => [row.agent_key, Number(row.connected)]));
  let ringcx = null;
  if (live.length) {
    const { rows: sync } = await db.query('SELECT succeeded_at FROM svp_ringcx_sync');
    const readAt = sync[0]?.succeeded_at ? new Date(sync[0].succeeded_at).getTime() : null, today = endDate >= leaderboardPeriod('day', now).startDate;
    ringcx = { from: live[0], mixed: Boolean(imported) && imported < live[0] && startDate < live[0], readAt: today ? readAt : null, stale: today && readAt !== null && now - readAt > RINGCX_STALE_MS };
  }
  return { status: 'available', partial: startDate < first || endDate > last, coverageStart: first, coverageEnd: last, total: [...byAgent.values()].reduce((sum, value) => sum + value, 0), byAgent, ringcx };
}

/** Replaces HubSpot log-based call metrics on a Standard vs. Preferred result with the answered calls. */
export function applySvpCalls(result, calls) {
  if (calls.status !== 'available' || result.status !== 'available') return result;
  const matched = new Set();
  const rows = result.rows.map(row => {
    const key = svpAgentKey(row.name), connected = calls.byAgent.get(key);
    if (connected !== undefined) matched.add(key);
    const inboundCalls = row.attributed === false ? null : connected ?? 0;
    return { ...row, inboundCalls, soldPerInboundLog: inboundCalls > 0 ? row.sales / inboundCalls : null };
  });
  const sold = rows.reduce((sum, row) => sum + row.sales, 0);
  const otherAgents = [...calls.byAgent.entries()].filter(([key, value]) => !matched.has(key) && value > 0).length;
  const live = calls.ringcx;
  const notes = [live
    ? `Calls are connected (answered) calls from RingCX, checked every five minutes; RingCX reports can trail live calls by up to about 20 minutes.${live.mixed ? ` Days before ${live.from} use the Agent Daily Calls reports.` : ''} Close is sold ÷ calls.`
    : `Calls are connected (answered) calls from the Agent Daily Calls reports, ${calls.coverageStart} through ${calls.coverageEnd}; Close is sold ÷ calls.`];
  if (live?.readAt) notes.push(live.stale ? `RingCX has not updated since ${READ_TIME.format(live.readAt)}, so today's Calls may be low.` : `Last read ${READ_TIME.format(live.readAt)}.`);
  if (calls.partial) notes.push('Part of this range has no call data, so Calls and Close cover only the days that do.');
  if (otherAgents) notes.push(`${otherAgents === 1 ? 'One agent' : `${otherAgents} agents`} with calls but no Sold deals in this range ${otherAgents === 1 ? 'counts' : 'count'} in the Calls total only.`);
  return { ...result, ...(live ? { source: 'HubSpot · RingCX' } : {}), rows, calls: { status: 'available', basis: live ? (live.mixed ? 'mixed' : 'ringcx') : 'spreadsheet', total: calls.total, partial: Boolean(calls.partial), soldPerInboundLog: calls.total > 0 && result.salesComplete !== false ? sold / calls.total : null }, callNotice: notes.join(' ') };
}
