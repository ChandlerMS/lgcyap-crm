const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
export const LEADERBOARD_BOARDS = Object.freeze([
  { id: 'sp', label: 'Standard vs. Preferred' },
  { id: 'shopper', label: 'Shopper' },
  { id: 'source', label: 'Source Performance' },
]);
export const LEADERBOARD_PERIODS = Object.freeze([{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]);
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const signedNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const metricNumber = (value, key) => ['annualPremium', 'premium', 'roas'].includes(key) ? signedNumber(value) : nonnegative(value);
const descending = (first, second) => first === null || second === null ? first === null && second === null ? 0 : first === null ? 1 : -1 : second - first;

export function leaderboardMetrics(board) {
  return board === 'sp' ? { first: 'sales', second: 'annualPremium', firstLabel: 'Policies sold', secondLabel: 'Annual premium' }
    : { first: 'submitted', second: 'premium', firstLabel: 'Submitted', secondLabel: 'Submitted premium' };
}

/** Missing financial values remain missing. Never manufacture a premium or a rank for an unconnected source. */
export function rankLeaderboardRows(rows, board, metric) {
  const keys = leaderboardMetrics(board), primary = metric === 'ap' ? keys.second : keys.first, secondary = metric === 'ap' ? keys.first : keys.second;
  return rows.map((row, index) => ({ ...row, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Name not recorded', [keys.first]: nonnegative(row[keys.first]), [keys.second]: signedNumber(row[keys.second]), index }))
    .filter(row => row[primary] !== null && (row[primary] !== 0 || (metricNumber(row[secondary], secondary) ?? 0) !== 0))
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
