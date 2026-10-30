import { PORTAL_ID, PIPELINE_ID, STAGES, RECRUIT_PROPERTIES, OFFICES, INTAKES, RECRUIT_TYPES, stageKeyForStageId } from './recruiting-config.mjs';
import { EDIT_FIELDS } from './recruit-edit-config.mjs';
import { RECRUITING_PATHS, LICENSE_ROUTES } from './recruiting-flow.mjs';

const SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/tickets/search';
const PAGE_SIZE = 100;
const PAGE_LIMIT = 10;
const OWNERS_URL = 'https://api.hubapi.com/crm/v3/owners/';
const OWNER_PAGE_LIMIT = 5;
// One credential-scoped cache only. Owner names never reach disk or public responses.
let ownerCache = null;
const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Cookie',
});

export class RecruitingError extends Error {
  constructor(code, message, status = 502, retryAfterSeconds = null) {
    super(message);
    this.name = 'RecruitingError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function invalidResponse() {
  return new RecruitingError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected response. Please try Refresh.', 502);
}

function text(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function enumLabel(value, labels) {
  const key = text(value).toLowerCase();
  return Object.hasOwn(labels, key) ? labels[key] : 'Not recorded';
}

function flag(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function timestamp(value, dateOnly = false) {
  if (value === undefined || value === null || value === '') return null;
  if (!['string', 'number'].includes(typeof value)) return null;
  const raw = String(value).trim();
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
  if (calendar) {
    const [, year, month, day] = calendar.map(Number);
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  } else if (!/^-?\d+$/.test(raw)) return null;
  const millis = /^-?\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return null;
  const iso = new Date(millis).toISOString();
  return dateOnly ? iso.slice(0, 10) : iso;
}

export function normalizeRecruit(record) {
  if (!record || typeof record !== 'object' || !/^[1-9]\d{0,19}$/.test(String(record.id ?? ''))) throw invalidResponse();
  const p = record.properties;
  if (!p || typeof p !== 'object' || p.hs_pipeline !== PIPELINE_ID) throw invalidResponse();
  const id = String(record.id);
  const stageId = text(p.hs_pipeline_stage, 30);
  const name = text(p.recruit_name) || text(p.subject).replace(/^Recruiting:\s*/i, '') || 'Unnamed recruit';
  const ownerId = /^[1-9]\d{0,19}$/.test(String(p.hubspot_owner_id ?? '')) ? String(p.hubspot_owner_id) : null;
  return {
    id, name,
    ownerId,
    recruiter: null,
    recruiterStatus: ownerId ? 'unavailable' : 'unassigned',
    office: enumLabel(p.orientation_office, OFFICES),
    intake: enumLabel(p.intake_license_status, INTAKES),
    recruitingPath: Object.hasOwn(RECRUITING_PATHS, p.recruiting_path) ? p.recruiting_path : '',
    licenseRoute: Object.hasOwn(LICENSE_ROUTES, p.licensing_branch) ? p.licensing_branch : '',
    stage: Object.hasOwn(STAGES, stageId) ? STAGES[stageId] : 'Unknown stage', stageId,
    stageKey: stageKeyForStageId(stageId) ?? '',
    enteredStageAt: timestamp(p.hs_v2_date_entered_current_stage),
    updatedAt: timestamp(p.hs_lastmodifieddate ?? record.updatedAt),
    createdAt: timestamp(p.createdate ?? record.createdAt),
    // Logged contact on this ticket; never substitute notes/tasks or last modified.
    lastContactedAt: timestamp(p.hs_lastcontacted),
    orientationDate: timestamp(p.orientation_date, true),
    recruitType: enumLabel(p.recruit_type, RECRUIT_TYPES),
    flags: {
      orientationRegistered: flag(p.orientation_registered),
      orientationCheckedIn: flag(p.orientation_checked_in),
      licensingStarted: flag(p.licensing_started),
      contractingRegistered: flag(p.contracting_registered),
      appointmentsCreated: flag(p.appointments_created),
    },
    editValues: Object.fromEntries(EDIT_FIELDS.map(field => [field.property,
      field.type === 'date' ? timestamp(p[field.property], true) ?? '' :
      p[field.property] === true ? 'true' : p[field.property] === false ? 'false' :
      text(p[field.property], field.maxLength ?? 200),
    ])),
    hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-5/${id}?utm_source=codex&utm_medium=ai_agent&utm_campaign=legacy_recruiting_live`,
  };
}

function retryDelay(value, now) {
  if (!value) return 60;
  if (/^\d+$/.test(value)) return Math.max(1, Math.min(86400, Number(value)));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.min(86400, Math.ceil((date - now) / 1000))) : 60;
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw invalidResponse(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalidResponse(); }
}

/** Optional owner lookup: missing scope, rate limits or bad owner data never hide tickets. */
export async function readRecruiterNames({ accessToken, fetchImpl = fetch, now = Date.now, timeoutMs = 4000 }) {
  const currentTime = now();
  if (ownerCache?.accessToken === accessToken && ownerCache.fetchImpl === fetchImpl && ownerCache.expiresAt > currentTime) return ownerCache.result;
  const names = new Map();
  const cursors = new Set();
  let after;
  let archived = false;
  let complete = false;
  try {
    for (let page = 0; page < OWNER_PAGE_LIMIT; page += 1) {
      const url = new URL(OWNERS_URL);
      url.searchParams.set('limit', '100');
      url.searchParams.set('archived', String(archived));
      if (after !== undefined) url.searchParams.set('after', after);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4000));
      let payload;
      try {
        const response = await fetchImpl(url.href, {
          method: 'GET', redirect: 'manual',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw invalidResponse();
        payload = await boundedJson(response);
      } finally { clearTimeout(timer); }
      if (!payload || !Array.isArray(payload.results) || payload.results.length > 100) throw invalidResponse();
      for (const owner of payload.results) {
        if (!owner || !/^[1-9]\d{0,19}$/.test(String(owner.id ?? ''))) throw invalidResponse();
        const label = [text(owner.firstName, 80), text(owner.lastName, 80)].filter(Boolean).join(' ');
        if (label) names.set(String(owner.id), label);
      }
      const cursor = payload.paging?.next?.after;
      if (cursor === undefined || cursor === null || cursor === '') {
        if (archived) { complete = true; break; }
        archived = true; after = undefined; continue;
      }
      after = String(cursor);
      const cursorKey = `${archived}:${after}`;
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(after) || cursors.has(cursorKey) || payload.results.length === 0) throw invalidResponse();
      cursors.add(cursorKey);
    }
  } catch {
    // A successful earlier page can still resolve its exact owner IDs honestly.
  }
  const result = { names, complete };
  ownerCache = { accessToken, fetchImpl, expiresAt: currentTime + (complete ? 300000 : 30000), result };
  return result;
}

/**
 * Fixed, scoped read. No caller-supplied endpoint, portal, pipeline, fields or filters.
 * @param {{ accessToken?: string, fetchImpl?: typeof fetch, now?: () => number, timeoutMs?: number }} options
 */
export async function readRecruitingData({ accessToken, fetchImpl = fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) {
    throw new RecruitingError('CONNECTION_NOT_CONFIGURED', 'The secure HubSpot connection has not been configured yet.', 503);
  }
  const recruits = new Map();
  const cursors = new Set();
  let after;
  let total = 0;
  let partial = false;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let payload;
    try {
      const response = await fetchImpl(SEARCH_URL, {
        // Workers does not implement redirect:'error'. Manual mode prevents the
        // bearer credential from following a redirect; non-2xx is rejected below.
        method: 'POST', redirect: 'manual',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }] }],
          properties: RECRUIT_PROPERTIES, limit: PAGE_SIZE,
          sorts: ['hs_object_id'], ...(after === undefined ? {} : { after }),
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new RecruitingError('HUBSPOT_ACCESS_REQUIRED', 'The HubSpot connection needs attention. Ask the app owner to check its read permissions.', 502);
      }
      if (response.status === 429) {
        throw new RecruitingError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before using Refresh again.', 429, retryDelay(response.headers.get('Retry-After'), now()));
      }
      if (!response.ok) throw new RecruitingError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this read. Please try Refresh later.', 502);
      payload = await boundedJson(response);
    } catch (error) {
      if (error instanceof RecruitingError) throw error;
      if (controller.signal.aborted) throw new RecruitingError('HUBSPOT_TIMEOUT', 'The HubSpot read took too long. Please try Refresh later.', 504);
      throw new RecruitingError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this read. Please try Refresh later.', 502);
    } finally { clearTimeout(timer); }
    if (!payload || !Array.isArray(payload.results) || payload.results.length > PAGE_SIZE
      || !Number.isSafeInteger(payload.total) || payload.total < 0) throw invalidResponse();
    total = payload.total;
    for (const record of payload.results) {
      const recruit = normalizeRecruit(record);
      recruits.set(recruit.id, recruit);
    }
    const cursor = payload.paging?.next?.after;
    if (cursor === undefined || cursor === null || cursor === '') { partial = recruits.size !== total; break; }
    after = String(cursor);
    if (!/^\d{1,20}$/.test(after) || cursors.has(after) || payload.results.length === 0) throw invalidResponse();
    cursors.add(after);
    if (page === PAGE_LIMIT - 1) partial = true;
  }
  const rows = [...recruits.values()];
  if (rows.some(recruit => recruit.ownerId)) {
    const owners = await readRecruiterNames({ accessToken, fetchImpl, now, timeoutMs });
    for (const recruit of rows) {
      if (!recruit.ownerId) continue;
      recruit.recruiter = owners.names.get(recruit.ownerId) ?? null;
      recruit.recruiterStatus = recruit.recruiter ? 'available' : owners.complete ? 'not-found' : 'unavailable';
    }
  }
  return { recruits: rows, total, loadedCount: recruits.size, partial, fetchedAt: new Date(now()).toISOString(), portalId: PORTAL_ID, pipelineId: PIPELINE_ID };
}

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...PRIVATE_HEADERS, ...extra } });
}

/** Separable handler keeps authorization, CSRF and failure behavior testable without a runtime. */
export function isAllowedOrigin(request, allowedOrigin) {
  if (typeof allowedOrigin !== 'string') return false;
  try {
    const origin = new URL(allowedOrigin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.origin !== allowedOrigin || (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))) return false;
    return request.headers.get('Origin') === allowedOrigin && new URL(request.url).origin === allowedOrigin;
  } catch { return false; }
}

export async function handleRecruitRequest(request, { getUser, readData, authorizeUser = visitor => Boolean(visitor), allowedOrigin }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this read.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to open the private recruiting workspace.' }, signInPath: '/sign-in' }, 401);
    if (!authorizeUser(user)) return json({ error: { code: 'ACCESS_DENIED', message: 'This account does not have access to the recruiting workspace.' } }, 403);
    if (!isAllowedOrigin(request, allowedOrigin)) {
      return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Open this app directly before using Refresh.' } }, 403);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
      return json({ error: { code: 'INVALID_REQUEST', message: 'Use a JSON request.' } }, 415);
    }
    const reader = request.body?.getReader();
    let body = '', size = 0;
    const decoder = new TextDecoder();
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return json({ error: { code: 'INVALID_REQUEST', message: 'The read request is too large.' } }, 413); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let input;
    try { input = JSON.parse(body); } catch { return json({ error: { code: 'INVALID_REQUEST', message: 'Use an empty JSON object for this read.' } }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
      return json({ error: { code: 'INVALID_REQUEST', message: 'This read does not accept custom filters or fields.' } }, 400);
    }
    return json(await readData());
  } catch (error) {
    const safe = error instanceof RecruitingError ? error : new RecruitingError('READ_FAILED', 'The recruiting data could not be loaded. Please try Refresh later.', 502);
    const retry = safe.retryAfterSeconds;
    return json({ error: { code: safe.code, message: safe.message }, ...(retry ? { retryAfterSeconds: retry } : {}) }, safe.status, retry ? { 'Retry-After': String(retry) } : {});
  }
}
