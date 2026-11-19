// Shopper leaderboard Calls, Submitted and Submitted premium from PolicyTek's report exports:
// "calls-report_MM-DD-YYYY_HHMM.xlsx" (every inbound call, by call date and agent) and
// "applications-report_MM-DD-YYYY_HHMM.xlsx" (every application, by submit date and agent, with Policy: Premium).
// Only per-agent daily totals leave this module. Other cells are read only as a hash, to skip rows repeated in two files.
import { createHash } from 'node:crypto';
import { leaderboardCustomPeriod, leaderboardPeriod } from './leaderboard-period.mjs';
import { validateLeaderboardInput } from './leaderboard.mjs';

export const SHOPPER_REPORTS_SOURCE = 'PolicyTek · Calls and Applications reports';
export const SHOPPER_REPORT_KINDS = Object.freeze(['calls', 'applications']);
const FILE = /^(calls|applications)-report_(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-(20\d{2})_(?:[01]\d|2[0-3])[0-5]\d(?: \(\d{1,3}\))?\.xlsx$/;
const COLUMNS = Object.freeze({
  calls: { direction: 'Direction', agent: 'Agent', date: 'Date' },
  applications: { date: 'Policy: Application Submit Date', first: 'Agent: First Name', last: 'Agent: Last Name', premium: 'Policy: Premium' },
});
const CALL_TIME = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(20\d{2}) (?:0\d|1[0-2]):[0-5]\d:[0-5]\d [ap]m$/i;
const SUBMIT_DATE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(20\d{2})$/;
// More days than this with no rows between two files of one kind means an export is probably missing.
const MAX_GAP_DAYS = 3;
const DAY_MS = 86400000;
const LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

/** Messages name files and row numbers only, never agents, callers, customers or amounts. */
export class ShopperImportError extends Error { constructor(message) { super(message); this.name = 'ShopperImportError'; } }

/** The report kind and the day it was exported, from PolicyTek's file name. Rows from the export day are incomplete. */
export function shopperReportFile(fileName) {
  const match = FILE.exec(fileName);
  if (!match) throw new ShopperImportError(`${fileName}: expected a PolicyTek export named "calls-report_MM-DD-YYYY_HHMM.xlsx" or "applications-report_MM-DD-YYYY_HHMM.xlsx".`);
  return { kind: match[1], exportDate: `${match[4]}-${match[2]}-${match[3]}` };
}

const text = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
const realDate = ([, month, day, year]) => { const key = `${year}-${month}-${day}`; return new Date(`${key}T12:00:00Z`).toISOString().slice(0, 10) === key ? key : null; };
const dayCount = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS) + 1;
const label = date => LABEL.format(new Date(`${date}T12:00:00Z`));

/** Case-folded, space-collapsed full name without single-letter middle initials: the Calls report has them and the Applications report does not. */
export function shopperAgentKey(value) {
  const words = text(value).toLowerCase().split(' ').filter(Boolean);
  return (words.length > 2 ? [words[0], ...words.slice(1, -1).filter(word => !/^\p{L}\.?$/u.test(word)), words.at(-1)] : words).join(' ');
}
const titleCase = value => value.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
/** The exports are mostly lower case; a mixed-case spelling is kept as written. */
const displayName = value => value !== value.toLowerCase() && value !== value.toUpperCase() ? value : titleCase(value);

/** Validates one export and keeps, per row, only its date, agent, premium in cents and a hash of the whole row. */
export function parseShopperReport({ fileName, sha256, sheets }) {
  const { kind, exportDate } = shopperReportFile(fileName);
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new ShopperImportError(`${fileName}: missing file checksum.`);
  const sheet = (sheets ?? []).find(item => item.sheet === 'report') ?? (sheets?.length === 1 ? sheets[0] : null);
  if (!sheet) throw new ShopperImportError(`${fileName}: the "report" sheet is missing.`);
  const [header = [], ...body] = sheet.data ?? [];
  const labels = header.map(text), named = labels.filter(Boolean);
  const at = Object.fromEntries(Object.entries(COLUMNS[kind]).map(([field, column]) => [field, labels.indexOf(column)]));
  const missing = Object.entries(COLUMNS[kind]).filter(([field]) => at[field] < 0).map(([, column]) => column);
  if (missing.length) throw new ShopperImportError(`${fileName}: row 1 is missing the ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}.`);
  if (new Set(named).size !== named.length) throw new ShopperImportError(`${fileName}: row 1 repeats a column name.`);
  const records = [], skipped = { exportDay: 0, notInbound: 0, noAgent: 0 };
  body.forEach((row, index) => {
    const line = `${fileName} row ${index + 2}`;
    if (!row?.some(value => value !== null && value !== undefined && value !== '')) return;
    let date, agent, cents = 0;
    if (kind === 'calls') {
      const match = CALL_TIME.exec(text(row[at.date]));
      date = match && realDate(match);
      if (!date) throw new ShopperImportError(`${line}: Date must be a real date written MM/DD/YYYY hh:mm:ss am.`);
      if (text(row[at.direction]) !== 'Inbound') { skipped.notInbound++; return; }
      agent = text(row[at.agent]);
    } else {
      const match = SUBMIT_DATE.exec(text(row[at.date]));
      date = match && realDate(match);
      if (!date) throw new ShopperImportError(`${line}: Policy: Application Submit Date must be a real date written MM/DD/YYYY.`);
      agent = text(`${text(row[at.first])} ${text(row[at.last])}`);
      const premium = row[at.premium];
      if (typeof premium !== 'number' || !Number.isFinite(premium) || Math.abs(premium) >= 1e8) throw new ShopperImportError(`${line}: Policy: Premium must be a number.`);
      cents = Math.round(premium * 100);
    }
    if (date >= exportDate) { skipped.exportDay++; return; }
    if (!agent) { skipped.noAgent++; return; }
    if (agent.length > 200) throw new ShopperImportError(`${line}: the agent name is longer than 200 characters.`);
    records.push({ date, agent, cents, hash: createHash('sha256').update(JSON.stringify(row)).digest('base64') });
  });
  const dates = records.map(record => record.date).sort();
  return { kind, fileName, sha256, exportDate, records, skipped, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null };
}

/**
 * Daily per-agent totals for each kind across the listed files. Each kind covers every day from its first to its last row.
 * Overlapping files must agree on the days they share, and those rows count once; rows repeated within one file are the report's own and all count.
 */
export function combineShopperReports(reports) {
  const checksums = new Set();
  for (const report of reports) { if (checksums.has(report.sha256)) throw new ShopperImportError(`${report.fileName} is the same file as another one listed.`); checksums.add(report.sha256); }
  // Two agents who differ only by middle initial keep their full names, so neither one takes the other's rows.
  const initials = new Map();
  for (const report of reports) for (const { agent } of report.records) {
    const key = shopperAgentKey(agent), full = text(agent).toLowerCase();
    if (full !== key) initials.set(key, (initials.get(key) ?? new Set()).add(full));
  }
  const ambiguous = new Set([...initials].filter(([, names]) => names.size > 1).map(([key]) => key));
  const keyFor = agent => { const key = shopperAgentKey(agent); return ambiguous.has(key) ? text(agent).toLowerCase() : key; };
  const spellings = new Map(), kinds = {}, skipped = { exportDay: 0, notInbound: 0, noAgent: 0, duplicates: 0 };
  for (const report of reports) for (const field of ['exportDay', 'notInbound', 'noAgent']) skipped[field] += report.skipped[field];
  for (const kind of SHOPPER_REPORT_KINDS) {
    const files = reports.filter(report => report.kind === kind && report.records.length).sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.lastDate.localeCompare(b.lastDate));
    if (!files.length) continue;
    let reached = files[0].lastDate;
    for (const file of files.slice(1)) {
      if (dayCount(reached, file.firstDate) - 2 > MAX_GAP_DAYS) throw new ShopperImportError(`No ${kind} rows from ${reached} to ${file.firstDate} (before ${file.fileName}). Add the missing export, or import the files on each side separately.`);
      if (file.lastDate > reached) reached = file.lastDate;
    }
    // Overlapping exports must hold the same rows on the days they share; otherwise a re-export would add rows twice.
    files.forEach((file, index) => files.slice(index + 1).forEach(other => {
      const from = file.firstDate > other.firstDate ? file.firstDate : other.firstDate, to = file.lastDate < other.lastDate ? file.lastDate : other.lastDate;
      if (from > to) return;
      const shared = report => new Set(report.records.filter(record => record.date >= from && record.date <= to).map(record => record.hash));
      const [mine, theirs] = [shared(file), shared(other)];
      if (mine.size !== theirs.size || [...mine].some(hash => !theirs.has(hash))) throw new ShopperImportError(`${file.fileName} and ${other.fileName} both cover ${from} to ${to} but differ there. Import only one export for those days.`);
    }));
    const seen = new Map(), totals = new Map();
    let records = 0;
    for (const file of files) for (const record of file.records) {
      const first = seen.get(record.hash);
      if (first !== undefined && first !== file.fileName) { skipped.duplicates++; continue; }
      seen.set(record.hash, file.fileName);
      const key = keyFor(record.agent), id = `${record.date}|${key}`, spelling = text(record.agent);
      const entry = totals.get(id) ?? { date: record.date, key, count: 0, cents: 0 };
      entry.count++; entry.cents += record.cents; records++;
      totals.set(id, entry);
      const counts = spellings.get(key) ?? new Map();
      spellings.set(key, counts.set(spelling, (counts.get(spelling) ?? 0) + 1));
    }
    kinds[kind] = { firstDate: files[0].firstDate, lastDate: reached, records, files: files.map(file => ({ name: file.fileName, sha256: file.sha256, firstDate: file.firstDate, lastDate: file.lastDate, records: file.records.length })), rows: [...totals.values()] };
  }
  // A spelling without a dropped middle initial wins, then the most common one.
  const names = new Map([...spellings].map(([key, counts]) => [key, displayName([...counts].sort(([a, countA], [b, countB]) => Number(shopperAgentKey(a) !== a.toLowerCase()) - Number(shopperAgentKey(b) !== b.toLowerCase()) || countB - countA || a.localeCompare(b))[0][0])]));
  for (const report of Object.values(kinds)) for (const row of report.rows) row.name = names.get(row.key);
  return { kinds, skipped, agents: names.size, ambiguousNames: ambiguous.size };
}

/** Replaces each imported kind's rows for every day it covers, in one transaction. Other days and the other kind are untouched. */
export async function importShopperReports(db, combined, now = Date.now()) {
  const importedAt = new Date(now).toISOString(), kinds = Object.entries(combined.kinds);
  if (!kinds.length) throw new ShopperImportError('The files have no rows to import from before their export day.');
  await db.query('BEGIN');
  try {
    for (const [kind, report] of kinds) {
      const dates = report.rows.map(row => row.date), keys = report.rows.map(row => row.key), names = report.rows.map(row => row.name), counts = report.rows.map(row => row.count);
      if (kind === 'calls') {
        await db.query('DELETE FROM shopper_calls_daily WHERE activity_date BETWEEN $1::date AND $2::date', [report.firstDate, report.lastDate]);
        await db.query('INSERT INTO shopper_calls_daily (activity_date, agent_key, agent_name, calls) SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::int[])', [dates, keys, names, counts]);
      } else {
        await db.query('DELETE FROM shopper_applications_daily WHERE activity_date BETWEEN $1::date AND $2::date', [report.firstDate, report.lastDate]);
        await db.query('INSERT INTO shopper_applications_daily (activity_date, agent_key, agent_name, applications, premium_cents) SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::int[], $5::bigint[])', [dates, keys, names, counts, report.rows.map(row => row.cents)]);
      }
      await db.query(`INSERT INTO shopper_report_days (kind, activity_date, imported_at) SELECT $1, day::date, $4::timestamptz FROM generate_series($2::date, $3::date, interval '1 day') AS day
        ON CONFLICT (kind, activity_date) DO UPDATE SET imported_at=EXCLUDED.imported_at`, [kind, report.firstDate, report.lastDate, importedAt]);
      await db.query('INSERT INTO shopper_report_imports (kind, first_date, last_date, files, records, imported_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)', [kind, report.firstDate, report.lastDate, JSON.stringify(report.files), report.records, importedAt]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  return { importedAt, kinds: Object.fromEntries(kinds.map(([kind, report]) => [kind, { firstDate: report.firstDate, lastDate: report.lastDate, records: report.records, agentDays: report.rows.length }])) };
}

/**
 * The Shopper board from the imported reports, or null unless both reports cover every day of the range, so the caller
 * keeps the PolicyTek browser sync (today, and anything after the last import). A range may start before a report's
 * first imported day: those earlier days have no activity, and the notice says so.
 */
export async function readShopperReportsLeaderboard(input, { db, now = Date.now() }) {
  const selected = validateLeaderboardInput(input);
  if (selected.board !== 'shopper') throw new TypeError('The Shopper reports reader received another board.');
  const { startDate, endDate } = selected.period === 'custom' ? leaderboardCustomPeriod(selected.from, selected.to) : leaderboardPeriod(selected.period, now);
  const params = [startDate, endDate];
  const { rows: coverage } = await db.query(`SELECT kind, to_char(min(activity_date), 'YYYY-MM-DD') AS first, to_char(max(activity_date), 'YYYY-MM-DD') AS last,
    count(*) FILTER (WHERE activity_date BETWEEN $1::date AND $2::date)::int AS covered, max(imported_at) AS imported_at FROM shopper_report_days GROUP BY kind`, params);
  const kinds = Object.fromEntries(coverage.map(row => [row.kind, row]));
  const covers = row => Boolean(row) && endDate >= row.first && endDate <= row.last && row.covered === dayCount(startDate > row.first ? startDate : row.first, endDate);
  if (!SHOPPER_REPORT_KINDS.every(kind => covers(kinds[kind]))) return null;
  const { rows: applications } = await db.query(`SELECT agent_key, (array_agg(agent_name ORDER BY activity_date DESC))[1] AS name, sum(applications)::bigint AS applications, sum(premium_cents)::bigint AS cents
    FROM shopper_applications_daily WHERE activity_date BETWEEN $1::date AND $2::date GROUP BY agent_key`, params);
  const { rows: calls } = await db.query(`SELECT agent_key, (array_agg(agent_name ORDER BY activity_date DESC))[1] AS name, sum(calls)::bigint AS calls
    FROM shopper_calls_daily WHERE activity_date BETWEEN $1::date AND $2::date GROUP BY agent_key`, params);
  // The Shopper board has always shown `leads` as its Calls column; here it holds the Calls report's calls.
  const agents = new Map(applications.map(row => [row.agent_key, { name: row.name, attributed: true, leads: 0, submitted: Number(row.applications), premium: Number(row.cents) / 100 }]));
  for (const row of calls) agents.set(row.agent_key, { ...(agents.get(row.agent_key) ?? { name: row.name, attributed: true, submitted: 0, premium: 0 }), leads: Number(row.calls) });
  const rows = [...agents.values()], sum = field => rows.reduce((total, row) => total + row[field], 0);
  const reportTotals = { leads: sum('leads'), submitted: sum('submitted'), premium: applications.reduce((total, row) => total + Number(row.cents), 0) / 100 };
  const dataThrough = SHOPPER_REPORT_KINDS.map(kind => kinds[kind].last).sort()[0];
  const callOnly = rows.filter(row => row.submitted === 0).length;
  const notes = ['Calls are the inbound calls each agent took, from the PolicyTek Calls report. Submitted and Submitted premium are applications by submit date, from the Applications report. Close rate is submitted ÷ calls.'];
  for (const kind of SHOPPER_REPORT_KINDS) if (startDate < kinds[kind].first) notes.push(`The imported ${kind === 'calls' ? 'Calls' : 'Applications'} report starts ${label(kinds[kind].first)}, so earlier days have no ${kind}.`);
  if (callOnly) notes.push(`${callOnly === 1 ? 'One agent' : `${callOnly} agents`} with calls but no applications ${callOnly === 1 ? 'counts' : 'count'} in the totals only.`);
  notes.push(`Ranges after ${label(dataThrough)} use the PolicyTek browser sync until newer reports are imported.`);
  const fetchedAt = new Date(Math.max(...SHOPPER_REPORT_KINDS.map(kind => new Date(kinds[kind].imported_at).getTime()))).toISOString();
  return { ...selected, status: 'available', source: SHOPPER_REPORTS_SOURCE, basis: 'reports', startDate, endDate, rows, reportTotals, partial: false, stale: false, fetchedAt, dataThrough, notice: notes.join(' ') };
}
