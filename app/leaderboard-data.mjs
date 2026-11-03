const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
export const LEADERBOARD_BOARDS = Object.freeze([
  { id: 'shopper', label: 'Shopper' },
  { id: 'sp', label: 'Standard vs. Preferred' },
  { id: 'source', label: 'Source Performance' },
  { id: 'whatsapp', label: 'WhatsApp Sales' },
]);
export const LEADERBOARD_PERIODS = Object.freeze([{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'custom', label: 'Custom' }]);
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const signedNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const metricNumber = (value, key) => ['annualPremium', 'premium', 'production', 'roas'].includes(key) ? signedNumber(value) : nonnegative(value);
const descending = (first, second) => first === null || second === null ? first === null && second === null ? 0 : first === null ? 1 : -1 : second - first;
const SP_CALL_LABELS = Object.freeze({ ringcx: 'Calls (answered, RingCX)', mixed: 'Calls (answered, RingCX and Agent Daily Calls reports)', spreadsheet: 'Calls (answered, Agent Daily Calls reports)' });
const CALLS_SYNC_MS = 300000, CALLS_REFRESH_LAG_MS = 60000;

export function leaderboardSpCallLabel(basis) {
  return SP_CALL_LABELS[basis] ?? 'Calls (inbound logs attributed through deal owner)';
}

/** Standard vs. Preferred reloads only while its range can still gain calls. */
export function leaderboardCallsRefreshActive(period, to, today) {
  return period !== 'custom' || to >= today;
}

/** Reload a minute after each five-minute RingCX sync, so the page reads what that run just saved. */
export function leaderboardCallsRefreshDelay(now = Date.now()) {
  return CALLS_SYNC_MS - ((now - CALLS_REFRESH_LAG_MS) % CALLS_SYNC_MS);
}

export function leaderboardMetrics(board) {
  return board === 'sp' ? { first: 'sales', second: 'annualPremium', firstLabel: 'Policies sold', secondLabel: 'Annual premium' }
    // The imported daily reports record "Number of Sales" and "Total Production", not annual premium.
    : board === 'whatsapp' ? { first: 'sales', second: 'production', firstLabel: 'Sales', secondLabel: 'Total production' }
    : { first: 'submitted', second: 'premium', firstLabel: 'Submitted', secondLabel: 'Submitted premium' };
}

/** Missing financial values remain missing. Never manufacture a premium or a rank for an unconnected source. */
export function rankLeaderboardRows(rows, board, metric) {
  const keys = leaderboardMetrics(board), primary = metric === 'ap' ? keys.second : keys.first, secondary = metric === 'ap' ? keys.first : keys.second;
  return rows.map((row, index) => ({ ...row, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Name not recorded', [keys.first]: nonnegative(row[keys.first]), [keys.second]: signedNumber(row[keys.second]), index }))
    .filter(row => (board !== 'shopper' || row[keys.first] > 0) && row[primary] !== null && (row[primary] !== 0 || (metricNumber(row[secondary], secondary) ?? 0) !== 0))
    .sort((a, b) => Number(a.attributed === false) - Number(b.attributed === false) || descending(a[primary], b[primary]) || descending(a[secondary], b[secondary]) || collator.compare(a.name, b.name) || a.index - b.index);
}

export function leaderboardTotals(rows, board, metric = 'sales') {
  const keys = leaderboardMetrics(board);
  const sum = key => rows.every(row => metricNumber(row[key], key) !== null) ? rows.reduce((total, row) => total + row[key], 0) : null;
  const ranked = rankLeaderboardRows(rows, board, metric);
  const first = sum(keys.first), second = sum(keys.second), spend = sum('spend');
  const topMetric = metric === 'ap' ? keys.second : keys.first;
  const producer = ranked.find(row => row.attributed !== false && row[topMetric] > 0);
  return { first, second, activeAgents: rows.filter(row => row.attributed !== false && (nonnegative(row[keys.first]) ?? 0) > 0).length, top: producer?.name ?? null, leads: sum('leads'), spend, roas: second !== null && spend !== null && spend > 0 ? second / spend : null };
}

export function leaderboardBarWidth(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(max) && max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
}

export function sourceLeaderboardTableRows(rows, sort = { field: 'premium', direction: 'desc' }) {
  const field = ['name', 'leads', 'submitted', 'premium', 'closeRate', 'spend', 'roas'].includes(sort.field) ? sort.field : 'premium';
  const direction = sort.direction === 'asc' ? 1 : -1;
  return rows.map((row, index) => ({ ...row, index })).sort((a, b) => {
    const first = field === 'name' ? typeof a.name === 'string' && a.name.trim() ? a.name.trim() : null : sourceLeaderboardValue(a, field);
    const second = field === 'name' ? typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null : sourceLeaderboardValue(b, field);
    if (first === null || second === null) return first === null && second === null ? a.index - b.index : first === null ? 1 : -1;
    const result = typeof first === 'number' && typeof second === 'number' ? first - second : collator.compare(first, second);
    return result ? result * direction : a.index - b.index;
  });
}

export function sourceLeaderboardValue(row, field) {
  const direct = metricNumber(row[field], field);
  if (direct !== null) return direct;
  if (field === 'roas' && signedNumber(row.premium) !== null && nonnegative(row.spend) !== null && row.spend > 0) return row.premium / row.spend;
  if (field === 'closeRate' && nonnegative(row.submitted) !== null && nonnegative(row.leads) !== null && row.leads > 0) return row.submitted / row.leads;
  return null;
}

/** Columns the ranked list can be re-sorted by, premium first (the default). Labels follow each board's own metric names. */
export function leaderboardSortFields(board) {
  const keys = leaderboardMetrics(board), calls = board === 'source' ? 'Leads' : 'Calls';
  return [{ field: 'production', label: keys.secondLabel }, { field: 'calls', label: calls }, { field: 'closeRate', label: 'Close rate' }, { field: 'name', label: 'Alphabetical' }];
}

/** The value behind a sort field: calls are dialer/report calls on agent boards and PolicyTek leads on Shopper and Source. */
export function leaderboardSortValue(row, board, field) {
  if (field === 'name') return typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null;
  if (field === 'production') return signedNumber(row[leaderboardMetrics(board).second]);
  if (board === 'sp') return nonnegative(field === 'calls' ? row.inboundCalls : field === 'closeRate' ? row.soldPerInboundLog : null);
  if (board === 'whatsapp') return nonnegative(field === 'calls' ? row.queueConnected : field === 'closeRate' ? row.closeRate : null);
  return field === 'calls' ? nonnegative(row.leads) : field === 'closeRate' ? sourceLeaderboardValue(row, 'closeRate') : null;
}

/**
 * Re-orders already ranked rows. "rank" keeps the ranking order; missing values and unattributed rows always sort last.
 * Each row keeps its ranked position as `rank` so medals and numbers never change with the sort.
 */
export function sortLeaderboardRows(rankedRows, board, sort = { field: 'rank', direction: 'desc' }) {
  const rows = rankedRows.map((row, index) => ({ ...row, rank: index + 1 }));
  if (!['name', 'calls', 'closeRate', 'production'].includes(sort.field)) return rows;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const unattributed = Number(a.attributed === false) - Number(b.attributed === false);
    if (unattributed) return unattributed;
    const first = leaderboardSortValue(a, board, sort.field), second = leaderboardSortValue(b, board, sort.field);
    if (first === null || second === null) return first === null && second === null ? a.rank - b.rank : first === null ? 1 : -1;
    const result = typeof first === 'number' && typeof second === 'number' ? first - second : collator.compare(first, second);
    return result ? result * direction : a.rank - b.rank;
  });
}

/**
 * The rows as shown (sorted and searched) as CSV. Numbers stay unformatted so spreadsheets can total them;
 * missing values are blank, never zero. Names that start like a formula are prefixed with ' so they open as text.
 */
export function leaderboardCsv(rows, board) {
  const keys = leaderboardMetrics(board), source = board === 'source';
  const fixed = (value, places) => value === null ? '' : String(Math.round(value * 10 ** places) / 10 ** places);
  const percent = value => value === null ? '' : `${fixed(value * 100, 1)}%`;
  const cell = value => {
    const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = ['Rank', source ? 'Source' : 'Agent', source ? 'Leads' : 'Calls', 'Close rate', keys.firstLabel, keys.secondLabel, ...(source ? ['Spend', 'ROAS'] : [])];
  const lines = rows.map(row => [
    row.attributed === false ? '' : row.rank ?? '',
    typeof row.name === 'string' ? row.name : '',
    fixed(leaderboardSortValue(row, board, 'calls'), 0),
    percent(leaderboardSortValue(row, board, 'closeRate')),
    fixed(nonnegative(row[keys.first]), 0),
    fixed(signedNumber(row[keys.second]), 2),
    ...(source ? [fixed(nonnegative(row.spend), 2), fixed(sourceLeaderboardValue(row, 'roas'), 2)] : []),
  ]);
  return [header, ...lines].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** e.g. leaderboard-standard-vs-preferred-2026-11-01-to-2026-11-03.csv */
export function leaderboardCsvFilename(boardLabel, startDate, endDate) {
  const slug = String(boardLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'leaderboard';
  const dates = startDate ? endDate && endDate !== startDate ? `-${startDate}-to-${endDate}` : `-${startDate}` : '';
  return `leaderboard-${slug}${dates}.csv`;
}

/** Case- and accent-insensitive name search; every word typed must appear in the name. */
export function filterLeaderboardRows(rows, query) {
  const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.length ? rows.filter(row => { const name = fold(row.name); return words.every(word => name.includes(word)); }) : rows;
}
