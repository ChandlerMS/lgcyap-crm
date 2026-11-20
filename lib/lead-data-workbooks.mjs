// Imports the "Instant Hangups - Daily Totals" and "Short Duration Calls - Daily Totals" workbooks into Lead Data's RingCentral numbers.
// Their Call Data sheets list single calls with caller numbers and dispositions. Only each call's date, agent and Interaction Seconds are kept, and only counts are stored.
import { leadDataDays } from './lead-data.mjs';

const KINDS = new Map([['Instant Hangups', 'instant'], ['Short Duration Calls', 'short']]);
const COLUMNS = ['Date', 'Agent', 'Interaction Seconds'];

/** Messages name files, sheets and row numbers only, never agent names or caller details. */
export class LeadDataImportError extends Error { constructor(message) { super(message); this.name = 'LeadDataImportError'; } }

const text = value => typeof value === 'string' ? value.trim() : '';
const filled = row => row?.some(value => value !== null && value !== undefined && value !== '');
const dateText = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : text(value);

/** One workbook as its kind, its month sheets' total, and one { date, name, call, seconds } row per call. */
export function parseLeadDataWorkbook({ fileName, sheets }) {
  const months = (sheets ?? []).filter(({ data }) => text(data[3]?.[0]) === 'Date' && KINDS.has(text(data[3]?.[2])));
  const kinds = new Set(months.map(({ data }) => KINDS.get(text(data[3][2]))));
  if (kinds.size !== 1) throw new LeadDataImportError(`${fileName}: expected month sheets headed "Instant Hangups" or "Short Duration Calls" on row 4.`);
  let monthTotal = 0;
  for (const { sheet, data } of months) {
    const total = data.find(row => text(row?.[0]) === 'Total')?.[2];
    if (!Number.isInteger(total) || total < 0) throw new LeadDataImportError(`${fileName} · ${sheet}: the closing Total row is missing.`);
    monthTotal += total;
  }
  const data = sheets.find(({ sheet }) => sheet === 'Call Data')?.data;
  if (!data) throw new LeadDataImportError(`${fileName}: the Call Data sheet is missing.`);
  const header = (data[0] ?? []).map(text), [dateAt, agentAt, secondsAt] = COLUMNS.map(label => header.indexOf(label));
  if ([dateAt, agentAt, secondsAt].includes(-1)) throw new LeadDataImportError(`${fileName} · Call Data: row 1 must have the columns ${COLUMNS.join(', ')}.`);
  const calls = [];
  data.slice(1).forEach((row, index) => {
    if (!filled(row)) return;
    const number = index + 2, date = dateText(row[dateAt]), seconds = row[secondsAt];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LeadDataImportError(`${fileName} · Call Data row ${number}: Date is not a date.`);
    if (!Number.isFinite(seconds) || seconds < 0) throw new LeadDataImportError(`${fileName} · Call Data row ${number}: Interaction Seconds must be a number of at least zero.`);
    calls.push({ date, name: text(row[agentAt]), call: String(number), seconds });
  });
  return { kind: [...kinds][0], fileName, monthTotal, calls };
}

/** Counts per agent per day, by the same rules as the live sync, once Call Data agrees with each workbook's own month sheets. */
export function leadDataWorkbookDays(workbooks) {
  const only = (kind, label) => {
    const found = workbooks.filter(workbook => workbook.kind === kind);
    if (found.length !== 1) throw new LeadDataImportError(`Name one ${label} workbook.`);
    return found[0];
  };
  const instant = only('instant', 'Instant Hangups'), short = only('short', 'Short Duration Calls');
  const days = leadDataDays(short.calls, instant.calls);
  const total = field => days.reduce((sum, day) => sum + day[field], 0);
  for (const [workbook, counted] of [[instant, total('instantDisconnects')], [short, total('shortDuration')]]) {
    if (workbook.monthTotal !== counted) throw new LeadDataImportError(`${workbook.fileName}: Call Data has ${counted} matching calls but the month sheets total ${workbook.monthTotal}.`);
  }
  if (!days.length) throw new LeadDataImportError('The workbooks hold no calls.');
  return days;
}

/** Replaces the dates the workbooks cover in one transaction, and says how they compare with the RingCX reports over those dates. */
export async function importLeadDataWorkbooks(db, days, now = Date.now()) {
  const dates = days.map(day => day.date).sort(), firstDate = dates[0], lastDate = dates.at(-1);
  const total = field => days.reduce((sum, day) => sum + day[field], 0);
  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM lead_data_workbook_daily WHERE call_date BETWEEN $1::date AND $2::date', [firstDate, lastDate]);
    await db.query(`INSERT INTO lead_data_workbook_daily (call_date, agent_key, agent_name, instant_disconnects, short_duration, imported_at)
      SELECT incoming.*, $6::timestamptz FROM unnest($1::date[], $2::text[], $3::text[], $4::int[], $5::int[]) AS incoming`,
    [...['date', 'key', 'name', 'instantDisconnects', 'shortDuration'].map(field => days.map(day => day[field])), new Date(now).toISOString()]);
    const { rows: [compared] } = await db.query(`WITH workbook AS (SELECT * FROM lead_data_workbook_daily WHERE call_date BETWEEN $1::date AND $2::date),
        report AS (SELECT * FROM lead_data_ringcx_daily WHERE call_date BETWEEN $1::date AND $2::date)
      SELECT coalesce(sum(report.instant_disconnects), 0)::int AS instant, coalesce(sum(report.short_duration), 0)::int AS short,
        (count(*) FILTER (WHERE coalesce(workbook.instant_disconnects, 0) <> coalesce(report.instant_disconnects, 0) OR coalesce(workbook.short_duration, 0) <> coalesce(report.short_duration, 0)))::int AS differing
      FROM workbook FULL JOIN report USING (call_date, agent_key)`, [firstDate, lastDate]);
    await db.query('COMMIT');
    return {
      rows: days.length, firstDate, lastDate, instantDisconnects: total('instantDisconnects'), shortDuration: total('shortDuration'),
      reports: { instantDisconnects: compared.instant, shortDuration: compared.short },
      differingAgentDays: compared.differing,
    };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
