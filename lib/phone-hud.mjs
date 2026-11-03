import { isAllowedOrigin } from './hubspot.mjs';
import { availableRule } from './phone-hud-rule.mjs';
import { leaderboardPeriod } from './leaderboard-period.mjs';

// PolicyTek's Phone HUD (app.policytek.com/phone-HUD), read the way that page reads it. "On Live Calls" is the
// workspace's in-progress calls from the last two hours; "Available" is the employees whose calling status is
// available, less anyone on one of those calls or marked busy. On DND and Offline are never requested.
// "Calls today" counts the same sales agents' calls of any status since midnight Eastern.
// Only names, call direction, lead source and times leave this module: no phone numbers or emails.

const API = 'https://api.policytek.com/';
const TOKEN_MS = 100_000; // PolicyTek's own app swaps its refresh token for an access token every two minutes
const SALES_AGENTS_MS = 5 * 60_000;
const SNAPSHOT_MS = 4_000; // screens polling within this share one PolicyTek read
const CALL_WINDOW_MS = 2 * 3_600_000;
const DAY_CALLS_MS = 60_000; // a whole day's calls is a much larger read than the live board, so it runs once a minute
const DAY_CALLS_LIMIT = 999; // PolicyTek's page size; a full page shows as "999+"
const TIMEOUT_MS = 8_000;
const PRIVATE_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' });

export class PhoneHudError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhoneHudError';
    this.code = code;
  }
}

const text = (value, max = 80) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const recordId = value => /^[A-Za-z0-9_-]{1,64}$/.test(text(value, 64)) ? text(value, 64) : '';
const fullName = person => [person?.firstName, person?.middleName, person?.lastName].map(part => text(part, 40)).filter(Boolean).join(' ') || 'Unnamed agent';

function time(value) {
  const millis = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(millis) ? millis : null;
}

function items(body, path) {
  if (!Array.isArray(body?.items)) throw new PhoneHudError('POLICYTEK_RESPONSE_INVALID', `${path}: no items`);
  return body.items.filter(item => item && typeof item === 'object');
}

const defaultLog = entry => console.error(JSON.stringify(entry));

/**
 * One reader per server instance: its access token, the sales-agent list and the last board are the same for every
 * signed-in screen, so they are kept here rather than per request.
 */
export function createPhoneHud({ refreshToken = '', workspaceId = '', apiBase = API, fetch = globalThis.fetch, clock = Date.now, rule = availableRule, log = defaultLog } = {}) {
  let token = null;
  let tokenPending = null;
  let salesAgents = null;
  let dayCalls = null;
  let last = null;
  let pending = null;

  async function accessToken(fresh = false) {
    if (tokenPending) return tokenPending;
    if (!fresh && token && token.until > clock()) return token.value;
    tokenPending = refreshAccessToken();
    try { return await tokenPending; } finally { tokenPending = null; }
  }

  async function refreshAccessToken() {
    const response = await fetch(new URL('v1/auth/get-access-token', apiBase), {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // The HUD is a screen, never a person working, so it asks to be counted as idle.
      body: JSON.stringify({ refreshToken, workspaceID: workspaceId, isIdle: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ([400, 401, 403].includes(response.status)) { await response.body?.cancel(); throw new PhoneHudError('POLICYTEK_SIGN_IN', `get-access-token ${response.status}`); }
    if (!response.ok) { await response.body?.cancel(); throw new PhoneHudError('POLICYTEK_UNAVAILABLE', `get-access-token ${response.status}`); }
    const value = text((await response.json())?.data?.accessToken, 4096);
    if (!value) throw new PhoneHudError('POLICYTEK_SIGN_IN', 'get-access-token: no accessToken');
    token = { value, until: clock() + TOKEN_MS };
    return value;
  }

  // One PolicyTek request. A 401 means the access token lapsed early: sign in again once, then give up.
  async function call(path, params = [], init = {}) {
    const url = new URL(path, apiBase);
    for (const [key, value] of params) url.searchParams.append(key, value);
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        headers: { ...init.headers, Accept: 'application/json', Authorization: `Bearer ${await accessToken(attempt > 0)}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new PhoneHudError('POLICYTEK_SIGN_IN', `${path} ${response.status}`); }
      if (!response.ok) { await response.body?.cancel(); throw new PhoneHudError('POLICYTEK_UNAVAILABLE', `${path} ${response.status}`); }
      return response.json();
    }
  }

  // The workspace's "sales_agents" option. When it lists anyone, PolicyTek's HUD shows only them, and so does this one.
  async function salesAgentIds() {
    if (salesAgents && salesAgents.until > clock()) return salesAgents.ids;
    const body = await call('v1/ws/options/get-by-keys', [], {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ['sales_agents'] }),
    });
    const list = body?.data?.sales_agents;
    if (!Array.isArray(list)) throw new PhoneHudError('POLICYTEK_RESPONSE_INVALID', 'sales_agents: missing list');
    const ids = new Set(Array.isArray(list) ? list.map(recordId).filter(Boolean) : []);
    salesAgents = { ids, until: clock() + SALES_AGENTS_MS };
    return ids;
  }

  // The agent on each of today's calls. A failed read keeps today's last list and tries again in a minute instead of
  // failing the board; a new Eastern day starts empty.
  async function todaysCalls(now) {
    const { startMs } = leaderboardPeriod('day', now);
    if (dayCalls?.startMs === startMs && dayCalls.until > now) return dayCalls;
    const kept = dayCalls?.startMs === startMs ? dayCalls : { agentIds: null, capped: false };
    try {
      const list = items(await call('v1/calls', [['limit', String(DAY_CALLS_LIMIT)], ['createdAt_start', new Date(startMs).toISOString()]]), 'v1/calls');
      dayCalls = { startMs, agentIds: list.map(item => recordId(item.agent?._id)), capped: list.length >= DAY_CALLS_LIMIT, until: now + DAY_CALLS_MS };
    } catch (error) {
      log({ event: 'phone_hud_day_calls_error', code: error instanceof PhoneHudError ? error.code : 'POLICYTEK_UNAVAILABLE' });
      dayCalls = { ...kept, startMs, until: now + DAY_CALLS_MS };
    }
    return dayCalls;
  }

  async function read(now) {
    if (!refreshToken || !workspaceId) return { ok: false, now, error: 'not_configured' };
    await accessToken(); // once, before the reads below would each sign in at the same time
    const [agents, callBody, userBody, day] = await Promise.all([
      salesAgentIds(),
      call('v1/calls', [['limit', '999'], ['status', 'in-progress'], ['createdAt_start', new Date(now - CALL_WINDOW_MS).toISOString()]]),
      call('v1/ws/users/', [
        ['isEmployee', 'true'], ['limit', '999'], ['callingStatus', 'available'],
        ['recordStatus', 'active'], ['recordStatus', 'pending'], ['sortBy', 'lastUserActivity'], ['order', 'desc'],
      ]),
      todaysCalls(now),
    ]);
    const counted = agentId => Boolean(agentId) && (!agents.size || agents.has(agentId));
    const liveCalls = items(callBody, 'v1/calls');

    // Longest call first.
    const calls = liveCalls
      .filter(item => text(item.agent?.firstName) && counted(recordId(item.agent?._id)) && recordId(item._id))
      .map(item => ({
        id: recordId(item._id),
        name: fullName(item.agent),
        direction: item.direction === 'inbound' || item.direction === 'outbound' ? item.direction : null,
        source: text(item.leadSource?.alias) || text(item.leadSource?.name) || null,
        since: time(item.createdAt) ?? now,
      }))
      .sort((a, b) => a.since - b.since);

    // Longest wait first; anyone without an "available since" goes last.
    const talking = new Set(liveCalls.map(item => recordId(item.agent?._id)).filter(Boolean));
    const available = [];
    for (const item of items(userBody, 'v1/ws/users')) {
      const id = recordId(item.userID);
      if (!counted(id) || talking.has(id) || item.busy === true || item.callingStatus !== 'available') continue;
      const agent = {
        id,
        name: fullName(text(item.employeeInfo?.firstName) ? item.employeeInfo : item.user),
        since: time(item.availableSince),
        lastSeen: time(item.lastActivity),
        lastActive: time(item.lastUserActivity),
        idle: item.isIdle === true,
      };
      const shown = rule(agent, now);
      if (shown !== 'hide') available.push({ ...agent, dim: shown === 'dim' });
    }
    available.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));

    const callsToday = day.agentIds ? { count: day.agentIds.filter(counted).length, capped: day.capped } : null;
    return { ok: true, now, calls, available, callsToday };
  }

  return {
    async board() {
      if (pending) return pending;
      pending = loadBoard();
      try { return await pending; } finally { pending = null; }
    },
  };

  async function loadBoard() {
      const now = clock();
      if (last && now - last.at < SNAPSHOT_MS) return last.board;
      let board;
      try {
        board = await read(now);
      } catch (error) {
        const signIn = error instanceof PhoneHudError && error.code === 'POLICYTEK_SIGN_IN';
        if (signIn) token = null;
        log({ event: 'phone_hud_error', code: error instanceof PhoneHudError ? error.code : 'POLICYTEK_UNAVAILABLE' });
        board = { ok: false, now, error: signIn ? 'policytek_sign_in' : 'policytek_down' };
      }
      last = { board, at: now };
      return board;
  }
}

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...PRIVATE_HEADERS, ...extra } });
}

/**
 * The Queue page's poll. A POST from this app's own origin, like the recruiting reads, so another site can't make a
 * signed-in browser ask. `served` is this server's clock, which screens use to keep their timers in step.
 */
export async function handleQueueRequest(request, { getUser, authorizeUser = visitor => Boolean(visitor), allowedOrigin, readBoard, clock = Date.now }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this read.' } }, 405, { Allow: 'POST' });
  try {
    await request.body?.cancel();
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to open the queue.' }, signInPath: '/sign-in?return_to=%2Fqueue' }, 401);
    if (!authorizeUser(user)) return json({ error: { code: 'ACCESS_DENIED', message: 'This account does not have access to the queue.' } }, 403);
    if (!isAllowedOrigin(request, allowedOrigin)) return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Open this app directly to see the queue.' } }, 403);
    return json({ ...await readBoard(), served: clock() });
  } catch {
    return json({ ok: false, now: clock(), error: 'server', served: clock() }, 503);
  }
}
