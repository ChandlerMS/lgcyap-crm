import { leaderboardCsvCell } from './leaderboard-data.mjs';

const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
export const LEAD_DATA_SOURCES = Object.freeze([{ id: 'policytek', label: 'PolicyTek' }, { id: 'ringcentral', label: 'RingCentral' }, { id: 'compare', label: 'Compare side by side' }]);
export const LEAD_DATA_METRICS = Object.freeze([{ id: 'instantDisconnects', label: 'Instant Disconnects' }, { id: 'shortDuration', label: 'Short Duration Calls' }]);
export const LEAD_DATA_REPORTS = Object.freeze({ instantDisconnects: 'Instant Hangups', shortDuration: 'Short Duration Calls' });

/** Most calls first, then the other count, then the name. Agents with none of these calls are not listed. */
export function rankLeadDataRows(rows, metric) {
  const other = metric === 'instantDisconnects' ? 'shortDuration' : 'instantDisconnects';
  return rows.filter(row => row[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || b[other] - a[other] || collator.compare(a.name, b.name))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Re-orders ranked rows. Each row keeps its rank, so medals and numbers never change with the sort. */
export function sortLeadDataRows(ranked, metric, sort = { field: 'count', direction: 'desc' }) {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...ranked].sort((a, b) => (sort.field === 'name' ? collator.compare(a.name, b.name) : a[metric] - b[metric]) * direction || a.rank - b.rank);
}

/** Every agent with either count, for the side by side table. */
export function leadDataCompareRows(rows) {
  return [...rows].sort((a, b) => b.shortDuration - a.shortDuration || b.instantDisconnects - a.instantDisconnects || collator.compare(a.name, b.name));
}

/**
 * The rows as shown, as CSV with numbers unformatted so spreadsheets can total them.
 * Calls with no agent are most of these calls, so an unsearched export ends with them and adds up to the page's total.
 * @param {{rank:number,name:string,instantDisconnects:number,shortDuration:number}[]} rows
 * @param {{instantDisconnects:number,shortDuration:number}|null} [noAgent]
 */
export function leadDataCsv(rows, noAgent = null) {
  const lines = rows.map(row => [row.rank, row.name, row.instantDisconnects, row.shortDuration]);
  if (noAgent) lines.push(['', 'No agent (N/A)', noAgent.instantDisconnects, noAgent.shortDuration]);
  return [['Rank', 'Agent', ...LEAD_DATA_METRICS.map(metric => metric.label)], ...lines].map(line => line.map(leaderboardCsvCell).join(',')).join('\r\n') + '\r\n';
}

/** e.g. lead-data-ringcentral-instant-disconnects-2026-11-01-to-2026-11-03.csv */
export function leadDataCsvFilename(sourceLabel, metricLabel, startDate, endDate) {
  const slug = `${sourceLabel}-${metricLabel}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dates = startDate ? endDate && endDate !== startDate ? `-${startDate}-to-${endDate}` : `-${startDate}` : '';
  return `lead-data-${slug}${dates}.csv`;
}
