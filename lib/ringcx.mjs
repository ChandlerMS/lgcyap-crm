// RingCX only. Never use RingEX analytics or agent session counters for daily totals.
const ROOT = 'https://ringcx.ringcentral.com';
export const RINGCX_SCOPE = Object.freeze({ accountId: '50560001', agentGroupId: '2498', queueGroupId: '1973', name: 'Agents - Standard vs Preferred' });
export class RingCxError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
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

export function createRingCx({ clientId = '', clientSecret = '', jwt = '', fetch: request = globalThis.fetch, clock = Date.now } = {}) {
  let token, tokenUntil = 0, tokenPending, pending, last, lastUntil = 0, retryAt = 0;
  async function json(url, options = {}) {
    let response;
    try { response = await request(url, { ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw new RingCxError('RINGCX_UNAVAILABLE'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        retryAt = clock() + Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000);
      }
      if (response.status === 401) { token = null; tokenUntil = 0; }
      throw new RingCxError([401, 403].includes(response.status) ? 'RINGCX_ACCESS_DENIED' : response.status === 429 ? 'RINGCX_RATE_LIMITED' : 'RINGCX_UNAVAILABLE');
    }
    try { return await response.json(); } catch { throw new RingCxError('INVALID_RINGCX_RESPONSE'); }
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
    token = cx.accessToken;
    // Conservative five-minute cache; never persist upstream session tokens.
    tokenUntil = clock() + 300000;
    return token;
  }
  async function accessToken() {
    if (token && tokenUntil > clock()) return token;
    if (!tokenPending) tokenPending = signIn().finally(() => { tokenPending = null; });
    return tokenPending;
  }
  async function read() {
    const access = await accessToken();
    const base = `${ROOT}/voice/api/v1/admin/accounts/${RINGCX_SCOPE.accountId}`;
    const headers = { Authorization: `Bearer ${access}`, Accept: 'application/json' };
    const agents = await json(`${base}/realTimeData/agent`, { headers });
    const queues = await json(`${base}/realTimeData/inbound`, { headers });
    const queueCounts = summarizeQueues(queues);
    const snapshot = {
      observedAt: new Date(clock()).toISOString(), timezone: 'America/New_York', scope: RINGCX_SCOPE,
      agents: summarizeAgents(agents), queues: queueCounts.queues,
      // connected is a concurrent-call gauge, NOT a cumulative daily counter.
      // accepted matches native Ans IB. Account timezone verified in Admin.
      calls: { connected: null, answered: queueCounts.accepted, activeConnected: queueCounts.connected, status: 'connected_pending_validation' },
    };
    last = snapshot; lastUntil = clock() + 15000;
    return snapshot;
  }
  return {
    async snapshot() {
      if (!clientId || !clientSecret || !jwt) throw new RingCxError('RINGCX_NOT_CONFIGURED');
      if (clock() < retryAt) throw new RingCxError('RINGCX_RATE_LIMITED');
      if (last && lastUntil > clock()) return last;
      if (!pending) pending = read().catch(error => { lastUntil = 0; retryAt = Math.max(retryAt, clock() + 15000); throw error; }).finally(() => { pending = null; });
      return pending;
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
