import { PORTAL_ID, STAGES } from './recruiting-config.mjs';
import { isAllowedOrigin, readRecruiterNames } from './hubspot.mjs';

const BASE = 'https://api.hubapi.com';
const LIMIT = 100;
const PAGE_LIMIT = 5;
let pipelineCache = null;
const CSM_SENTIMENTS = Object.freeze({ at_risk: 'At-Risk', neutral: 'Neutral', healthy: 'Healthy' });
const common = ['hubspot_owner_id', 'hs_createdate', 'hs_lastmodifieddate'];
const meetingFields = [...common, 'hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_meeting_location', 'hs_meeting_outcome', 'hs_timestamp'];
export const HUBSPOT_TOOL_CONFIG = Object.freeze({
  'customer-success': { label: 'Customer Success', object: 'companies', objectId: '0-2', scopes: ['crm.objects.companies.read'], fields: ['name', 'domain', 'phone', 'city', 'hubspot_owner_id', 'hs_current_customer', 'hs_csm_sentiment', 'hs_next_renewal_date', 'createdate', 'hs_lastmodifieddate'], filters: [{ propertyName: 'hs_current_customer', operator: 'EQ', value: 'yes' }], url: `/customer-success/${PORTAL_ID}`, notice: 'Current customer companies and recorded CSM sentiment. HubSpot health scores and workspace automation are not reproduced.' },
  inbox: { label: 'Inbox', scopes: ['conversations.read'], url: `/live-messages/${PORTAL_ID}`, notice: 'Conversation threads in HubSpot ID order and plain-text messages. Sending replies and attachments is not enabled.' },
  tickets: { label: 'Tickets', object: 'tickets', objectId: '0-5', scopes: ['crm.objects.tickets.read'], fields: ['subject', 'hs_ticket_priority', 'hs_pipeline', 'hs_pipeline_stage', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate'], notice: 'Tickets across HubSpot pipelines. Editing recruiting records remains available in Pipeline.' },
  calls: { label: 'Calls', object: 'calls', objectId: '0-48', scopes: ['crm.objects.contacts.read'], fields: [...common, 'hs_call_title', 'hs_call_status', 'hs_call_direction', 'hs_call_duration', 'hs_call_to_number', 'hs_call_from_number', 'hs_timestamp'], notice: 'Logged HubSpot call records. Start calls using the recruit calling buttons.' },
  contacts: { label: 'Contacts', object: 'contacts', objectId: '0-1', scopes: ['crm.objects.contacts.read'], fields: ['firstname', 'lastname', 'email', 'phone', 'company', 'lifecyclestage', 'hubspot_owner_id', 'createdate', 'lastmodifieddate'], notice: 'HubSpot contact records. New recruiting contacts can be added through Add Recruits.' },
  tasks: { label: 'Tasks', object: 'tasks', objectId: '0-27', scopes: ['crm.objects.contacts.read'], fields: [...common, 'hs_task_subject', 'hs_task_status', 'hs_task_priority', 'hs_task_type', 'hs_timestamp'], notice: 'Logged HubSpot tasks and due dates. Completing or creating tasks is not enabled here.' },
  calendar: { label: 'Calendar', object: 'meetings', objectId: '0-47', scopes: ['crm.objects.contacts.read'], fields: meetingFields, sort: 'hs_meeting_start_time', url: `/calendar/${PORTAL_ID}`, notice: 'HubSpot CRM meetings only. This is not the marketing campaign calendar or a complete Google Calendar sync.' },
  meetings: { label: 'Meetings', object: 'meetings', objectId: '0-47', scopes: ['crm.objects.contacts.read'], fields: meetingFields, sort: 'hs_meeting_start_time', notice: 'HubSpot CRM meeting records. Booking links, availability rules and scheduling are managed in HubSpot.' },
});

const PRIVATE_HEADERS = Object.freeze({ 'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Cookie' });
class ToolError extends Error {
  constructor(code, message, status = 502, retryAfterSeconds = null) { super(message); this.code = code; this.status = status; this.retryAfterSeconds = retryAfterSeconds; }
}
const invalid = () => new ToolError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected response. Use Refresh to try again.');
const safeText = (value, max = 250) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const recordId = value => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : null;
function date(value) {
  if (!['string', 'number'].includes(typeof value) || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw) && !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) return null;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (calendar) {
    const [, year, month, day] = calendar.map(Number);
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  }
  const millis = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? new Date(millis).toISOString() : null;
}
const label = value => safeText(value, 100).toLowerCase().replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()) || null;
function nativeUrl(config, id) { return `https://app.hubspot.com/contacts/${PORTAL_ID}/record/${config.objectId}/${id}?utm_source=codex&utm_medium=ai_agent&utm_campaign=legacy_crm_workspace`; }
function toolUrl(config) { return `https://app.hubspot.com${config.url ?? `/contacts/${PORTAL_ID}/objects/${config.objectId}`}?utm_source=codex&utm_medium=ai_agent&utm_campaign=legacy_crm_workspace`; }

function normalizeCrm(tool, record, config) {
  const id = recordId(record?.id), p = record?.properties;
  if (!id || !p || typeof p !== 'object' || Array.isArray(p)) throw invalid();
  const row = { id, title: '', subtitle: null, status: null, owner: null, ownerId: recordId(p.hubspot_owner_id), createdAt: date(p.createdate ?? p.hs_createdate ?? record.createdAt), updatedAt: date(p.lastmodifieddate ?? p.hs_lastmodifieddate ?? record.updatedAt), scheduledAt: null, endedAt: null, phone: null, email: null, company: null, health: null, preview: null, hubspotUrl: nativeUrl(config, id) };
  if (tool === 'contacts') {
    row.title = [safeText(p.firstname, 100), safeText(p.lastname, 100)].filter(Boolean).join(' ') || safeText(p.email) || 'Unnamed contact';
    row.email = safeText(p.email) || null; row.phone = safeText(p.phone, 80) || null; row.company = safeText(p.company) || null; row.status = label(p.lifecyclestage);
  } else if (tool === 'customer-success') {
    if (p.hs_current_customer !== 'yes') throw invalid();
    row.title = safeText(p.name) || 'Unnamed company'; row.subtitle = safeText(p.domain) || null;
    row.phone = safeText(p.phone, 80) || null; row.company = row.title; row.health = Object.hasOwn(CSM_SENTIMENTS, p.hs_csm_sentiment) ? CSM_SENTIMENTS[p.hs_csm_sentiment] : null; row.status = 'Current customer'; row.scheduledAt = date(p.hs_next_renewal_date);
  } else if (tool === 'tickets') {
    row.title = safeText(p.subject) || 'Untitled ticket';
    row.status = Object.hasOwn(STAGES, p.hs_pipeline_stage) ? STAGES[p.hs_pipeline_stage] : p.hs_pipeline_stage ? `Stage ${safeText(p.hs_pipeline_stage, 50)}` : null;
    row.subtitle = label(p.hs_ticket_priority);
  } else if (tool === 'calls') {
    row.title = safeText(p.hs_call_title) || 'Untitled call'; row.status = label(p.hs_call_status); row.phone = safeText(p.hs_call_direction === 'INBOUND' ? p.hs_call_from_number : p.hs_call_to_number, 80) || null; row.scheduledAt = date(p.hs_timestamp);
    const duration = Number(p.hs_call_duration), parts = [label(p.hs_call_direction)];
    if (p.hs_call_duration !== null && p.hs_call_duration !== undefined && p.hs_call_duration !== '' && Number.isFinite(duration) && duration >= 0) parts.push(`${Math.floor(duration / 60000)}m ${Math.floor(duration / 1000) % 60}s`);
    row.subtitle = parts.filter(Boolean).join(' · ') || null;
  } else if (tool === 'tasks') {
    row.title = safeText(p.hs_task_subject) || 'Untitled task'; row.status = label(p.hs_task_status); row.scheduledAt = date(p.hs_timestamp); row.subtitle = [label(p.hs_task_priority), label(p.hs_task_type)].filter(Boolean).join(' · ') || null;
  } else {
    row.title = safeText(p.hs_meeting_title) || 'Untitled meeting'; row.status = label(p.hs_meeting_outcome); row.subtitle = safeText(p.hs_meeting_location) || null;
    row.scheduledAt = date(p.hs_meeting_start_time ?? p.hs_timestamp); row.endedAt = date(p.hs_meeting_end_time);
  }
  return row;
}

async function providerJson(url, { accessToken, fetchImpl, timeoutMs, method = 'GET', body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method, redirect: 'manual', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new ToolError('HUBSPOT_ACCESS_REQUIRED', 'The HubSpot connection needs the read permissions listed below. An account subscription or seat may also restrict this tool.', response.status);
    if (response.status === 429) {
      const value = response.headers.get('Retry-After');
      const retry = /^\d{1,6}$/.test(value ?? '') ? Math.max(1, Math.min(86400, Number(value))) : 60;
      throw new ToolError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before using Refresh again.', 429, retry);
    }
    if (!response.ok) throw new ToolError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this read. Use Refresh to try again.');
    const reader = response.body?.getReader();
    if (!reader) throw invalid();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw invalid(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid(); }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(controller.signal.aborted ? 'HUBSPOT_TIMEOUT' : 'HUBSPOT_UNAVAILABLE', controller.signal.aborted ? 'The HubSpot read took too long. Use Refresh to try again.' : 'HubSpot could not complete this read. Use Refresh to try again.');
  } finally { clearTimeout(timer); }
}

async function ticketStageLabels(options, now) {
  const currentTime = now();
  if (pipelineCache?.accessToken === options.accessToken && pipelineCache.fetchImpl === options.fetchImpl && pipelineCache.expiresAt > currentTime) return pipelineCache.labels;
  const labels = new Map(); let complete = false;
  try {
    const payload = await providerJson(`${BASE}/crm/v3/pipelines/tickets`, { ...options, timeoutMs: Math.min(options.timeoutMs, 2000) });
    if (!payload || !Array.isArray(payload.results) || payload.results.length > 1000) throw invalid();
    for (const pipeline of payload.results) {
      const id = safeText(pipeline?.id, 100);
      if (!id || !Array.isArray(pipeline.stages) || pipeline.stages.length > 100) throw invalid();
      for (const stage of pipeline.stages) {
        const stageId = safeText(stage?.id, 100), stageLabel = safeText(stage?.label, 250);
        if (stageId && stageLabel) labels.set(`${id}:${stageId}`, stageLabel);
      }
    }
    complete = true;
  } catch { /* The ticket list remains usable when optional schema metadata is unavailable. */ }
  pipelineCache = { accessToken: options.accessToken, fetchImpl: options.fetchImpl, expiresAt: currentTime + (complete ? 300000 : 30000), labels };
  return labels;
}

function cursorFor(payload, seen) {
  const cursor = payload.paging?.next?.after;
  if (cursor === undefined || cursor === null || cursor === '') return null;
  const after = String(cursor);
  if (!/^[A-Za-z0-9_=-]{1,200}$/.test(after) || seen.has(after)) throw invalid();
  seen.add(after); return after;
}

export function validateToolInput(tool, input) {
  if (!Object.hasOwn(HUBSPOT_TOOL_CONFIG, tool)) throw new ToolError('UNKNOWN_TOOL', 'This workspace page is not available.', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolError('INVALID_REQUEST', 'Use an empty JSON object for this read.', 400);
  if (Object.keys(input).length === 0) return {};
  if (tool === 'inbox' && Object.keys(input).length === 1 && Object.hasOwn(input, 'threadId') && typeof input.threadId === 'string' && recordId(input.threadId)) return { threadId: input.threadId };
  throw new ToolError('INVALID_REQUEST', 'This read does not accept custom filters, properties or endpoints.', 400);
}

/** Fixed provider requests only; the caller cannot choose object types, scopes or properties.
 * @param {string} tool
 * @param {{threadId?: string}} input
 * @param {{accessToken?: string, fetchImpl?: typeof fetch, now?: () => number, timeoutMs?: number}} options
 */
export async function readHubSpotTool(tool, input = {}, { accessToken, fetchImpl = fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const selected = validateToolInput(tool, input), config = HUBSPOT_TOOL_CONFIG[tool];
  const result = { tool, label: config.label, status: 'available', source: 'HubSpot', readOnly: true, records: [], total: null, loadedCount: 0, partial: false, fetchedAt: new Date(now()).toISOString(), hubspotUrl: toolUrl(config), requiredScopes: [...config.scopes], notice: config.notice, ...(selected.threadId ? { selectedThreadId: selected.threadId, messages: [] } : {}) };
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 4096 || /[\r\n]/.test(accessToken)) return { ...result, status: 'unavailable', error: { code: 'CONNECTION_NOT_CONFIGURED', message: 'The secure HubSpot connection has not been configured.' } };
  const seen = new Set(), rows = new Map(), stageKeys = new Map(); let after, messageBytes = 0;
  const deadline = performance.now() + 30000;
  const remaining = () => Math.max(0, deadline - performance.now());
  try {
    pages:
    for (let page = 0; page < PAGE_LIMIT; page++) {
      if (page > 0 && tool !== 'inbox') await new Promise(resolve => setTimeout(resolve, 220));
      if (remaining() < 1) { result.partial = true; break; }
      let url, body;
      if (tool === 'inbox') {
        url = new URL(`${BASE}/conversations/v3/conversations/threads${selected.threadId ? `/${selected.threadId}/messages` : ''}`);
        url.searchParams.set('limit', String(LIMIT));
        if (!selected.threadId) { url.searchParams.set('archived', 'false'); url.searchParams.set('sort', 'id'); }
        if (after !== undefined) url.searchParams.set('after', after);
      } else {
        url = new URL(`${BASE}/crm/v3/objects/${config.object}/search`);
        body = { properties: config.fields, limit: LIMIT, sorts: [{ propertyName: config.sort ?? 'hs_object_id', direction: 'DESCENDING' }], ...(config.filters ? { filterGroups: [{ filters: config.filters }] } : {}), ...(after === undefined ? {} : { after }) };
      }
      const payload = await providerJson(url.href, { accessToken, fetchImpl, timeoutMs: Math.min(timeoutMs, remaining()), ...(body ? { method: 'POST', body } : {}) });
      if (!payload || !Array.isArray(payload.results) || payload.results.length > LIMIT) throw invalid();
      if (tool !== 'inbox') { if (!Number.isSafeInteger(payload.total) || payload.total < 0) throw invalid(); result.total = payload.total; }
      for (const record of payload.results) {
        if (tool !== 'inbox') { const row = normalizeCrm(tool, record, config); rows.set(row.id, row); if (tool === 'tickets') stageKeys.set(row.id, `${safeText(record.properties.hs_pipeline, 100)}:${safeText(record.properties.hs_pipeline_stage, 100)}`); }
        else if (selected.threadId) {
          const id = safeText(record?.id, 200); if (!id || !record || typeof record !== 'object') throw invalid();
          const message = { id, text: typeof record.text === 'string' ? record.text.slice(0, 20000) : null, createdAt: date(record.createdAt), direction: label(record.direction), type: label(record.type), truncated: typeof record.text === 'string' && record.text.length > 20000 || Boolean(record.truncationStatus && record.truncationStatus !== 'NOT_TRUNCATED') };
          const previous = rows.get(id);
          const nextBytes = messageBytes - (previous ? new TextEncoder().encode(JSON.stringify(previous)).byteLength : 0) + new TextEncoder().encode(JSON.stringify(message)).byteLength;
          if (nextBytes > 2 * 1024 * 1024) { result.partial = true; break pages; }
          rows.set(id, message); messageBytes = nextBytes;
        } else {
          const id = recordId(record?.id); if (!id) throw invalid();
          rows.set(id, { id, title: `Conversation ${id}`, subtitle: recordId(record.inboxId) ? `Inbox ${record.inboxId}` : null, status: label(record.status), owner: null, ownerId: null, createdAt: date(record.createdAt), updatedAt: date(record.latestMessageTimestamp), scheduledAt: null, endedAt: null, phone: null, email: null, company: null, health: null, preview: null, hubspotUrl: toolUrl(config) });
        }
      }
      const cursor = cursorFor(payload, seen);
      if (!cursor) { result.partial = result.total !== null && result.total !== rows.size; if (result.total === null) result.total = rows.size; break; }
      if (!payload.results.length) throw invalid();
      after = cursor;
      if (page === PAGE_LIMIT - 1) result.partial = true;
    }
    const records = [...rows.values()];
    if (selected.threadId) result.messages = records;
    else {
      if (tool === 'tickets' && records.some(record => record.status?.startsWith('Stage ')) && remaining() >= 1) {
        const labels = await ticketStageLabels({ accessToken, fetchImpl, timeoutMs: Math.min(timeoutMs, remaining()) }, now);
        for (const record of records) record.status = labels.get(stageKeys.get(record.id)) ?? record.status;
        if (records.some(record => record.status?.startsWith('Stage '))) result.notice += ' Some stage labels are unavailable; their HubSpot IDs are shown.';
      }
      if (records.some(record => record.ownerId) && remaining() >= 5) {
        const owners = await readRecruiterNames({ accessToken, fetchImpl, now, timeoutMs: Math.min(timeoutMs, 2000, Math.floor(remaining() / 5)) });
        for (const record of records) if (record.ownerId) record.owner = owners.names.get(record.ownerId) ?? null;
      }
      result.records = records;
    }
    result.loadedCount = records.length;
    if (result.partial) result.notice += ' Showing a limited set of loaded records. Local search and date filters apply to those records only.';
    return result;
  } catch (error) {
    const safe = error instanceof ToolError ? error : new ToolError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this read.');
    return { ...result, status: safe.code === 'HUBSPOT_ACCESS_REQUIRED' ? 'permission-required' : 'unavailable', records: [], total: null, loadedCount: 0, partial: false, ...(selected.threadId ? { messages: [] } : {}), error: { code: safe.code, message: safe.message }, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) };
  }
}

function json(value, status = 200, extra = {}) { return new Response(JSON.stringify(value), { status, headers: { ...PRIVATE_HEADERS, ...extra } }); }
/**
 * @param {Request} request
 * @param {string} tool
 * @param {{getUser: () => unknown | Promise<unknown>, authorizeUser?: (user: unknown) => boolean, allowedOrigin?: string, readData: (tool: string, input: {threadId?: string}) => Promise<unknown>}} options
 */
export async function handleHubSpotToolRequest(request, tool, { getUser, authorizeUser = () => false, allowedOrigin, readData }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this read.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to open this workspace.' }, signInPath: '/sign-in' }, 401);
    if (!authorizeUser(user)) return json({ error: { code: 'ACCESS_DENIED', message: 'This account does not have access to this workspace.' } }, 403);
    if (!isAllowedOrigin(request, allowedOrigin)) return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Open this app directly before using Refresh.' } }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return json({ error: { code: 'INVALID_REQUEST', message: 'Use a JSON request.' } }, 415);
    const reader = request.body?.getReader(); let size = 0, body = ''; const decoder = new TextDecoder();
    if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024) { await reader.cancel(); return json({ error: { code: 'INVALID_REQUEST', message: 'The read request is too large.' } }, 413); } body += decoder.decode(value, { stream: true }); }
    body += decoder.decode();
    let input; try { input = JSON.parse(body); } catch { return json({ error: { code: 'INVALID_REQUEST', message: 'Use a JSON object for this read.' } }, 400); }
    const validated = validateToolInput(tool, input);
    const result = await readData(tool, validated);
    return json(result, 200, result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : {});
  } catch (error) {
    const safe = error instanceof ToolError ? error : new ToolError('READ_FAILED', 'The workspace could not be loaded. Use Refresh to try again.');
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
