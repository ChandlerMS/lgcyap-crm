// Standard vs. Preferred Calls and Sold per agent per day, read every five minutes from the RingCX report
// "Agent Close Rate - Standard vs Preferred SYNC". RingCX's Historical reports run on GoodData and no public API exposes
// saved reports, so this reads it the way RingCX's own page does. Only counts keyed by agent name are stored.
import { leaderboardPeriod } from './leaderboard-period.mjs';
import { RingCxError } from './ringcx.mjs';
import { svpAgentKey } from './svp-calls.mjs';

const PROJECT = 'fxvsv9l0lmfwew3feu8jhuf80qidzfyg', REPORT_ID = 'aaB7aXOESEiB';
const DATE_SET = 'callstartdate.dataset.dt', DATE_LABEL = 'callstartdate.date.day.yyyy_mm_dd', LAST_LOAD_METRIC = 'aaD16BZbLrKz';
/** The report is read from here on; the board's coverage starts at the first day with calls. */
export const SVP_REPORT_FIRST_DATE = '2026-01-01';
// Dispositions can change after a call, so recent days are read again on every run.
const RECHECK_DAYS = 7, RUN_GAP_MS = 180000;
const REQUEST_MS = 15000, RESULT_WAIT_MS = 40000, RESULT_POLL_MS = 500;
// RingCX's spelling of agents whose HubSpot writing-agent name differs.
const AGENT_ALIASES = new Map([['julian parker gillion', 'julian gillion'], ['jose luis garcia', 'luis garcia'], ['walter (noah) korfant', 'walter noah korfant']]);

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const changed = detail => new RingCxError('REPORT_CHANGED', 503, detail);
const invalid = detail => new RingCxError('INVALID_REPORT_RESPONSE', 503, detail);

/** The saved report as one execution grouped by day and agent. Its filters carry over; only its date range is replaced. */
export function svpReportExecution(content, { dateSet, dateLabel }, from, to) {
  const items = id => content?.buckets?.find(bucket => bucket.localIdentifier === id)?.items ?? [];
  const measures = ['Sold', 'Calls'].map(alias => {
    const measure = items('measures').map(item => item.measure).find(item => item?.alias === alias);
    if (!measure?.definition?.measureDefinition) throw changed(`no "${alias}" measure`);
    return { localIdentifier: measure.localIdentifier, alias, definition: { measure: measure.definition.measureDefinition } };
  });
  const agents = items('attribute').map(item => item.visualizationAttribute);
  if (agents.length !== 1 || !agents[0]?.displayForm) throw changed(`expected one row attribute, found ${agents.length}`);
  const filters = content.filters ?? [], dated = filters.filter(filter => filter.relativeDateFilter || filter.absoluteDateFilter);
  const dataSet = dated[0]?.relativeDateFilter?.dataSet ?? dated[0]?.absoluteDateFilter?.dataSet;
  if (dated.length !== 1 || dataSet?.uri !== dateSet) throw changed('the date filter is not Date (Started)');
  const afm = {
    measures,
    attributes: [{ displayForm: { uri: dateLabel }, localIdentifier: 'date' }, { displayForm: agents[0].displayForm, localIdentifier: 'agent' }],
    filters: [{ absoluteDateFilter: { dataSet, from, to } }, ...filters.filter(filter => !dated.includes(filter) && filter.negativeAttributeFilter?.notIn?.length !== 0)],
  };
  return { execution: { afm, resultSpec: { dimensions: [{ itemIdentifiers: ['date', 'agent'] }, { itemIdentifiers: ['measureGroup'] }] } } };
}

/** A blank measure means none, which is how the report shows an agent with no Sold calls. */
function wholeNumber(value) {
  const number = value === null || value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid('a count is not a whole number');
  return number;
}

/** One result page as { date, name, calls, sold } rows. */
export function svpReportRows(result) {
  const [dates, agents] = result?.headerItems?.[0] ?? [];
  const names = result?.headerItems?.[1]?.[0]?.map(item => item.measureHeaderItem?.name) ?? [];
  const callsAt = names.indexOf('Calls'), soldAt = names.indexOf('Sold');
  if (!Array.isArray(dates) || !Array.isArray(agents) || dates.length !== agents.length || !Array.isArray(result.data) || callsAt < 0 || soldAt < 0) throw invalid('unexpected result shape');
  return dates.map((date, index) => {
    const day = date.attributeHeaderItem?.name;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid('a date is not YYYY-MM-DD');
    return { date: day, name: String(agents[index].attributeHeaderItem?.name ?? ''), calls: wholeNumber(result.data[index]?.[callsAt]), sold: wholeNumber(result.data[index]?.[soldAt]) };
  });
}

/** One row per agent per day under HubSpot's spelling of the name. Calls with no agent are skipped, as in the workbooks. */
export function svpReportDays(rows) {
  const days = new Map();
  for (const { date, name, calls, sold } of rows) {
    const spelled = svpAgentKey(name), key = AGENT_ALIASES.get(spelled) ?? spelled;
    if (!key || key.length > 200 || !(calls || sold)) continue;
    const day = days.get(`${date}|${key}`) ?? { date, key, name: name.trim().replace(/\s+/g, ' '), calls: 0, sold: 0 };
    day.calls += calls; day.sold += sold;
    days.set(`${date}|${key}`, day);
  }
  return [...days.values()];
}

/** The report's Last Load Time, Eastern wall time as MMDDYYYYHHMMSS, as 'YYYY-MM-DD HH:MM:SS'. It is a number, so January to September can lose the leading zero. */
export function svpReportLoadedAt(value) {
  if (!/^\d{13,14}$/.test(String(value ?? ''))) return null;
  const [, month, day, year, hour, minute, second] = /^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(value).padStart(14, '0'));
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function reportOrigin(domain) {
  let url;
  try { url = new URL(/^https?:\/\//.test(domain) ? domain : `https://${domain}`); } catch { throw new RingCxError('INVALID_ANALYTICS_SESSION', 503, 'unreadable analytics host'); }
  // The login below sends RingCX's claims to this host, so it must be RingCentral's.
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ringcentral.com')) throw new RingCxError('INVALID_ANALYTICS_SESSION', 503, 'unexpected analytics host');
  return url.origin;
}

const sessionCookie = (response, name) => (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0].trim()).filter(value => value.startsWith(`${name}=`) && value.length > name.length + 1).at(-1) ?? null;

/** Rejections say why, for the sync's status only. Only GoodData's own error message is kept, never a raw body, which could repeat the login. */
async function rejected(step, response) {
  let message = '';
  try { message = (await response.json())?.error?.message ?? ''; } catch { /* not JSON */ }
  const code = [401, 403].includes(response.status) ? 'RINGCX_ACCESS_DENIED' : response.status === 429 ? 'RINGCX_RATE_LIMITED' : 'REPORT_UNAVAILABLE';
  return new RingCxError(code, 503, `${step}: HTTP ${response.status} ${String(message).slice(0, 300)}`.trim());
}

/** Signs in and loads the saved report. The session lasts this one run and is never stored or logged. */
export async function openSvpReport(client, { fetch: request = globalThis.fetch, pollMs = RESULT_POLL_MS } = {}) {
  const session = await client.analyticsSession(), origin = reportOrigin(session.domain);
  const send = (step, path, { cookie, body } = {}) => request(new URL(path, origin), {
    method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(REQUEST_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'lgcyap-crm', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(error => { throw new RingCxError('REPORT_UNAVAILABLE', 503, `${step}: ${error?.name ?? 'request failed'}`); });

  // RingCX's page asks for this same landing address when it signs in.
  const login = await send('login', '/gdc/account/customerlogin', { body: { pgpLoginRequest: { targetUrl: `/gdc/app/account/bootstrap?projectUri=/gdc/projects/client:default:${session.clientId}`, ssoProvider: session.provider, encryptedClaims: session.claims } } });
  if (login.status >= 400) throw await rejected('login', login);
  await login.body?.cancel();
  const longToken = sessionCookie(login, 'GDCAuthSST');
  if (!longToken) throw new RingCxError('REPORT_LOGIN_FAILED', 503, `login: HTTP ${login.status} set no session`);
  const renewed = await send('token', '/gdc/account/token', { cookie: longToken });
  if (renewed.status >= 400) throw await rejected('token', renewed);
  await renewed.body?.cancel();
  const token = sessionCookie(renewed, 'GDCAuthTT');
  if (!token) throw new RingCxError('REPORT_LOGIN_FAILED', 503, `token: HTTP ${renewed.status} set no token`);

  const read = async (step, path, body) => {
    const response = await send(step, path, { cookie: token, body });
    if (response.status >= 300) throw await rejected(step, response);
    if (response.status === 202 || response.status === 204) { await response.body?.cancel(); return { status: response.status }; }
    try { return { status: response.status, data: await response.json() }; } catch { throw invalid(`${step}: not JSON`); }
  };
  const start = async execution => {
    const link = (await read('execute', `/gdc/app/projects/${PROJECT}/executeAfm`, execution)).data?.executionResponse?.links?.executionResult;
    if (typeof link !== 'string') throw invalid('execute: no result link');
    return link;
  };
  // The link already carries limit and offset, so a later page replaces them; adding a second pair is refused.
  const page = async (link, offset = 0) => {
    const url = new URL(link, origin);
    if (offset) url.searchParams.set('offset', `${offset},0`);
    for (const deadline = Date.now() + RESULT_WAIT_MS; ;) {
      const { status, data } = await read('result', url.pathname + url.search);
      if (status === 204) return null;
      if (status !== 202) { if (!data?.executionResult) throw invalid('result: no execution result'); return data.executionResult; }
      if (Date.now() > deadline) throw new RingCxError('REPORT_UNAVAILABLE', 503, 'result: still computing');
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  };

  const { data: found } = await read('identifiers', `/gdc/md/${PROJECT}/identifiers`, { identifierToUri: [REPORT_ID, DATE_SET, DATE_LABEL, LAST_LOAD_METRIC] });
  const uris = new Map((found?.identifiers ?? []).map(item => [item.identifier, item.uri]));
  if (!uris.has(REPORT_ID) || !uris.has(DATE_SET) || !uris.has(DATE_LABEL)) throw changed('the report or its date was not found');
  const saved = (await read('report', uris.get(REPORT_ID))).data?.visualizationObject;
  if (!saved?.content) throw invalid('report: no saved definition');

  return {
    /** Changes whenever the saved report is saved, so edited filters rebuild the history. */
    version: String(saved.meta?.updated ?? ''),
    async read(from, to) {
      const link = await start(svpReportExecution(saved.content, { dateSet: uris.get(DATE_SET), dateLabel: uris.get(DATE_LABEL) }, from, to));
      const rows = [];
      // A short read would delete the rows it missed, so a missing page fails the run instead.
      for (let offset = 0; ;) {
        const result = await page(link, offset);
        if (!result) { if (offset) throw invalid('result: a later page came back empty'); return rows; }
        rows.push(...svpReportRows(result));
        const count = result.paging?.count?.[0] ?? 0, total = result.paging?.total?.[0] ?? 0;
        offset += count;
        if (offset >= total) return rows;
        if (!count) throw invalid('result: a later page came back empty');
      }
    },
    /** Informational, so a failure here never fails the run. */
    async dataLoadedAt() {
      try {
        if (!uris.has(LAST_LOAD_METRIC)) return null;
        const result = await page(await start({ execution: { afm: { measures: [{ localIdentifier: 'loaded', definition: { measure: { item: { uri: uris.get(LAST_LOAD_METRIC) } } } }] }, resultSpec: { dimensions: [{ itemIdentifiers: ['measureGroup'] }] } } }));
        return svpReportLoadedAt(result?.data?.[0]);
      } catch { return null; }
    },
  };
}

/**
 * One cron run. The claim stops a duplicated or overlapping run from reading twice.
 * A failed or empty read keeps earlier counts and is recorded, so the board can say how old its numbers are.
 */
export async function syncSvpRingcxCalls(db, open, now = Date.now()) {
  const at = new Date(now).toISOString();
  const { rows: claimed } = await db.query(`INSERT INTO svp_ringcx_sync (id, attempted_at) VALUES (true, $1::timestamptz)
    ON CONFLICT (id) DO UPDATE SET attempted_at = EXCLUDED.attempted_at WHERE svp_ringcx_sync.attempted_at <= $2::timestamptz RETURNING report_version`, [at, new Date(now - RUN_GAP_MS).toISOString()]);
  if (!claimed.length) return { status: 'skipped' };
  try {
    const report = await open(), to = leaderboardPeriod('day', now).startDate;
    const rebuild = claimed[0].report_version !== report.version, from = rebuild ? SVP_REPORT_FIRST_DATE : addDays(to, -RECHECK_DAYS);
    const days = svpReportDays(await report.read(from, to));
    const calls = days.reduce((sum, day) => sum + day.calls, 0), sold = days.reduce((sum, day) => sum + day.sold, 0);
    // A week without one call means the report or its filters broke, and zeros must not replace the board's numbers.
    if (!calls) throw new RingCxError('EMPTY_REPORT', 503, `${from} to ${to}`);
    const loadedAt = await report.dataLoadedAt();
    await db.query(`WITH incoming AS (SELECT * FROM unnest($3::date[], $4::text[], $5::text[], $6::int[], $7::int[]) AS t(call_date, agent_key, agent_name, calls, sold)),
      removed AS (DELETE FROM svp_ringcx_report_daily saved WHERE saved.call_date BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.call_date = saved.call_date AND incoming.agent_key = saved.agent_key))
      INSERT INTO svp_ringcx_report_daily (call_date, agent_key, agent_name, calls, sold) SELECT * FROM incoming
      ON CONFLICT (call_date, agent_key) DO UPDATE SET agent_name = EXCLUDED.agent_name, calls = EXCLUDED.calls, sold = EXCLUDED.sold`,
    [from, to, days.map(day => day.date), days.map(day => day.key), days.map(day => day.name), days.map(day => day.calls), days.map(day => day.sold)]);
    const run = { from, to, rebuild, rows: days.length, calls, sold };
    await db.query(`UPDATE svp_ringcx_sync SET succeeded_at = $1::timestamptz, error_code = NULL, error_detail = NULL, last_run = $2::jsonb, report_version = $3, report_through = $4::date,
      report_from = (SELECT min(call_date) FROM svp_ringcx_report_daily), data_loaded_at = coalesce($5, data_loaded_at) WHERE id`, [at, JSON.stringify(run), report.version, to, loadedAt]);
    return { status: 'ok', ...run };
  } catch (error) {
    const code = error instanceof RingCxError ? error.code : 'SYNC_FAILED', detail = error instanceof RingCxError ? error.detail || null : null;
    await db.query('UPDATE svp_ringcx_sync SET error_code = $1, error_detail = $2 WHERE id', [code, detail]);
    return { status: 'failed', code, detail };
  }
}

/** Sync health for signed-in editors, plus the latest days beside the imported workbook's Calls. */
export async function readSvpRingcxStatus(db) {
  const { rows: [sync] } = await db.query(`SELECT attempted_at, succeeded_at, error_code, error_detail, last_run, data_loaded_at,
    to_char(report_from, 'YYYY-MM-DD') AS report_from, to_char(report_through, 'YYYY-MM-DD') AS report_through FROM svp_ringcx_sync`);
  const { rows: days } = await db.query(`SELECT to_char(report.call_date, 'YYYY-MM-DD') AS date, report.agents, report.calls, report.sold, workbook.calls AS workbook_calls
    FROM (SELECT call_date, count(*)::int AS agents, sum(calls)::int AS calls, sum(sold)::int AS sold FROM svp_ringcx_report_daily GROUP BY call_date ORDER BY call_date DESC LIMIT 15) report
    LEFT JOIN (SELECT call_date, sum(connected)::int AS calls FROM svp_calls_daily GROUP BY call_date) workbook USING (call_date) ORDER BY date DESC`);
  return {
    attemptedAt: sync?.attempted_at ?? null, succeededAt: sync?.succeeded_at ?? null, errorCode: sync?.error_code ?? null, errorDetail: sync?.error_detail ?? null, lastRun: sync?.last_run ?? null,
    reportFrom: sync?.report_from ?? null, reportThrough: sync?.report_through ?? null, dataLoadedAt: sync?.data_loaded_at ?? null, days,
  };
}
