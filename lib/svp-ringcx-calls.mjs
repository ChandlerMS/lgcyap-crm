// Standard vs. Preferred answered calls per agent, read from RingCX's agent queue report every five minutes.
// Only counts keyed by agent name are stored. This report has no caller, call or recording fields.
import { LEADERBOARD_TIME_ZONE } from './leaderboard-period.mjs';
import { RingCxError } from './ringcx.mjs';
import { svpAgentKey } from './svp-calls.mjs';

/** Read only to reconcile against that day's workbook; the board starts at SVP_RINGCX_BOARD_DATE. */
export const SVP_RINGCX_FIRST_DATE = '2026-11-02';
// Two-hour windows, not RingCX's three-hour maximum, so the repeated 1 AM hour when daylight saving ends still fits.
const WINDOW_MINUTES = 120, DAY_MINUTES = 1440, WINDOWS_PER_DAY = DAY_MINUTES / WINDOW_MINUTES;
// RingCX refuses report windows newer than five minutes and allows 9 report requests per 15 minutes.
const REPORT_DELAY_MS = 300000, READS_PER_RUN = 2, RUN_GAP_MS = 180000;
// Calls can reach a finished window late, so it is rechecked until an hour after it ends.
const SETTLE_MINUTES = 60, RECHECK_MS = 900000, LOOKBACK_DAYS = 14;

const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: LEADERBOARD_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function easternClock(ms) {
  const parts = Object.fromEntries(clockFormat.formatToParts(ms).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const dayNumber = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
const addDays = (date, days) => new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);
const wall = (date, minutes) => dayNumber(date) * DAY_MINUTES + minutes;
const pad = value => String(value).padStart(2, '0');
const stamp = (date, minutes) => minutes === DAY_MINUTES ? `${addDays(date, 1)} 00:00:00` : `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
function readableClock(now) {
  const { date, minutes } = easternClock(now - REPORT_DELAY_MS);
  return { date, minutes: minutes - minutes % 5 };
}
function firstDate(readable) {
  const back = addDays(readable.date, -LOOKBACK_DAYS);
  return back > SVP_RINGCX_FIRST_DATE ? back : SVP_RINGCX_FIRST_DATE;
}

/** This run's reads: the newest window with unread data, then the oldest such window, then the longest-unchecked finished window. */
export function svpWindowsDue(windows, now) {
  const readable = readableClock(now), unread = [], recheck = [];
  for (let date = firstDate(readable); date <= readable.date; date = addDays(date, 1)) {
    for (let slot = 0; slot < WINDOWS_PER_DAY; slot++) {
      const start = slot * WINDOW_MINUTES, end = Math.min(start + WINDOW_MINUTES, date === readable.date ? readable.minutes : DAY_MINUTES);
      if (end <= start) break;
      const read = windows.get(`${date}|${slot}`);
      if (read?.settled) continue;
      if (!read || read.readThrough < end) unread.push({ date, slot, start, end });
      else if (now - read.readAt >= RECHECK_MS) recheck.push({ date, slot, start, end, readAt: read.readAt });
    }
  }
  recheck.sort((a, b) => a.readAt - b.readAt);
  const newest = unread.pop();
  return [newest, ...unread, ...recheck].filter(Boolean).slice(0, READS_PER_RUN).map(({ date, slot, start, end }) => ({ date, slot, start, end }));
}

const invalidReport = detail => new RingCxError('INVALID_AGENT_REPORT', 503, detail);
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
/** RingCX does not document this field's format, so an unknown one stops the sync with its digits masked. */
function intervalWall(value) {
  const zoned = ms => { const { date, minutes } = easternClock(ms); return wall(date, minutes); };
  if (typeof value === 'number' && Number.isFinite(value)) return zoned(value);
  if (typeof value === 'string' && /^\d{12,13}$/.test(value)) return zoned(Number(value));
  const match = typeof value === 'string' ? LOCAL_TIME.exec(value.trim()) : null;
  if (!match) throw invalidReport(`dateTimeFrom ${typeof value === 'string' ? value.replace(/\d/g, '9').slice(0, 40) : typeof value}`);
  if (!match[4]) return wall(match[1], Number(match[2]) * 60 + Number(match[3]));
  const ms = Date.parse(value.trim().replace(' ', 'T').replace(/\s+/g, ''));
  if (!Number.isFinite(ms)) throw invalidReport('dateTimeFrom unreadable offset');
  return zoned(ms);
}

/** Answered calls per agent in one window. Rows outside the window's blocks are dropped in case RingCX treats the end time as inclusive. */
export function svpWindowCounts(rows, queueIds, window) {
  if (!Array.isArray(rows)) throw invalidReport(`expected a list, got ${rows === null ? 'null' : typeof rows}${rows && typeof rows === 'object' ? ` with ${Object.keys(rows).slice(0, 8).join(',')}` : ''}`);
  const from = wall(window.date, window.start), to = wall(window.date, window.end), counts = new Map();
  let inScope = 0;
  for (const row of rows) {
    if (!queueIds.has(String(row?.queue ?? ''))) continue;
    if (!Number.isSafeInteger(row.answIxnCnt) || row.answIxnCnt < 0) throw invalidReport('answIxnCnt is not a whole number');
    const at = intervalWall(row.dateTimeFrom);
    if (at < from || at >= to) continue;
    inScope++;
    const key = svpAgentKey(row.agentName);
    // The workbooks skip calls with no agent too.
    if (!key || key.length > 200 || !row.answIxnCnt) continue;
    counts.set(key, (counts.get(key) ?? 0) + row.answIxnCnt);
  }
  return { counts: Object.fromEntries(counts), rows: rows.length, inScope, calls: [...counts.values()].reduce((sum, value) => sum + value, 0), firstInterval: String(rows[0]?.dateTimeFrom ?? '') };
}

async function readWindows(db, since) {
  const { rows } = await db.query(`SELECT to_char(call_date, 'YYYY-MM-DD') AS date, slot, read_through, settled, read_at,
    (SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(counts))::int AS calls FROM svp_ringcx_windows WHERE call_date >= $1::date`, [since]);
  return new Map(rows.map(row => [`${row.date}|${row.slot}`, { readThrough: row.read_through, settled: row.settled, readAt: new Date(row.read_at).getTime(), calls: row.calls }]));
}

/**
 * One cron run. The claim stops a duplicated or overlapping run from spending RingCX's report allowance twice.
 * A failed read keeps earlier counts and is recorded, so the board can say how old its numbers are.
 */
export async function syncSvpRingcxCalls(db, client, now = Date.now()) {
  const at = new Date(now).toISOString();
  const { rows: claimed } = await db.query(`INSERT INTO svp_ringcx_sync (id, attempted_at) VALUES (true, $1::timestamptz)
    ON CONFLICT (id) DO UPDATE SET attempted_at = EXCLUDED.attempted_at WHERE svp_ringcx_sync.attempted_at <= $2::timestamptz RETURNING id`, [at, new Date(now - RUN_GAP_MS).toISOString()]);
  if (!claimed.length) return { status: 'skipped' };
  const readable = readableClock(now), since = firstDate(readable), reads = [];
  let answeredToday = null;
  try {
    const windows = await readWindows(db, since), due = svpWindowsDue(windows, now);
    const queues = due.length ? await client.svpQueues() : null;
    answeredToday = queues?.answeredToday ?? null;
    const clock = easternClock(now);
    for (const window of due) {
      const report = svpWindowCounts(await client.agentQueueReport({ startDate: stamp(window.date, window.start), endDate: stamp(window.date, window.end) }), queues.ids, window);
      if (!report.inScope && windows.get(`${window.date}|${window.slot}`)?.calls > 0) throw new RingCxError('EMPTY_AGENT_REPORT', 503, `${window.date} slot ${window.slot}`);
      const fullEnd = window.start + WINDOW_MINUTES, settled = window.end === fullEnd && wall(clock.date, clock.minutes) >= wall(window.date, fullEnd) + SETTLE_MINUTES;
      await db.query(`INSERT INTO svp_ringcx_windows (call_date, slot, counts, read_through, settled, read_at) VALUES ($1::date, $2, $3::jsonb, $4, $5, $6::timestamptz)
        ON CONFLICT (call_date, slot) DO UPDATE SET counts = EXCLUDED.counts, read_through = EXCLUDED.read_through, settled = EXCLUDED.settled, read_at = EXCLUDED.read_at`,
      [window.date, window.slot, JSON.stringify(report.counts), window.end, settled, at]);
      windows.set(`${window.date}|${window.slot}`, { readThrough: window.end, settled, readAt: now, calls: report.calls });
      reads.push({ date: window.date, slot: window.slot, through: window.end, rows: report.rows, inScope: report.inScope, calls: report.calls, firstInterval: report.firstInterval });
    }
    await markReadyDays(db, windows, readable, since, at);
    const reportToday = Array.from({ length: WINDOWS_PER_DAY }, (_, slot) => windows.get(`${clock.date}|${slot}`)?.calls ?? 0).reduce((sum, value) => sum + value, 0);
    await db.query('UPDATE svp_ringcx_sync SET succeeded_at = $1::timestamptz, error_code = NULL, error_detail = NULL, last_run = $2::jsonb WHERE id', [at, JSON.stringify({ reads, answeredToday, reportToday })]);
    return { status: 'ok', reads };
  } catch (error) {
    const code = error instanceof RingCxError ? error.code : 'SYNC_FAILED', detail = error instanceof RingCxError ? error.detail || null : null;
    await db.query('UPDATE svp_ringcx_sync SET error_code = $1, error_detail = $2, last_run = $3::jsonb WHERE id', [code, detail, JSON.stringify({ reads, answeredToday })]);
    return { status: 'failed', code, detail, reads };
  }
}

/**
 * A day joins the board once every started window has been read. The first day must also have calls: if the report's
 * queue ids or times ever fail to match, its rows are all dropped, and zeros must not replace the board's numbers.
 */
async function markReadyDays(db, windows, readable, since, at) {
  const { rows } = await db.query("SELECT to_char(call_date, 'YYYY-MM-DD') AS date FROM svp_ringcx_days WHERE call_date >= $1::date", [addDays(since, -1)]);
  const ready = new Set(rows.map(row => row.date)), added = [];
  for (let date = since; date <= readable.date; date = addDays(date, 1)) {
    if (ready.has(date)) continue;
    const started = date === readable.date ? Math.ceil(readable.minutes / WINDOW_MINUTES) : WINDOWS_PER_DAY;
    const read = Array.from({ length: started }, (_, slot) => windows.get(`${date}|${slot}`));
    if (!started || !read.every(Boolean) || !(read.some(window => window.calls > 0) || ready.has(addDays(date, -1)))) continue;
    ready.add(date); added.push(date);
  }
  if (added.length) await db.query('INSERT INTO svp_ringcx_days (call_date, ready_at) SELECT unnest($1::date[]), $2::timestamptz ON CONFLICT (call_date) DO NOTHING', [added, at]);
}

/** Sync health for signed-in editors, plus RingCX against the imported workbook, agent by agent, for each fully read day. */
export async function readSvpRingcxStatus(db) {
  const { rows: [sync] } = await db.query('SELECT attempted_at, succeeded_at, error_code, error_detail, last_run FROM svp_ringcx_sync');
  const { rows: days } = await db.query(`SELECT to_char(w.call_date, 'YYYY-MM-DD') AS date, count(*)::int AS windows, count(*) FILTER (WHERE w.settled)::int AS settled,
    sum((SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(w.counts)))::int AS calls, bool_or(d.call_date IS NOT NULL) AS ready
    FROM svp_ringcx_windows w LEFT JOIN svp_ringcx_days d USING (call_date) GROUP BY w.call_date ORDER BY w.call_date DESC LIMIT 15`);
  const { rows: compared } = await db.query(`WITH complete AS (SELECT call_date FROM svp_ringcx_windows GROUP BY call_date HAVING count(*) FILTER (WHERE settled) = $1),
    live AS (SELECT call_date, key AS agent_key, sum(value::int)::int AS connected FROM svp_ringcx_windows, jsonb_each_text(counts) WHERE call_date IN (SELECT call_date FROM complete) GROUP BY call_date, key),
    imported AS (SELECT call_date, agent_key, connected FROM svp_calls_daily WHERE connected > 0 AND call_date IN (SELECT call_date FROM complete))
    SELECT to_char(call_date, 'YYYY-MM-DD') AS date, agent_key, coalesce(live.connected, 0) AS ringcx, coalesce(imported.connected, 0) AS workbook
    FROM live FULL JOIN imported USING (call_date, agent_key) WHERE call_date IN (SELECT call_date FROM imported) ORDER BY date, agent_key`, [WINDOWS_PER_DAY]);
  const byDate = new Map();
  for (const row of compared) {
    const day = byDate.get(row.date) ?? { date: row.date, ringcx: 0, workbook: 0, agents: 0, matching: 0, differences: [] };
    day.ringcx += row.ringcx; day.workbook += row.workbook; day.agents++;
    if (row.ringcx === row.workbook) day.matching++;
    else day.differences.push({ agent: row.agent_key, ringcx: row.ringcx, workbook: row.workbook });
    byDate.set(row.date, day);
  }
  return {
    attemptedAt: sync?.attempted_at ?? null, succeededAt: sync?.succeeded_at ?? null, errorCode: sync?.error_code ?? null, errorDetail: sync?.error_detail ?? null, lastRun: sync?.last_run ?? null,
    days, reconciliation: [...byDate.values()].map(day => ({ ...day, differences: day.differences.sort((a, b) => Math.abs(b.ringcx - b.workbook) - Math.abs(a.ringcx - a.workbook)).slice(0, 20) })),
  };
}
