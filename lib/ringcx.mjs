// RingCX only. Never use RingEX analytics or agent session counters for daily totals.
const ROOT = 'https://ringcx.ringcentral.com';
export const RINGCX_SCOPE = Object.freeze({ accountId: '50560001', agentGroupId: '2498', queueGroupId: '1973', name: 'Agents - Standard vs Preferred' });
const ADMIN_BASE = `${ROOT}/voice/api/v1/admin/accounts/${RINGCX_SCOPE.accountId}`;
export class RingCxError extends Error {
  constructor(code, status = 503, detail = '') { super(code); this.code = code; this.status = status; this.detail = detail; }
}
const id = value => String(value ?? '');
const count = value => Number.isSafeInteger(value) && value >= 0;
// Live tenant responses use ENGAGED (including held calls); wrap is PENDING-DISP.
const activeCallStates = new Set(['ON_CALL', 'ENGAGED']);

export function summarizeAgents(rows, groupId = RINGCX_SCOPE.agentGroupId) {
  if (!Array.isArray(rows)) throw new RingCxError('INVALID_AGENT_RESPONSE');
  const agents = new Map();
  for (const row of rows) {
    if (!row || !id(row.agentId) || !id(row.agentGroupId) || typeof row.agentState !== 'string') throw new RingCxError('INVALID_AGENT_RESPONSE');
    if (id(row.agentGroupId) !== groupId) continue;
    // Multiple inconsistent sessions must not count an agent as both available and on a call.
    if (agents.has(id(row.agentId)) && agents.get(id(row.agentId)) !== row.agentState) throw new RingCxError('CONFLICTING_AGENT_SESSIONS');
    agents.set(id(row.agentId), row.agentState);
  }
  const states = [...agents.values()];
  return { loggedIn: states.length, available: states.filter(s => s === 'AVAILABLE').length, onCalls: states.filter(s => activeCallStates.has(s)).length, other: states.filter(s => s !== 'AVAILABLE' && !activeCallStates.has(s)).length };
}

export function summarizeQueues(rows, groupId = RINGCX_SCOPE.queueGroupId) {
  if (!Array.isArray(rows)) throw new RingCxError('INVALID_QUEUE_RESPONSE');
  const selected = rows.filter(row => id(row?.gateGroupId) === groupId);
  if (!selected.length) throw new RingCxError('QUEUE_GROUP_MISSING');
  const seen = new Set();
  for (const row of selected) {
    if (!id(row.gateId) || seen.has(id(row.gateId)) || !count(row.connected) || !count(row.accepted)) throw new RingCxError('INVALID_QUEUE_RESPONSE');
    seen.add(id(row.gateId));
  }
  return { queues: selected.length, connected: selected.reduce((n, row) => n + row.connected, 0), accepted: selected.reduce((n, row) => n + row.accepted, 0) };
}

export function onCallAgents(rows, groupId = RINGCX_SCOPE.agentGroupId) {
  return agentRoster(rows, groupId, activeCallStates);
}

export function averageWaitSeconds(rows, groupId = RINGCX_SCOPE.queueGroupId) {
  summarizeQueues(rows, groupId);
  const selected = rows.filter(row => id(row.gateGroupId) === groupId);
  if (selected.some(row => !count(row.totalAnswerTime))) return null;
  const answered = selected.reduce((sum, row) => sum + row.accepted, 0);
  const seconds = selected.reduce((sum, row) => sum + row.totalAnswerTime, 0);
  return answered > 0 && Number.isSafeInteger(seconds) ? seconds / answered : null;
}

export function availableAgents(rows, groupId = RINGCX_SCOPE.agentGroupId) {
  return agentRoster(rows, groupId, new Set(['AVAILABLE']));
}

export function busyAgents(rows, groupId = RINGCX_SCOPE.agentGroupId) {
  summarizeAgents(rows, groupId);
  return agentRoster(rows, groupId, new Set(rows.filter(row => row.agentState !== 'AVAILABLE').map(row => row.agentState)));
}

function agentRoster(rows, groupId, states) {
  // Apply the same validation and duplicate-session rules as the headline count.
  summarizeAgents(rows, groupId);
  const selected = new Map();
  for (const row of rows) {
    if (id(row.agentGroupId) !== groupId || !states.has(row.agentState)) continue;
    const name = [row.firstName, row.lastName].filter(part => typeof part === 'string').map(part => part.trim()).filter(Boolean).join(' ');
    const stateLabel = row.agentState.toLowerCase().replace(/[_-]+/g, ' ').replace(/^./, char => char.toUpperCase());
    selected.set(id(row.agentId), { id: id(row.agentId), name: name || `Agent ${id(row.agentId)}`, status: activeCallStates.has(row.agentState) ? (row.onHoldDts ? 'On hold' : 'On call') : stateLabel, todayCalls: null, todaySales: null, sessionCalls: count(row.callsHandled) ? row.callsHandled : null, stateSeconds: count(row.stateTime) ? row.stateTime : null });
  }
  return [...selected.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function createRingCx({ clientId = '', clientSecret = '', jwt = '', fetch: request = globalThis.fetch, clock = Date.now } = {}) {
  let token, rcToken, rcAccountId, tokenUntil = 0, tokenPending, pending, last, lastUntil = 0, retryAt = 0;
  // Report rejections say why (access, date rules). Only those bodies are kept, for the sync's status, never the board.
  async function json(url, { timeoutMs = 10000, explain = false, ...options } = {}) {
    let response;
    try { response = await request(url, { ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) { throw new RingCxError('RINGCX_UNAVAILABLE', 503, explain ? String(error?.name ?? 'request failed') : ''); }
    if (!response.ok) {
      const detail = explain ? `HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`.trim() : '';
      if (!explain) await response.body?.cancel();
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        retryAt = clock() + Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000);
      }
      if (response.status === 401) { token = null; tokenUntil = 0; }
      throw new RingCxError([401, 403].includes(response.status) ? 'RINGCX_ACCESS_DENIED' : response.status === 429 ? 'RINGCX_RATE_LIMITED' : 'RINGCX_UNAVAILABLE', 503, detail);
    }
    try { return await response.json(); } catch { throw new RingCxError('INVALID_RINGCX_RESPONSE', 503, explain ? `content-type ${response.headers.get('content-type') ?? 'missing'}` : ''); }
  }
  async function signIn() {
    const rc = await json('https://platform.ringcentral.com/restapi/oauth/token', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    });
    if (typeof rc.access_token !== 'string' || !rc.access_token) throw new RingCxError('INVALID_TOKEN_RESPONSE');
    const cx = await json(`${ROOT}/api/auth/login/rc/accesstoken?includeRefresh=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ rcAccessToken: rc.access_token, rcTokenType: 'Bearer' }).toString(),
    });
    if (typeof cx.accessToken !== 'string' || !cx.accessToken) throw new RingCxError('INVALID_TOKEN_RESPONSE');
    token = cx.accessToken; rcToken = rc.access_token;
    // Conservative five-minute cache; never persist upstream session tokens.
    tokenUntil = clock() + 300000;
    return token;
  }
  async function accessToken() {
    if (token && tokenUntil > clock()) return token;
    if (!tokenPending) tokenPending = signIn().finally(() => { tokenPending = null; });
    return tokenPending;
  }
  function assertUsable() {
    if (!clientId || !clientSecret || !jwt) throw new RingCxError('RINGCX_NOT_CONFIGURED');
    if (clock() < retryAt) throw new RingCxError('RINGCX_RATE_LIMITED');
  }
  async function read() {
    const access = await accessToken();
    const headers = { Authorization: `Bearer ${access}`, Accept: 'application/json' };
    const agents = await json(`${ADMIN_BASE}/realTimeData/agent`, { headers });
    const queues = await json(`${ADMIN_BASE}/realTimeData/inbound`, { headers });
    const queueCounts = summarizeQueues(queues);
    const snapshot = {
      observedAt: new Date(clock()).toISOString(), timezone: 'America/New_York', scope: RINGCX_SCOPE,
      agents: summarizeAgents(agents), onCallAgents: onCallAgents(agents), availableAgents: availableAgents(agents), queues: queueCounts.queues,
      busyAgents: busyAgents(agents), dailyPerformance: { sales: null, closeRate: null, status: 'pending_validation' },
      averageWaitSeconds: averageWaitSeconds(queues),
      // connected is a concurrent-call gauge, NOT a cumulative daily counter.
      // accepted matches native Ans IB. Account timezone verified in Admin.
      calls: { connected: null, answered: queueCounts.accepted, activeConnected: queueCounts.connected, status: 'connected_pending_validation' },
    };
    last = snapshot; lastUntil = clock() + 15000;
    return snapshot;
  }
  return {
    async snapshot() {
      assertUsable();
      if (last && lastUntil > clock()) return last;
      if (!pending) pending = read().catch(error => { lastUntil = 0; retryAt = Math.max(retryAt, clock() + 15000); throw error; }).finally(() => { pending = null; });
      return pending;
    },
    /** The Standard vs Preferred queues and today's answered total, from the same validated list as the live dashboard. */
    async svpQueues() {
      assertUsable();
      const queues = await json(`${ADMIN_BASE}/realTimeData/inbound`, { headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' } });
      const { accepted } = summarizeQueues(queues);
      return { ids: new Set(queues.filter(row => id(row.gateGroupId) === RINGCX_SCOPE.queueGroupId).map(row => id(row.gateId))), answeredToday: accepted };
    },
    /** Answered calls per agent and queue in 15-minute blocks. Times are Eastern 'YYYY-MM-DD HH:mm:ss', at most three hours apart and five minutes old. */
    async agentQueueReport({ startDate, endDate }) {
      assertUsable();
      const access = await accessToken();
      if (!rcAccountId) {
        const account = await json('https://platform.ringcentral.com/restapi/v1.0/account/~', { explain: true, headers: { Authorization: `Bearer ${rcToken}`, Accept: 'application/json' } });
        if (!/^[1-9]\d{0,19}$/.test(id(account?.id))) throw new RingCxError('INVALID_ACCOUNT_RESPONSE');
        rcAccountId = id(account.id);
      }
      return json(`${ROOT}/voice/api/cx/integration/v1/accounts/${rcAccountId}/sub-accounts/${RINGCX_SCOPE.accountId}/agg-agent-extended-stats`, {
        method: 'POST', explain: true, timeoutMs: 20000, headers: { Authorization: `Bearer ${access}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, timeInterval: 15, timeZone: 'US/Eastern' }),
      });
    },
  };
}

export async function ringCxResponse({ getUser, client }) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
  try {
    if (!await getUser()) return Response.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401, headers });
    return Response.json(await client.snapshot(), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof RingCxError ? error.code : 'RINGCX_UNAVAILABLE' }, { status: 503, headers });
  }
}
