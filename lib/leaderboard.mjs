import { isAllowedOrigin } from './hubspot.mjs';
import { leaderboardPeriod } from './leaderboard-period.mjs';

// Portal metadata verified with HubSpot get_properties, 2026-10-30. No customer fields are returned.
export const LEADERBOARD_DEAL_SCHEMA = Object.freeze({ portalId: '50894788', appId: '59264745', pipeline: 'default', stage: 'closedwon', scope: 'crm.objects.deals.read', currency: 'USD' });
const TOKEN_URL = 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info';
const SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/deals/search';
const FIELDS = ['writing_agent_name', 'annual_premium_amount', 'closedate', 'pipeline', 'dealstage', 'hs_is_closed_won', 'deal_currency_code'];
const PAGE_SIZE = 200, PAGE_LIMIT = 50;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
let accessCache = null;
export class LeaderboardError extends Error {
  constructor(code, message, status = 502, retryAfterSeconds = null) { super(message); this.name = 'LeaderboardError'; this.code = code; this.status = status; this.retryAfterSeconds = retryAfterSeconds; }
}
const invalid = () => new LeaderboardError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected leaderboard response. Refresh to try again.');
const accessRequired = () => new LeaderboardError('HUBSPOT_DEAL_ACCESS_REQUIRED', 'HubSpot deal-read access is required for this leaderboard.', 403);
export function validateLeaderboardInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || Object.keys(input).some(key => !['board', 'period'].includes(key)) || !['sp', 'shopper', 'source'].includes(input.board) || !['day', 'week', 'month'].includes(input.period)) throw new LeaderboardError('INVALID_REQUEST', 'Choose a valid leaderboard and period.', 400);
  return { board: input.board, period: input.period };
}
async function readJson(response, limit) {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) { await reader.cancel(); throw invalid(); } text += decoder.decode(value, { stream: true }); }
  text += decoder.decode(); try { return JSON.parse(text); } catch { throw invalid(); }
}
function retryDelay(response) { const seconds = Number(response.headers.get('Retry-After')); return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 86400) : 60; }
async function provider(url, body, { accessToken, fetchImpl, timeoutMs }, limit = 1024 * 1024) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status === 429) throw new LeaderboardError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before refreshing.', 429, retryDelay(response));
    if (response.status === 401 || response.status === 403) throw accessRequired();
    if (!response.ok) throw new LeaderboardError('HUBSPOT_UNAVAILABLE', 'HubSpot could not load the leaderboard. Refresh to try again.');
    return await readJson(response, limit);
  } catch (error) { if (error instanceof LeaderboardError) throw error; throw new LeaderboardError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this leaderboard read. Refresh to try again.'); }
  finally { clearTimeout(timer); }
}
async function verifyDealAccess(options, now) {
  if (accessCache?.token === options.accessToken && accessCache.fetchImpl === options.fetchImpl && accessCache.expiresAt > now()) return;
  const info = await provider(TOKEN_URL, { tokenKey: options.accessToken }, options, 16384);
  if (String(info?.hubId) !== LEADERBOARD_DEAL_SCHEMA.portalId || String(info?.appId) !== LEADERBOARD_DEAL_SCHEMA.appId || !Array.isArray(info.scopes) || !info.scopes.includes(LEADERBOARD_DEAL_SCHEMA.scope)) throw accessRequired();
  accessCache = { token: options.accessToken, fetchImpl: options.fetchImpl, expiresAt: now() + 60000 };
}
function cents(value) {
  if (typeof value !== 'string' || !/^-?\d{1,13}(?:\.\d{1,18})?$/.test(value)) return null;
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  let amount = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (fraction[2] >= '5') amount += 1n;
  if (negative) amount = -amount;
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) && amount >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(amount) : null;
}
function closedTime(value) { const time = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : null; }
/** Only safe aggregate facts leave the server; no deal/customer names, phones or emails. */
export function aggregateLeaderboardDeals(deals, bounds) {
  const agents = new Map(); let missingAgentCount = 0, missingPremiumCount = 0;
  for (const record of deals) {
    const p = record?.properties, close = closedTime(p?.closedate);
    if (!p || p.pipeline !== 'default' || p.dealstage !== 'closedwon' || p.hs_is_closed_won !== 'true' || close === null || close < bounds.startMs || close >= bounds.endMs) throw invalid();
    if (p.writing_agent_name != null && (typeof p.writing_agent_name !== 'string' || p.writing_agent_name.length > 200 || /[\u0000-\u001f\u007f]/.test(p.writing_agent_name))) throw invalid();
    const recordedName = (p.writing_agent_name ?? '').trim().normalize('NFC').replace(/\s+/g, ' ');
    const attributed = Boolean(recordedName), name = recordedName || 'Writing agent not recorded', groupKey = attributed ? `named:${name}` : 'unattributed';
    if (!attributed) missingAgentCount++;
    const premium = p.deal_currency_code === 'USD' ? cents(p.annual_premium_amount) : null;
    if (premium === null) missingPremiumCount++;
    const row = agents.get(groupKey) ?? { name, attributed, sales: 0, cents: 0, missing: false };
    row.sales++;
    if (premium === null) row.missing = true;
    else { row.cents += premium; if (!Number.isSafeInteger(row.cents)) throw invalid(); }
    agents.set(groupKey, row);
  }
  const rows = [...agents.values()].map(row => ({ name: row.name, attributed: row.attributed, sales: row.sales, annualPremium: row.missing ? null : row.cents / 100 }))
    .sort((a, b) => b.sales - a.sales || (b.annualPremium ?? -Infinity) - (a.annualPremium ?? -Infinity) || a.name.localeCompare(b.name, 'en-US'));
  return { rows, missingAgentCount, missingPremiumCount };
}

/** @param {{board:string,period:string}} input @param {{accessToken?:string,fetchImpl?:typeof fetch,now?:()=>number,timeoutMs?:number,budgetMs?:number,pause?:(ms:number)=>Promise<void>}} options */
export async function readLeaderboard(input, { accessToken, fetchImpl = fetch, now = Date.now, timeoutMs = 8000, budgetMs = 45000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const selected = validateLeaderboardInput(input), started = now(), bounds = leaderboardPeriod(selected.period, started);
  const result = { ...selected, status: 'available', rows: [], partial: false, source: selected.board === 'sp' ? 'HubSpot' : 'PolicyTek', notice: selected.board === 'sp' ? 'Sold deals in Sales Pipeline, grouped by writing agent. Annual premium is USD. Close dates use Eastern time; HubSpot search updates may take a few moments.' : 'PolicyTek data is not connected to this app.', fetchedAt: new Date(started).toISOString(), startDate: bounds.startDate, endDate: bounds.endDate };
  if (selected.board !== 'sp') return { ...result, status: 'connection-required', error: { code: 'POLICYTEK_NOT_CONNECTED', message: 'PolicyTek data is not connected to this app.' } };
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) return { ...result, status: 'connection-required', error: { code: 'HUBSPOT_CONNECTION_REQUIRED', message: 'The secure HubSpot connection is not available.' } };
  const records = new Map(), seen = new Set(); let after, expectedTotal = null, paginationLimited = false;
  const remaining = () => Math.min(timeoutMs, started + Math.min(55000, Math.max(1000, budgetMs)) - now());
  try {
    await verifyDealAccess({ accessToken, fetchImpl, timeoutMs: Math.max(1, remaining()) }, now);
    for (let page = 0; page < PAGE_LIMIT; page++) {
      if (remaining() < 250) { paginationLimited = true; break; }
      if (page > 0) await pause(220);
      if (remaining() < 250) { paginationLimited = true; break; }
      const filters = [{ propertyName: 'pipeline', operator: 'EQ', value: 'default' }, { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }, { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'true' }, { propertyName: 'closedate', operator: 'GTE', value: String(bounds.startMs) }, { propertyName: 'closedate', operator: 'LT', value: String(bounds.endMs) }];
      const payload = await provider(SEARCH_URL, { properties: FIELDS, filterGroups: [{ filters }], limit: PAGE_SIZE, sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }], ...(after ? { after } : {}) }, { accessToken, fetchImpl, timeoutMs: Math.max(1, remaining()) });
      if (!payload || !Number.isSafeInteger(payload.total) || payload.total < 0 || !Array.isArray(payload.results) || payload.results.length > PAGE_SIZE) throw invalid();
      if (payload.total > PAGE_SIZE * PAGE_LIMIT) paginationLimited = true;
      if (expectedTotal !== null && payload.total !== expectedTotal) result.partial = true;
      expectedTotal = payload.total;
      for (const record of payload.results) { if (!record || typeof record.id !== 'string' || !/^[1-9]\d{0,29}$/.test(record.id) || record.archived) throw invalid(); if (records.has(record.id)) result.partial = true; records.set(record.id, record); }
      const next = payload.paging?.next;
      if (!next) { if (records.size !== expectedTotal) result.partial = true; break; }
      const cursor = typeof next.after === 'number' && Number.isSafeInteger(next.after) ? String(next.after) : next.after;
      if (typeof cursor !== 'string' || !/^[1-9]\d{0,4}$/.test(cursor) || seen.has(cursor) || !payload.results.length) throw invalid();
      if (Number(cursor) >= 10000 || page === PAGE_LIMIT - 1) { paginationLimited = true; break; }
      seen.add(cursor); after = cursor;
    }
    if (paginationLimited && !records.size) throw new LeaderboardError('LEADERBOARD_READ_LIMIT', 'HubSpot took too long to load the leaderboard. Refresh to try again.');
    const aggregate = aggregateLeaderboardDeals([...records.values()], bounds);
    result.rows = aggregate.rows; result.partial ||= paginationLimited || aggregate.missingAgentCount > 0 || aggregate.missingPremiumCount > 0;
    if (paginationLimited) result.notice += ' This ranking covers a limited set of loaded deals; refresh before relying on complete totals.';
    if (aggregate.missingAgentCount) result.notice += ` ${aggregate.missingAgentCount} Sold deals have no writing agent recorded.`;
    if (aggregate.missingPremiumCount) result.notice += ` ${aggregate.missingPremiumCount} annual premium values are missing, invalid, or not USD; affected agent premium totals are unavailable.`;
    if (result.partial && !paginationLimited && !aggregate.missingAgentCount && !aggregate.missingPremiumCount) result.notice += ' HubSpot results changed while loading; refresh before relying on complete totals.';
    return result;
  } catch (error) {
    const safe = error instanceof LeaderboardError ? error : new LeaderboardError('LEADERBOARD_UNAVAILABLE', 'The leaderboard could not be loaded. Refresh to try again.');
    if (safe.code === 'HUBSPOT_DEAL_ACCESS_REQUIRED') accessCache = null;
    return { ...result, status: safe.code === 'HUBSPOT_DEAL_ACCESS_REQUIRED' ? 'connection-required' : 'unavailable', rows: [], partial: false, error: { code: safe.code, message: safe.message }, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) };
  }
}

function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } }); }
/** @param {Request} request @param {{getUser:()=>unknown|Promise<unknown>,authorizeUser?:(user:unknown)=>boolean,allowedOrigin?:string,readData:(input:{board:string,period:string})=>Promise<any>}} options */
export async function handleLeaderboardRequest(request, { getUser, authorizeUser = () => false, allowedOrigin, readData }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to load the leaderboard.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to view the leaderboard.' }, signInPath: '/sign-in' }, 401);
    if (!authorizeUser(user)) return json({ error: { code: 'ACCESS_DENIED', message: 'This account cannot access the leaderboard.' } }, 403);
    if (!isAllowedOrigin(request, allowedOrigin)) return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Open the private app directly before refreshing.' } }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return json({ error: { code: 'INVALID_REQUEST', message: 'Use a JSON request.' } }, 415);
    const reader = request.body?.getReader(); const decoder = new TextDecoder(); let size = 0, body = '';
    if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 512) { await reader.cancel(); return json({ error: { code: 'INVALID_REQUEST', message: 'The leaderboard request is too large.' } }, 413); } body += decoder.decode(value, { stream: true }); }
    body += decoder.decode(); let input;
    try { input = validateLeaderboardInput(JSON.parse(body)); } catch { return json({ error: { code: 'INVALID_REQUEST', message: 'Choose a valid leaderboard and period.' } }, 400); }
    const result = await readData(input);
    return json(result, 200, result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : {});
  } catch { return json({ error: { code: 'LEADERBOARD_UNAVAILABLE', message: 'The leaderboard could not be loaded. Refresh to try again.' } }, 503); }
}
