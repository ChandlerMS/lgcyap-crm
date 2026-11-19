import { LEADERBOARD_BOARDS, leaderboardMetrics, leaderboardTotals, rankLeaderboardRows } from '../leaderboard-data.mjs';

// The office TV view of the Leaderboard. It rotates through boards (and optionally periods),
// ranks by premium like the CRM page, and reuses its ranking and totals helpers so both agree.
export const TV_BOARDS = Object.freeze(['sp', 'shopper', 'source', 'whatsapp']);
export const TV_PERIODS = Object.freeze({ day: 'Today', week: 'This week', month: 'This month' });
export const TV_DEFAULTS = Object.freeze({ boards: ['sp', 'shopper', 'whatsapp'], periods: ['day'], seconds: 20, rows: 10 });
export const TV_REFRESH_MS = 5 * 60_000;
const SUBTITLES = Object.freeze({
  sp: 'HubSpot Sold deals by close date',
  shopper: 'PolicyTek Agent Report by submit date',
  source: 'PolicyTek Source Performance',
  whatsapp: 'Daily agent reports by sale date',
});

const integer = (value, fallback, min, max) => { const number = Number.parseInt(String(value ?? ''), 10); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; };
function choices(params, keys, allowed, fallback) {
  const raw = keys.map(key => params.get(key)).find(value => value != null) ?? '';
  const values = raw.split(',').map(value => value.trim().toLowerCase()).filter(value => allowed.includes(value));
  return values.length ? [...new Set(values)] : [...fallback];
}

/**
 * TV settings from the link, e.g. leaderboard.lgcyap.com/?boards=sp,shopper&periods=day,month&seconds=30&rows=10.
 * Anything missing or unrecognized falls back to the defaults.
 */
export function tvConfig(search = '') {
  const params = new URLSearchParams(search);
  const boards = choices(params, ['boards', 'board'], TV_BOARDS, TV_DEFAULTS.boards);
  const periods = choices(params, ['periods', 'period'], Object.keys(TV_PERIODS), TV_DEFAULTS.periods);
  return {
    boards, periods,
    seconds: integer(params.get('seconds'), TV_DEFAULTS.seconds, 8, 300),
    rows: integer(params.get('rows'), TV_DEFAULTS.rows, 5, 15),
    slides: boards.flatMap(board => periods.map(period => ({ key: `${board}:${period}`, board, period }))),
  };
}

export function tvBoardLabel(board) { return LEADERBOARD_BOARDS.find(item => item.id === board)?.label ?? 'Leaderboard'; }
export function tvSubtitle(board) { return SUBTITLES[board] ?? ''; }

/** Totals and the top rows for one slide, the same figures the CRM Leaderboard shows when ranked by premium. */
export function tvSlide(result, board, rowLimit = TV_DEFAULTS.rows) {
  if (!result || result.status !== 'available' || !Array.isArray(result.rows)) {
    return { available: false, message: result?.error?.message ?? result?.notice ?? (board === 'whatsapp' ? 'WhatsApp sales have not been imported yet.' : 'This leaderboard is not available right now.') };
  }
  const keys = leaderboardMetrics(board);
  const ranked = rankLeaderboardRows(result.rows, board, 'ap').filter(row => row.attributed !== false);
  const calculated = leaderboardTotals(result.rows, board, 'ap');
  const report = result.reportTotals;
  const totals = report ? { ...calculated, first: report.submitted, second: report.premium, leads: report.leads } : calculated;
  const share = (part, whole) => typeof part === 'number' && typeof whole === 'number' && whole > 0 ? part / whole : null;
  const calls = result.calls ?? {};
  const stats = board === 'whatsapp' ? [
    { label: 'Sales', value: totals.first, kind: 'count' }, { label: 'Total production', value: totals.second, kind: 'money' },
    { label: 'Close rate', value: calls.closeRate ?? null, kind: 'percent' }, { label: 'Calls', value: calls.connected ?? null, kind: 'count' },
  ] : board === 'source' ? [
    { label: 'Submitted premium', value: totals.second, kind: 'money' }, { label: 'Submitted', value: totals.first, kind: 'count' },
    { label: 'Close rate', value: share(totals.first, totals.leads), kind: 'percent' }, { label: 'Leads', value: totals.leads, kind: 'count' },
  ] : board === 'sp' ? [
    { label: 'Policies sold', value: totals.first, kind: 'count' }, { label: 'Annual premium', value: totals.second, kind: 'money' },
    { label: 'Close rate', value: calls.soldPerInboundLog ?? null, kind: 'percent' }, { label: 'Calls', value: calls.total ?? null, kind: 'count' },
  ] : [
    { label: 'Submitted', value: totals.first, kind: 'count' }, { label: 'Submitted premium', value: totals.second, kind: 'money' },
    { label: 'Close rate', value: share(totals.first, totals.leads), kind: 'percent' }, { label: 'Calls', value: totals.leads, kind: 'count' },
  ];
  const rows = ranked.slice(0, rowLimit).map((row, index) => ({ rank: index + 1, name: row.name, value: row[keys.second], count: row[keys.first] }));
  return {
    available: true, stats, rows,
    max: Math.max(0, ...rows.map(row => typeof row.value === 'number' ? row.value : 0)),
    more: Math.max(0, ranked.length - rows.length),
    valueLabel: keys.secondLabel, countLabel: keys.firstLabel,
    partial: Boolean(result.partial), fetchedAt: result.fetchedAt ?? null,
  };
}
