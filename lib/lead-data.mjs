// Lead Data's RingCentral numbers: Instant Disconnects and Short Duration Calls per agent per day, read every five minutes from the RingCX reports
// "Instant Hangups" and "Short Duration Calls". Those reports list single calls with caller numbers, notes and recording links.
// This asks RingCX only for each call's day, agent and ID, and stores only counts.
import { leaderboardCustomPeriod, leaderboardPeriod } from './leaderboard-period.mjs';
import { validateLeaderboardInput } from './leaderboard.mjs';
import { POLICYTEK_REFRESH_HOURS, policytekSnapshotStale } from './policytek-schedule.mjs';
import { RingCxError } from './ringcx.mjs';
import { reportLoadedLabel } from './svp-calls.mjs';
import { addDays, LAST_LOAD_METRIC, openRingcxAnalytics, RECHECK_DAYS, RUN_GAP_MS, SVP_REPORT_FIRST_DATE, svpReportAgentKey } from './svp-ringcx-calls.mjs';

const SHORT_REPORT = 'aav8r2fboaCP', INSTANT_REPORT = 'aar8hEE2iLsP', SHORT_TITLE = 'Short Duration Calls', INSTANT_TITLE = 'Instant Hangups';
const DATE_SET = 'interactionstart.dataset.dt', DATE_LABEL = 'interactionstart.date.day.yyyy_mm_dd', AGENT_LABEL = 'label.agent.agentfullname', CALL_LABEL = 'label.segment.uii', STATE_LABEL = 'label.anigeolocation.state', TIME_METRIC = 'aadwtIPjxoof';
/** Both reports filter on a handle time of 0-9 seconds, so this is what sets an instant disconnect apart. */
export const INSTANT_DISCONNECT_SECONDS = 2;
const NO_AGENT = 'n/a';
const POLICYTEK_NOT_CONNECTED = Object.freeze({ status: 'connection-required', message: "The PolicyTek reports this app reads don't include Instant Disconnects or Short Duration Calls, so there is nothing to show yet." });

const changed = detail => new RingCxError('REPORT_CHANGED', 503, detail);
const invalid = detail => new RingCxError('INVALID_REPORT_RESPONSE', 503, detail);

/** A saved report as one execution with a row per call. Its filters carry over; only its date range is replaced. */
export function leadReportExecution(content, { dateSet, dateLabel, agentLabel, callLabel, stateLabel, timeMetric }, from, to) {
  const items = id => content?.buckets?.find(bucket => bucket.localIdentifier === id)?.items ?? [];
  const columns = items('attribute').map(item => item.visualizationAttribute?.displayForm?.uri);
  if (!columns.includes(agentLabel)) throw changed('no agent column');
  const time = items('measures').map(item => item.measure).find(measure => measure?.definition?.measureDefinition?.item?.uri === timeMetric);
  if (!time) throw changed('no Interaction Time measure');
  const filters = content.filters ?? [], dated = filters.filter(filter => filter.relativeDateFilter || filter.absoluteDateFilter);
  const dataSet = dated[0]?.relativeDateFilter?.dataSet ?? dated[0]?.absoluteDateFilter?.dataSet;
  if (dated.length !== 1 || dataSet?.uri !== dateSet) throw changed('the date filter is not Date (Interaction Start)');
  const attributes = [{ displayForm: { uri: dateLabel }, localIdentifier: 'date' }, { displayForm: { uri: agentLabel }, localIdentifier: 'agent' }, { displayForm: { uri: callLabel }, localIdentifier: 'call' },
    // Saving the State column drops calls whose number has no state, so it stays while the report has it, to count the same calls the report shows.
    ...(columns.includes(stateLabel) ? [{ displayForm: { uri: stateLabel }, localIdentifier: 'state' }] : [])];
  return { execution: {
    afm: { measures: [{ localIdentifier: 'time', alias: 'Interaction Time', definition: { measure: time.definition.measureDefinition } }], attributes, filters: [{ absoluteDateFilter: { dataSet, from, to } }, ...filters.filter(filter => !dated.includes(filter) && filter.negativeAttributeFilter?.notIn?.length !== 0)] },
    resultSpec: { dimensions: [{ itemIdentifiers: attributes.map(attribute => attribute.localIdentifier) }, { itemIdentifiers: ['measureGroup'] }] },
  } };
}

/** One result page as { date, name, call, seconds } rows. */
export function leadReportRows(result) {
  const [dates, agents, calls] = result?.headerItems?.[0] ?? [];
  if (!Array.isArray(dates) || !Array.isArray(agents) || !Array.isArray(calls) || dates.length !== agents.length || dates.length !== calls.length || !Array.isArray(result.data)) throw invalid('unexpected result shape');
  return dates.map((date, index) => {
    const day = date.attributeHeaderItem?.name, call = calls[index].attributeHeaderItem?.name, value = result.data[index]?.[0];
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid('a date is not YYYY-MM-DD');
    if (typeof call !== 'string' || !call) throw invalid('a call has no ID');
    const seconds = value === null || value === undefined ? null : Number(value);
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) throw invalid('a call time is not a number');
    return { date: day, name: String(agents[index].attributeHeaderItem?.name ?? ''), call, seconds };
  });
}

/** One row per agent per day. RingCX's "N/A" stays, because most of these calls have no agent; a blank name counts with it. */
export function leadDataDays(shortRows, instantRows) {
  const days = new Map();
  const count = (rows, field, counted) => {
    const seen = new Set();
    for (const { date, name, call, seconds } of rows) {
      if (seen.has(call) || !counted(seconds)) continue;
      seen.add(call);
      const spelled = name.trim().replace(/\s+/g, ' ') || 'N/A', key = svpReportAgentKey(spelled);
      if (key.length > 200) continue;
      const day = days.get(`${date}|${key}`) ?? { date, key, name: spelled, instantDisconnects: 0, shortDuration: 0 };
      day[field] += 1;
      days.set(`${date}|${key}`, day);
    }
  };
  count(shortRows, 'shortDuration', () => true);
  count(instantRows, 'instantDisconnects', seconds => seconds !== null && seconds <= INSTANT_DISCONNECT_SECONDS);
  return [...days.values()];
}

/** Signs in and loads both saved reports. */
export async function openLeadDataReports(client, options) {
  const { read, identifiers, readAll, dataLoadedAt } = await openRingcxAnalytics(client, options);
  const uris = await identifiers([SHORT_REPORT, INSTANT_REPORT, DATE_SET, DATE_LABEL, AGENT_LABEL, CALL_LABEL, STATE_LABEL, TIME_METRIC, LAST_LOAD_METRIC]);
  for (const identifier of [SHORT_REPORT, INSTANT_REPORT, DATE_SET, DATE_LABEL, AGENT_LABEL, CALL_LABEL, TIME_METRIC]) if (!uris.has(identifier)) throw changed(`${identifier} was not found`);
  const load = async identifier => {
    const saved = (await read('report', uris.get(identifier))).data?.visualizationObject;
    if (!saved?.content) throw invalid('report: no saved definition');
    return saved;
  };
  const short = await load(SHORT_REPORT), instant = await load(INSTANT_REPORT);
  const labels = { dateSet: uris.get(DATE_SET), dateLabel: uris.get(DATE_LABEL), agentLabel: uris.get(AGENT_LABEL), callLabel: uris.get(CALL_LABEL), stateLabel: uris.get(STATE_LABEL), timeMetric: uris.get(TIME_METRIC) };
  return {
    /** Changes whenever either report is saved, so edited filters rebuild the history. */
    version: `${short.meta?.updated ?? ''}|${instant.meta?.updated ?? ''}`,
    readShort: (from, to) => readAll(leadReportExecution(short.content, labels, from, to), leadReportRows),
    readInstant: (from, to) => readAll(leadReportExecution(instant.content, labels, from, to), leadReportRows),
    dataLoadedAt: () => dataLoadedAt(uris.get(LAST_LOAD_METRIC)),
  };
}

/**
 * One sync run. The claim stops a duplicated or overlapping run from reading twice.
 * A failed or empty read keeps earlier counts and is recorded, so the page can say how old its numbers are.
 */
export async function syncLeadData(db, open, now = Date.now()) {
  const at = new Date(now).toISOString();
  const { rows: claimed } = await db.query(`INSERT INTO lead_data_sync (id, attempted_at) VALUES (true, $1::timestamptz)
    ON CONFLICT (id) DO UPDATE SET attempted_at = EXCLUDED.attempted_at WHERE lead_data_sync.attempted_at <= $2::timestamptz RETURNING report_version`, [at, new Date(now - RUN_GAP_MS).toISOString()]);
  if (!claimed.length) return { status: 'skipped' };
  try {
    const reports = await open(), to = leaderboardPeriod('day', now).startDate;
    const rebuild = claimed[0].report_version !== reports.version, from = rebuild ? SVP_REPORT_FIRST_DATE : addDays(to, -RECHECK_DAYS);
    const days = leadDataDays(await reports.readShort(from, to), await reports.readInstant(from, to));
    const total = field => days.reduce((sum, day) => sum + day[field], 0), shortDuration = total('shortDuration');
    // A week without one short call means a report or its filters broke, and zeros must not replace the page's numbers.
    if (!shortDuration) throw new RingCxError('EMPTY_REPORT', 503, `${from} to ${to}`);
    const loadedAt = await reports.dataLoadedAt();
    await db.query(`WITH incoming AS (SELECT * FROM unnest($3::date[], $4::text[], $5::text[], $6::int[], $7::int[]) AS t(call_date, agent_key, agent_name, instant_disconnects, short_duration)),
      removed AS (DELETE FROM lead_data_ringcx_daily saved WHERE saved.call_date BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.call_date = saved.call_date AND incoming.agent_key = saved.agent_key))
      INSERT INTO lead_data_ringcx_daily (call_date, agent_key, agent_name, instant_disconnects, short_duration) SELECT * FROM incoming
      ON CONFLICT (call_date, agent_key) DO UPDATE SET agent_name = EXCLUDED.agent_name, instant_disconnects = EXCLUDED.instant_disconnects, short_duration = EXCLUDED.short_duration`,
    [from, to, ...['date', 'key', 'name', 'instantDisconnects', 'shortDuration'].map(field => days.map(day => day[field]))]);
    const run = { from, to, rebuild, rows: days.length, instantDisconnects: total('instantDisconnects'), shortDuration };
    await db.query(`UPDATE lead_data_sync SET succeeded_at = $1::timestamptz, error_code = NULL, error_detail = NULL, last_run = $2::jsonb, report_version = $3, report_through = $4::date,
      report_from = (SELECT min(call_date) FROM lead_data_ringcx_daily), data_loaded_at = coalesce($5, data_loaded_at) WHERE id`, [at, JSON.stringify(run), reports.version, to, loadedAt]);
    return { status: 'ok', ...run };
  } catch (error) {
    const code = error instanceof RingCxError ? error.code : 'SYNC_FAILED', detail = error instanceof RingCxError ? error.detail || null : null;
    await db.query('UPDATE lead_data_sync SET error_code = $1, error_detail = $2 WHERE id', [code, detail]);
    return { status: 'failed', code, detail };
  }
}

/** Whether any sync has succeeded yet. */
export async function leadDataLoaded(db) {
  const { rows } = await db.query('SELECT 1 FROM lead_data_sync WHERE succeeded_at IS NOT NULL');
  return rows.length > 0;
}

/** The same request as the leaderboard's, without a board. */
export function validateLeadDataInput(input) {
  const { period, from, to } = validateLeaderboardInput({ ...input, board: 'sp' });
  return { board: 'lead-data', period, ...(period === 'custom' ? { from, to } : {}) };
}

/** @param {{period:string,from?:string,to?:string}} input @param {{db:any,now?:number}} options */
export async function readLeadData({ period, from, to }, { db, now = Date.now() }) {
  const { startDate, endDate } = period === 'custom' ? leaderboardCustomPeriod(from, to) : leaderboardPeriod(period, now);
  const base = { board: 'lead-data', period, startDate, endDate, policytek: POLICYTEK_NOT_CONNECTED };
  const { rows: [sync] } = await db.query(`SELECT succeeded_at, error_code, data_loaded_at, to_char(report_from, 'YYYY-MM-DD') AS report_from FROM lead_data_sync`);
  if (!sync?.succeeded_at) return { ...base, ringcentral: { status: 'unavailable', message: "RingCX's Instant Hangups and Short Duration Calls reports have not been read yet. Try Refresh in a few minutes." } };
  const { rows } = await db.query(`SELECT agent_key, min(agent_name) AS name, sum(instant_disconnects)::int AS instant, sum(short_duration)::int AS short FROM lead_data_ringcx_daily
    WHERE call_date BETWEEN $1::date AND $2::date GROUP BY agent_key`, [startDate, endDate]);
  const counts = row => ({ instantDisconnects: row?.instant ?? 0, shortDuration: row?.short ?? 0 });
  const today = leaderboardPeriod('day', now).startDate, includesToday = endDate >= today, readAt = new Date(sync.succeeded_at).toISOString(), loaded = includesToday ? reportLoadedLabel(sync.data_loaded_at, today) : null;
  const notes = [`Instant Disconnects are inbound calls with an Interaction Time of ${INSTANT_DISCONNECT_SECONDS} seconds or less, from the RingCX report "${INSTANT_TITLE}". Short Duration Calls are inbound calls with a handle time of 0–9 seconds, from the RingCX report "${SHORT_TITLE}". Both are checked every five minutes, ${POLICYTEK_REFRESH_HOURS}.`];
  if (startDate < sync.report_from) notes.push(`The reports start ${sync.report_from}.`);
  if (loaded) notes.push(`RingCX last refreshed this data at ${loaded} Eastern.`);
  const stale = includesToday && policytekSnapshotStale(readAt, now);
  if (stale) notes.push("The reports have not been read recently, so today's numbers may be behind.");
  return { ...base, ringcentral: {
    status: 'available', source: 'RingCX reports', fetchedAt: readAt, stale, errorCode: sync.error_code, notice: notes.join(' '),
    rows: rows.filter(row => row.agent_key !== NO_AGENT).map(row => ({ name: row.name, ...counts(row) })),
    noAgent: counts(rows.find(row => row.agent_key === NO_AGENT)),
    totals: { instantDisconnects: rows.reduce((sum, row) => sum + row.instant, 0), shortDuration: rows.reduce((sum, row) => sum + row.short, 0) },
  } };
}
