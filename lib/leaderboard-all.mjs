import { LeaderboardError, validateLeaderboardInput } from './leaderboard.mjs';
import { leaderboardCustomPeriod, leaderboardPeriod } from './leaderboard-period.mjs';
import { svpAgentKey } from './svp-calls.mjs';

const SOURCE = 'PolicyTek + HubSpot';
// Shopper's activity is PolicyTek leads from the browser sync, or inbound calls where its Calls and Applications reports are imported.
const activityNotice = shopperReports => `All adds Shopper submitted policies and premium from PolicyTek to Standard vs. Preferred sales and annual premium from HubSpot. Calls / leads adds ${shopperReports ? 'inbound calls from the imported PolicyTek Calls report' : 'PolicyTek leads'} and the effective Standard vs. Preferred call count; Sales / activity is combined sales divided by that mixed activity. Policies may appear in both platforms. Ranks use agent rows; top totals also include activity outside those rows.`;
const emptyTotals = () => ({ sales: null, annualPremium: null, calls: null, closeRate: null });
const invalid = () => new TypeError('Invalid source aggregate.');
function count(value) { if (!Number.isSafeInteger(value) || value < 0) throw invalid(); return value; }
function add(left, right) { const total = left + right; if (!Number.isSafeInteger(total)) throw invalid(); return total; }
function moneyCents(value) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  // Source boards already round to cents. Read their decimal representation before summing.
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw invalid();
  const amount = (BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))) * (match[1] ? -1n : 1n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) throw invalid();
  return Number(amount);
}
function addNullable(left, right) { return left === null || right === null ? null : add(left, right); }
function agentName(value) {
  if (typeof value !== 'string' || value.length > 200) throw invalid();
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw invalid();
  return name;
}
function sourceNotice(label, value) {
  return typeof value === 'string' && value.trim() ? `${label}: ${value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 800)}` : '';
}
function normalizeSource(result, board, bounds, period) {
  if (!result || result.status !== 'available' || result.board !== board || result.period !== period || result.startDate !== bounds.startDate || result.endDate !== bounds.endDate || !Array.isArray(result.rows)) throw invalid();
  const rows = result.rows.map(row => {
    const name = agentName(row?.name), attributed = row.attributed !== false && Boolean(name);
    return { name: attributed ? name : board === 'shopper' ? 'PolicyTek agent not recorded' : 'HubSpot writing agent not recorded', attributed,
      sales: count(board === 'shopper' ? row.submitted : row.sales), cents: moneyCents(board === 'shopper' ? row.premium : row.annualPremium),
      callKey: board === 'sp' && attributed && ['ringcx', 'spreadsheet'].includes(result.calls?.basis) ? svpAgentKey(row.name) : null,
      inboundCalls: board === 'shopper' ? count(row.leads) : row.inboundCalls === null ? null : count(row.inboundCalls) };
  });
  const totals = board === 'shopper'
    ? { sales: count(result.reportTotals?.submitted), cents: moneyCents(result.reportTotals?.premium), calls: count(result.reportTotals?.leads) }
    : { sales: rows.reduce((sum, row) => add(sum, row.sales), 0), cents: rows.reduce((sum, row) => addNullable(sum, row.cents), 0), calls: result.calls?.status === 'available' ? count(result.calls.total) : null };
  return { result, rows, totals };
}
function aggregateRows(sources) {
  const agents = new Map();
  for (const [sourceIndex, source] of sources.entries()) for (const row of source.rows) {
    // Do not infer identity for missing agents, or add aliases/accent folding to named agents.
    const key = row.attributed ? `named:${row.name.toLowerCase()}` : `unattributed:${sourceIndex}`;
    const aggregate = agents.get(key) ?? { name: row.name, attributed: row.attributed, sales: 0, cents: 0, inboundCalls: 0, callEntries: new Map() };
    aggregate.sales = add(aggregate.sales, row.sales);
    aggregate.cents = addNullable(aggregate.cents, row.cents);
    // Imported/report calls are assigned once per normalized agent, even if HubSpot
    // has several sales rows for capitalization variants. Owner-log counts remain additive.
    const callKey = row.callKey === null ? null : `${sourceIndex}:${row.callKey}`;
    if (callKey === null || !aggregate.callEntries.has(callKey)) {
      aggregate.inboundCalls = addNullable(aggregate.inboundCalls, row.inboundCalls);
      if (callKey !== null) aggregate.callEntries.set(callKey, row.inboundCalls);
    } else if (aggregate.callEntries.get(callKey) !== row.inboundCalls) throw invalid();
    agents.set(key, aggregate);
  }
  return [...agents.values()].map(row => ({ name: row.name, attributed: row.attributed, sales: row.sales, annualPremium: row.cents === null ? null : row.cents / 100,
    inboundCalls: row.inboundCalls, soldPerInboundLog: row.inboundCalls > 0 ? row.sales / row.inboundCalls : null }))
    .sort((a, b) => b.sales - a.sales || (b.annualPremium ?? -Infinity) - (a.annualPremium ?? -Infinity) || a.name.localeCompare(b.name, 'en-US'));
}

/**
 * Read both existing boards for one captured Eastern range. Only aggregate fields leave this wrapper.
 * @param {{board:string,period:string,from?:string,to?:string}} input
 * @param {{readShopper:(input:any,options:{now:number})=>Promise<any>,readStandardPreferred:(input:any,options:{now:number})=>Promise<any>,now?:(()=>number)|number}} options
 */
export async function readAllLeaderboard(input, { readShopper, readStandardPreferred, now = Date.now }) {
  const selected = validateLeaderboardInput(input);
  if (selected.board !== 'all') throw new LeaderboardError('INVALID_REQUEST', 'Choose the All leaderboard.', 400);
  const capturedNow = typeof now === 'function' ? now() : now;
  const bounds = selected.period === 'custom' ? leaderboardCustomPeriod(selected.from, selected.to) : leaderboardPeriod(selected.period, capturedNow);
  const settled = await Promise.allSettled([
    Promise.resolve().then(() => readShopper({ ...selected, board: 'shopper' }, { now: capturedNow })),
    Promise.resolve().then(() => readStandardPreferred({ ...selected, board: 'sp' }, { now: capturedNow })),
  ]);
  const shopperReports = settled[0].status === 'fulfilled' && settled[0].value?.basis === 'reports';
  const sources = [], missing = [];
  for (const [index, response] of settled.entries()) {
    try { sources[index] = normalizeSource(response.status === 'fulfilled' ? response.value : null, index === 0 ? 'shopper' : 'sp', bounds, selected.period); }
    catch { missing.push(index === 0 ? 'PolicyTek Shopper' : 'HubSpot Standard vs. Preferred'); }
  }
  const stamps = sources.filter(Boolean).map(source => Date.parse(source.result.fetchedAt)).filter(Number.isFinite);
  const notices = settled.flatMap((response, index) => response.status === 'fulfilled' ? [sourceNotice(index === 0 ? 'PolicyTek' : 'HubSpot', response.value?.notice), sourceNotice(index === 0 ? 'PolicyTek activity' : 'Standard vs. Preferred calls', response.value?.callNotice)] : []).filter(Boolean);
  const retries = settled.map(response => response.status === 'fulfilled' ? response.value?.retryAfterSeconds : null).filter(value => Number.isSafeInteger(value) && value > 0);
  const base = { ...selected, source: SOURCE, startDate: bounds.startDate, endDate: bounds.endDate, rows: [], partial: true,
    stale: sources.some(source => Boolean(source?.result.stale)), fetchedAt: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
    combinedTotals: emptyTotals(), calls: { status: 'unavailable', total: null, partial: true, soldPerInboundLog: null },
    ...(retries.length ? { retryAfterSeconds: Math.min(Math.max(...retries), 86400) } : {}) };
  if (missing.length) {
    const message = `All is unavailable because ${missing.join(' and ')} could not supply this exact date range.`;
    return { ...base, status: 'unavailable', notice: [message, activityNotice(shopperReports), ...notices].join(' '), error: { code: 'ALL_SOURCE_UNAVAILABLE', message } };
  }
  try {
    const [shopper, sp] = sources;
    const sales = add(shopper.totals.sales, sp.totals.sales), premium = addNullable(shopper.totals.cents, sp.totals.cents), calls = addNullable(shopper.totals.calls, sp.totals.calls);
    const partialCalls = Boolean(shopper.result.partial || sp.result.calls?.partial), partial = Boolean(shopper.result.partial || sp.result.partial || partialCalls || calls === null);
    const closeRate = calls > 0 ? sales / calls : null;
    return { ...base, status: 'available', rows: aggregateRows(sources), partial,
      combinedTotals: { sales, annualPremium: premium === null ? null : premium / 100, calls, closeRate },
      calls: { status: calls === null ? 'unavailable' : 'available', total: calls, partial: partialCalls, soldPerInboundLog: closeRate },
      notice: [activityNotice(shopperReports), ...(partial ? ['Some source metrics or rankings are incomplete; review the source notices.'] : []), ...(calls === null ? ['Standard vs. Preferred call metrics are unavailable; combined activity and its ratio are unavailable.'] : []), ...notices].join(' ') };
  } catch {
    const message = 'All is unavailable because the PolicyTek and HubSpot aggregates could not be safely combined.';
    return { ...base, status: 'unavailable', notice: `${message} ${activityNotice(shopperReports)}`, error: { code: 'ALL_AGGREGATE_INVALID', message } };
  }
}
