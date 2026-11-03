import { leaderboardCustomPeriod, leaderboardPeriod } from './leaderboard-period.mjs';
import { validateLeaderboardInput } from './leaderboard.mjs';

/** First day of the dialer report in the source workbook (build_monthly.py COVERAGE_START). */
export const WHATSAPP_QUEUE_COVERAGE_START = '2026-06-17';
/** Whole-month call totals supplied by Hive Commander (not in the reports). Used for Calls and Close when a range is exactly these whole months. */
export const WHATSAPP_MONTHLY_CALLS = Object.freeze({ '2026-01': 48180, '2026-02': 45056, '2026-03': 44490, '2026-04': 43699, '2026-05': 36338, '2026-06': 28978 });
export const WHATSAPP_SOURCE = 'LAP Daily Agent Reports · spreadsheet import';
const SALES_HEADER = ['Date', 'Agent Name', 'Total Production', 'Number of Sales'];
const QUEUE_HEADER = ['Date', 'Dialer Agent Name', 'Production Agent Name', 'Sold', 'Calls', 'Connected (Answered)'];
const FILE_MONTH = /^LAP Daily Agent Report - (20\d{2}-(?:0[1-9]|1[0-2])) [A-Za-z]+\.xlsx$/;

/** Messages name sheets and row numbers only, never agent names or amounts. */
export class WhatsappImportError extends Error { constructor(message) { super(message); this.name = 'WhatsappImportError'; } }

export function whatsappReportMonth(fileName) {
  const match = FILE_MONTH.exec(fileName);
  if (!match) throw new WhatsappImportError(`${fileName}: expected a file named "LAP Daily Agent Report - YYYY-MM Month.xlsx".`);
  return match[1];
}

function dateKey(value, where) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds() || value.getUTCMilliseconds()) throw new WhatsappImportError(`${where}: Date must be a calendar date.`);
  return value.toISOString().slice(0, 10);
}
function name(value, where, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 200) throw new WhatsappImportError(`${where}: ${label} must be 1–200 characters.`);
  return text;
}
function count(value, where, label) {
  if (!Number.isInteger(value) || value < 0) throw new WhatsappImportError(`${where}: ${label} must be a whole number of at least zero.`);
  return value;
}
function header(rows, expected, sheet) {
  const actual = (rows[3] ?? []).slice(0, expected.length).map(value => typeof value === 'string' ? value.trim() : value);
  if (expected.some((label, index) => actual[index] !== label)) throw new WhatsappImportError(`${sheet}: row 4 must be the header ${expected.join(' | ')}.`);
}
const filled = row => Array.isArray(row) && row.some(value => value !== null && value !== undefined && value !== '');

/**
 * Validates one monthly report's raw "Agent Detail" and "Queue Call Data" sheets (2-D arrays from read-excel-file).
 * Rows are grouped by Eastern calendar date and case-folded name, as the reports' SUMIFS do.
 */
export function parseWhatsappReport({ fileName, sha256, agentDetail, queueCallData = null }) {
  const month = whatsappReportMonth(fileName);
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new WhatsappImportError(`${fileName}: missing file checksum.`);
  if (!Array.isArray(agentDetail)) throw new WhatsappImportError(`${fileName}: the Agent Detail sheet is missing.`);
  header(agentDetail, SALES_HEADER, `${fileName} · Agent Detail`);
  const sales = new Map(), queue = new Map();
  let last = null;
  const inMonth = (date, where) => { if (date.slice(0, 7) !== month) throw new WhatsappImportError(`${where}: date is outside ${month}.`); if (!last || date > last) last = date; return date; };
  agentDetail.slice(4).forEach((row, index) => {
    if (!filled(row)) return;
    const where = `${fileName} · Agent Detail row ${index + 5}`;
    const date = inMonth(dateKey(row[0], where), where), agent = name(row[1], where, 'Agent Name');
    if (typeof row[2] !== 'number' || !Number.isFinite(row[2])) throw new WhatsappImportError(`${where}: Total Production must be a number.`);
    const key = `${date}|${agent.toLowerCase()}`, entry = sales.get(key) ?? { date, key: agent.toLowerCase(), name: agent, sales: 0, cents: 0 };
    entry.sales += count(row[3], where, 'Number of Sales'); entry.cents += Math.round(row[2] * 100);
    sales.set(key, entry);
  });
  if (queueCallData) {
    header(queueCallData, QUEUE_HEADER, `${fileName} · Queue Call Data`);
    queueCallData.slice(4).forEach((row, index) => {
      if (!filled(row)) return;
      const where = `${fileName} · Queue Call Data row ${index + 5}`;
      const date = inMonth(dateKey(row[0], where), where);
      if (date < WHATSAPP_QUEUE_COVERAGE_START) throw new WhatsappImportError(`${where}: queue calls start ${WHATSAPP_QUEUE_COVERAGE_START}.`);
      const dialer = name(row[1], where, 'Dialer Agent Name'), mapped = row[2] === null || row[2] === undefined || row[2] === '' ? null : name(row[2], where, 'Production Agent Name');
      const key = `${date}|${dialer.toLowerCase()}`, entry = queue.get(key) ?? { date, dialerKey: dialer.toLowerCase(), key: mapped?.toLowerCase() ?? null, name: mapped, sold: 0, calls: 0, connected: 0 };
      if ((entry.key ?? null) !== (mapped?.toLowerCase() ?? null)) throw new WhatsappImportError(`${where}: the dialer seat maps to two agents on one day.`);
      entry.sold += count(row[3], where, 'Sold'); entry.calls += count(row[4], where, 'Calls'); entry.connected += count(row[5], where, 'Connected (Answered)');
      queue.set(key, entry);
    });
  }
  return { month, fileName, sha256, sales: [...sales.values()], queue: [...queue.values()], lastActivityDate: last };
}

/** Replaces each imported month in one transaction; months not supplied are left unchanged. `db` must be a single connection. */
export async function importWhatsappReports(db, reports, now = Date.now()) {
  const months = new Set();
  for (const report of reports) { if (months.has(report.month)) throw new WhatsappImportError(`${report.month} was supplied twice.`); months.add(report.month); }
  const importedAt = new Date(now).toISOString();
  await db.query('BEGIN');
  try {
    for (const report of reports) {
      const start = `${report.month}-01`;
      await db.query(`DELETE FROM whatsapp_sales_daily WHERE sale_date >= $1::date AND sale_date < ($1::date + interval '1 month')`, [start]);
      await db.query(`DELETE FROM whatsapp_queue_daily WHERE call_date >= $1::date AND call_date < ($1::date + interval '1 month')`, [start]);
      if (report.sales.length) await db.query(`INSERT INTO whatsapp_sales_daily (sale_date, agent_key, agent_name, sales, production_cents)
        SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::integer[], $5::bigint[])`,
      [report.sales.map(row => row.date), report.sales.map(row => row.key), report.sales.map(row => row.name), report.sales.map(row => row.sales), report.sales.map(row => String(row.cents))]);
      if (report.queue.length) await db.query(`INSERT INTO whatsapp_queue_daily (call_date, dialer_key, agent_key, agent_name, sold, calls, connected)
        SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::integer[], $6::integer[], $7::integer[])`,
      [report.queue.map(row => row.date), report.queue.map(row => row.dialerKey), report.queue.map(row => row.key), report.queue.map(row => row.name), report.queue.map(row => row.sold), report.queue.map(row => row.calls), report.queue.map(row => row.connected)]);
      await db.query(`INSERT INTO whatsapp_import_months (month, source_file, source_sha256, sales_rows, queue_rows, last_activity_date, imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (month) DO UPDATE SET source_file=EXCLUDED.source_file, source_sha256=EXCLUDED.source_sha256, sales_rows=EXCLUDED.sales_rows, queue_rows=EXCLUDED.queue_rows, last_activity_date=EXCLUDED.last_activity_date, imported_at=EXCLUDED.imported_at`,
      [report.month, report.fileName, report.sha256, report.sales.length, report.queue.length, report.lastActivityDate, importedAt]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  return { months: [...months].sort(), salesRows: reports.reduce((total, report) => total + report.sales.length, 0), queueRows: reports.reduce((total, report) => total + report.queue.length, 0), importedAt };
}

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const readable = date => DAY.format(new Date(`${date}T12:00:00Z`));
function monthsBetween(from, to) {
  const months = [], cursor = new Date(`${from.slice(0, 7)}-01T12:00:00Z`);
  while (cursor.toISOString().slice(0, 7) <= to.slice(0, 7)) { months.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  return months;
}

/** Ranked WhatsApp rows for one Eastern date range. Sales cover imported months only; queue calls cover WHATSAPP_QUEUE_COVERAGE_START onward. */
export async function readWhatsappLeaderboard(input, { db, now = Date.now() }) {
  const selected = validateLeaderboardInput(input);
  if (selected.board !== 'whatsapp') throw new TypeError('WhatsApp reader received another board.');
  const bounds = selected.period === 'custom' ? leaderboardCustomPeriod(selected.from, selected.to) : leaderboardPeriod(selected.period, now);
  const base = { ...selected, source: WHATSAPP_SOURCE, startDate: bounds.startDate, endDate: bounds.endDate, rows: [], partial: false };
  const { rows: imports } = await db.query("SELECT month, to_char(last_activity_date, 'YYYY-MM-DD') AS last_activity, imported_at FROM whatsapp_import_months ORDER BY month");
  if (!imports.length) return { ...base, status: 'unavailable', notice: 'WhatsApp sales have not been imported yet.', error: { code: 'WHATSAPP_NOT_IMPORTED', message: 'WhatsApp sales have not been imported yet. Run the spreadsheet import to add them.' } };
  const imported = new Set(imports.map(row => row.month));
  const missing = monthsBetween(bounds.startDate, bounds.endDate).filter(month => !imported.has(month));
  const dataThrough = imports.reduce((latest, row) => row.last_activity && row.last_activity > latest ? row.last_activity : latest, '');
  const fetchedAt = new Date(Math.max(...imports.map(row => new Date(row.imported_at).getTime()))).toISOString();
  const params = [bounds.startDate, bounds.endDate];
  const [{ rows: sales }, { rows: queue }] = await Promise.all([
    db.query(`SELECT agent_key, (array_agg(agent_name ORDER BY sale_date DESC))[1] AS name, sum(sales)::bigint AS sales, sum(production_cents)::bigint AS cents
      FROM whatsapp_sales_daily WHERE sale_date BETWEEN $1::date AND $2::date GROUP BY agent_key`, params),
    db.query(`SELECT agent_key, (array_agg(agent_name ORDER BY call_date DESC))[1] AS name, sum(sold)::bigint AS sold, sum(calls)::bigint AS calls, sum(connected)::bigint AS connected
      FROM whatsapp_queue_daily WHERE call_date BETWEEN $1::date AND $2::date GROUP BY agent_key`, params),
  ]);
  const callsCovered = bounds.endDate >= WHATSAPP_QUEUE_COVERAGE_START, callsPartial = callsCovered && bounds.startDate < WHATSAPP_QUEUE_COVERAGE_START;
  const agents = new Map();
  for (const row of sales) agents.set(row.agent_key, { name: row.name, attributed: true, sales: Number(row.sales), production: Number(row.cents) / 100, queueConnected: callsCovered ? 0 : null, queueSold: callsCovered ? 0 : null, closeRate: null });
  let unmapped = { sold: 0, connected: 0 };
  for (const row of queue) {
    if (row.agent_key === null) { unmapped = { sold: Number(row.sold), connected: Number(row.connected) }; continue; }
    const agent = agents.get(row.agent_key) ?? { name: row.name, attributed: true, sales: 0, production: 0, queueConnected: 0, queueSold: 0, closeRate: null };
    agent.queueConnected = Number(row.connected); agent.queueSold = Number(row.sold);
    agents.set(row.agent_key, agent);
  }
  const rows = [...agents.values()].map(row => ({ ...row, closeRate: row.queueConnected > 0 ? row.queueSold / row.queueConnected : null }));
  const connected = rows.reduce((total, row) => total + (row.queueConnected ?? 0), 0) + unmapped.connected, sold = rows.reduce((total, row) => total + (row.queueSold ?? 0), 0) + unmapped.sold;
  const calls = callsCovered
    ? { status: callsPartial ? 'partial' : 'available', coverageStart: WHATSAPP_QUEUE_COVERAGE_START, connected, sold, closeRate: connected > 0 ? sold / connected : null, unmappedConnected: unmapped.connected, unmappedSold: unmapped.sold }
    : { status: 'not-covered', coverageStart: WHATSAPP_QUEUE_COVERAGE_START, connected: null, sold: null, closeRate: null, unmappedConnected: null, unmappedSold: null };
  const rangeMonths = monthsBetween(bounds.startDate, bounds.endDate), monthEnd = new Date(`${bounds.endDate.slice(0, 7)}-01T12:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const wholeMonths = bounds.startDate.endsWith('-01') && bounds.endDate === monthEnd.toISOString().slice(0, 10);
  const monthlyCalls = wholeMonths && rangeMonths.every(month => WHATSAPP_MONTHLY_CALLS[month] != null)
    ? rangeMonths.reduce((total, month) => total + WHATSAPP_MONTHLY_CALLS[month], 0) : null;
  const touchesMonthly = rangeMonths.some(month => WHATSAPP_MONTHLY_CALLS[month] != null);
  const afterData = dataThrough && bounds.endDate > dataThrough;
  const notes = ['Daily agent sales and total production from the imported LAP Daily Agent Reports.'];
  if (missing.length) notes.push(`${missing.length === 1 ? 'One month' : `${missing.length} months`} in this range ${missing.length === 1 ? 'has' : 'have'} not been imported, so totals are incomplete.`);
  if (afterData) notes.push(`Imported activity runs through ${readable(dataThrough)}; later days are not included yet.`);
  if (monthlyCalls !== null) {
    const salesTotal = rows.reduce((total, row) => total + row.sales, 0);
    notes.push('Calls are the monthly call totals entered for these months, and Close is sales ÷ calls. Agent rows still show dialer queue calls where recorded.');
    if (missing.length) notes.push(`${missing.length === 1 ? 'One month' : `${missing.length} months`} in this range ${missing.length === 1 ? 'has' : 'have'} not been imported, so totals are incomplete.`);
    if (afterData) notes.push(`Imported activity runs through ${readable(dataThrough)}; later days are not included yet.`);
    return { ...base, status: 'available', rows, partial: missing.length > 0 || Boolean(afterData), dataThrough: dataThrough || null, fetchedAt, notice: notes.join(' '),
      calls: { status: 'available', basis: 'monthly', coverageStart: WHATSAPP_QUEUE_COVERAGE_START, connected: monthlyCalls, sold: salesTotal, closeRate: monthlyCalls > 0 ? salesTotal / monthlyCalls : null, unmappedConnected: null, unmappedSold: null } };
  }
  if (touchesMonthly) notes.push('Monthly call totals for January–June 2026 appear when the range is whole months within that period.');
  if (!callsCovered) notes.push(`Dialer queue calls start ${readable(WHATSAPP_QUEUE_COVERAGE_START)}, so Calls and Close are not available for this range.`);
  else if (callsPartial) notes.push(`Calls and Close cover ${readable(WHATSAPP_QUEUE_COVERAGE_START)} onward only.`);
  if (callsCovered && unmapped.connected > 0) notes.push('Some calls came from dialer seats not mapped to an agent; they count in the Calls and Close totals but not in any agent row.');
  return { ...base, status: 'available', rows, partial: missing.length > 0 || Boolean(afterData), calls, dataThrough: dataThrough || null, fetchedAt, notice: notes.join(' ') };
}
