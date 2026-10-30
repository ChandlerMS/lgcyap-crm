import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const API = 'https://api.hubapi.com/conversations/v3/conversations/threads';
const PAGE_SIZE = 100, TOKEN_TTL = 30 * 60 * 1000;
const URL_ROOT = 'https://app.hubspot.com/live-messages/50894788';
const id = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const text = (value, limit = 250) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const timestamp = value => ['string', 'number'].includes(typeof value) && value !== '' && Number.isFinite(Date.parse(String(value))) ? new Date(value).toISOString() : null;
export class InboxError extends Error {
  constructor(code, message, status = 502, extras = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extras); }
}
const bad = message => new InboxError('INVALID_REQUEST', message ?? 'Use a valid Inbox request.', 400);
function digest(secret, purpose, value) { return createHmac('sha256', secret).update(`legacy-inbox:${purpose}:v1\0`).update(value).digest('base64url'); }

export function validateInboxInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['archive', 'threadId', 'continuation'].includes(key))) throw bad();
  const archive = input.archive ?? 'all';
  if (!['all', 'active', 'archived'].includes(archive)) throw bad('Choose All, Active or Archived conversations.');
  if (input.threadId !== undefined && (typeof input.threadId !== 'string' || !id(input.threadId))) throw bad('Choose a valid conversation.');
  if (input.continuation !== undefined && (typeof input.continuation !== 'string' || !input.continuation || input.continuation.length > 7400)) throw bad('Restart this Inbox read.');
  return { archive, ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.continuation ? { continuation: input.continuation } : {}) };
}

/** Decode provider-issued URL encoding once. Do not form-decode '+' or decode a saved cursor again. */
export function decodeInboxCursor(value) {
  if (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isSafeInteger(value)) throw new InboxError('CURSOR_TYPE_INVALID', 'HubSpot returned an unsupported pagination cursor.');
  let decoded;
  try { decoded = decodeURIComponent(String(value)); } catch { throw new InboxError('CURSOR_ENCODING_INVALID', 'HubSpot returned an invalid encoded pagination cursor.'); }
  if (!decoded || Buffer.byteLength(decoded) > 4096 || /[\u0000-\u001f\u007f]/.test(decoded)) throw new InboxError('CURSOR_INVALID', 'HubSpot returned an unsupported pagination cursor.');
  return decoded;
}

function sign(state, secret) {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  const token = `v1.${body}.${digest(secret, 'continuation', body)}`;
  if (token.length > 7400) throw new InboxError('CURSOR_TOO_LONG', 'HubSpot returned a pagination cursor that cannot be resumed safely.');
  return token;
}
function open(token, binding, secret, now) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^[a-zA-Z0-9_-]+$/.test(parts[1]) || !/^[a-zA-Z0-9_-]{43}$/.test(parts[2])) throw bad('Restart this Inbox read.');
  const signature = Buffer.from(parts[2], 'base64url'), expected = Buffer.from(digest(secret, 'continuation', parts[1]), 'base64url');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw bad('Restart this Inbox read.');
  let state; try { state = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw bad('Restart this Inbox read.'); }
  if (!state || state.v !== 1 || state.binding !== binding || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= now || !['active', 'archived'].includes(state.phase) || !Number.isSafeInteger(state.page) || state.page < 0 || !Array.isArray(state.history) || state.history.length > 8 || state.history.some(hash => typeof hash !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(hash)) || state.cursor !== null && (typeof state.cursor !== 'string' || Buffer.byteLength(state.cursor) > 4096 || /[\u0000-\u001f\u007f]/.test(state.cursor)) || typeof state.walkId !== 'string' || !/^[a-f0-9-]{36}$/.test(state.walkId)) throw bad('This Inbox read expired or changed. Restart it.');
  return state;
}

async function provider(url, { accessToken, fetchImpl, timeoutMs }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: controller.signal });
    if ([401, 403].includes(response.status)) throw new InboxError('HUBSPOT_ACCESS_REQUIRED', 'The HubSpot connection needs conversations-read access.', response.status, { providerStatus: response.status });
    if (response.status === 429) { const raw = response.headers.get('Retry-After'); throw new InboxError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting reads. Wait, then Resume.', 429, { providerStatus: 429, retryAfterSeconds: /^\d{1,6}$/.test(raw ?? '') ? Math.max(1, Math.min(86400, Number(raw))) : 60 }); }
    if (!response.ok) throw new InboxError('HUBSPOT_UNAVAILABLE', `HubSpot rejected this read (HTTP ${response.status}). Resume to try again.`, 502, { providerStatus: response.status });
    const reader = response.body?.getReader(); if (!reader) throw new InboxError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an empty response.');
    const chunks = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new InboxError('HUBSPOT_RESPONSE_TOO_LARGE', 'This HubSpot page exceeds the safe 2 MB limit. The read is incomplete.'); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InboxError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned invalid JSON.'); }
  } catch (error) { if (error instanceof InboxError) throw error; throw new InboxError(controller.signal.aborted ? 'HUBSPOT_TIMEOUT' : 'HUBSPOT_UNAVAILABLE', 'HubSpot could not finish this read. Resume to try again.'); }
  finally { clearTimeout(timer); }
}

function threadRecord(record) {
  const recordId = id(record?.id); if (!recordId) throw new InboxError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an invalid conversation identifier.');
  return { id: recordId, title: `Conversation ${recordId}`, subtitle: id(record.inboxId) ? `Inbox ${record.inboxId}` : null, status: text(record.status).toLowerCase().replace(/^./, c => c.toUpperCase()) || null, owner: null, ownerId: null, createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.latestMessageTimestamp), scheduledAt: null, endedAt: null, phone: null, email: null, company: null, health: null, preview: null, archived: record.archived === true, hubspotUrl: URL_ROOT };
}
function messageRecord(record) {
  if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 200) throw new InboxError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an invalid message identifier.');
  return { id: record.id, text: typeof record.text === 'string' ? record.text : null, createdAt: timestamp(record.createdAt), direction: text(record.direction, 80).toLowerCase().replace(/^./, c => c.toUpperCase()) || null, type: text(record.type, 80).toLowerCase().replace(/^./, c => c.toUpperCase()) || null, truncated: Boolean(record.truncationStatus && record.truncationStatus !== 'NOT_TRUNCATED') };
}

/** One bounded provider page per authenticated request; signed continuations remove the old total cap.
 * @param {{archive?:string,threadId?:string,continuation?:string}} input
 * @param {{userId:string,hmacSecret?:string,accessToken?:string,fetchImpl?:typeof fetch,now?:()=>number,timeoutMs?:number}} options
 */
export async function readInboxPage(input = {}, { userId, hmacSecret, accessToken, fetchImpl = fetch, now = Date.now, timeoutMs = 10000 }) {
  const selected = validateInboxInput(input), time = now();
  if (typeof userId !== 'string' || !userId || userId.length > 200 || typeof hmacSecret !== 'string' || hmacSecret.length < 32 || typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 4096 || /[\r\n]/.test(accessToken)) throw new InboxError('CONNECTION_NOT_CONFIGURED', 'The secure Inbox connection is unavailable.', 503);
  const binding = digest(hmacSecret, 'binding', JSON.stringify({ userId, portal: '50894788', app: '59264745', archive: selected.archive, thread: selected.threadId ?? null, credential: digest(hmacSecret, 'credential', accessToken) }));
  const state = selected.continuation ? open(selected.continuation, binding, hmacSecret, time) : { v: 1, binding, phase: selected.archive === 'archived' ? 'archived' : 'active', cursor: null, history: [], page: 0, walkId: randomUUID(), expiresAt: time + TOKEN_TTL };
  const result = { tool: 'inbox', label: 'Inbox', status: 'available', source: 'HubSpot', readOnly: true, capabilities: { canEdit: false }, archive: selected.archive, phase: state.phase, walkId: state.walkId, page: state.page + 1, records: [], ...(selected.threadId ? { selectedThreadId: selected.threadId, messages: [] } : {}), total: null, loadedCount: 0, partial: true, complete: false, continuation: null, fetchedAt: new Date(time).toISOString(), hubspotUrl: URL_ROOT, requiredScopes: ['conversations.read'], notice: selected.threadId ? 'Plain-text HubSpot message history. HubSpot-truncated bodies remain marked; replies and attachments are not sent here.' : 'HubSpot conversations, including active and archived when All is selected. Counts cover loaded records; this read is not an atomic snapshot.' };
  const url = new URL(selected.threadId ? `${API}/${selected.threadId}/messages` : API);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('archived', String(state.phase === 'archived'));
  if (!selected.threadId) url.searchParams.set('sort', 'id');
  if (state.cursor !== null) url.searchParams.set('after', state.cursor);
  try {
    const payload = await provider(url.href, { accessToken, fetchImpl, timeoutMs });
    if (!payload || !Array.isArray(payload.results) || payload.results.length > PAGE_SIZE) throw new InboxError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected page.');
    const values = [...new Map(payload.results.map(record => { const value = selected.threadId ? messageRecord(record) : threadRecord(record); return [value.id, value]; })).values()];
    if (selected.threadId) result.messages = values; else result.records = values;
    result.loadedCount = values.length;
    const rawCursor = payload.paging?.next?.after;
    if (rawCursor === undefined || rawCursor === null || rawCursor === '') {
      if (selected.archive === 'all' && state.phase === 'active') result.continuation = sign({ ...state, phase: 'archived', cursor: null, history: [], page: state.page + 1, expiresAt: time + TOKEN_TTL }, hmacSecret);
      else { result.complete = true; result.partial = false; }
      return result;
    }
    let cursor;
    try {
      cursor = decodeInboxCursor(rawCursor);
      const hash = digest(hmacSecret, 'cursor', cursor);
      if (cursor === state.cursor || state.history.includes(hash)) throw new InboxError('CURSOR_REPEATED', 'HubSpot repeated its next-page cursor. Loaded data is preserved, but completeness is unconfirmed.');
      result.continuation = sign({ ...state, cursor, history: [...state.history, hash].slice(-8), page: state.page + 1, expiresAt: time + TOKEN_TTL }, hmacSecret);
    } catch (error) {
      result.paginationWarning = { code: error instanceof InboxError ? error.code : 'CURSOR_INVALID', message: error instanceof InboxError ? error.message : 'HubSpot pagination could not continue safely.' };
      result.notice += ' Pagination is blocked; loaded data is incomplete.';
      if (process.env.NODE_ENV === 'production') console.warn('hubspot_inbox_pagination_blocked', { code: result.paginationWarning.code, page: state.page + 1, resultsCount: payload.results.length, cursorContainsPercentEncoding: typeof rawCursor === 'string' && /%[a-f0-9]{2}/i.test(rawCursor), encodedSequenceCount: typeof rawCursor === 'string' ? (rawCursor.match(/%[a-f0-9]{2}/gi)?.length ?? 0) : 0 });
    }
    return result;
  } catch (error) {
    const safe = error instanceof InboxError ? error : new InboxError('HUBSPOT_UNAVAILABLE', 'HubSpot could not finish this read.');
    return { ...result, status: safe.code === 'HUBSPOT_ACCESS_REQUIRED' ? 'permission-required' : 'unavailable', continuation: sign({ ...state, expiresAt: time + TOKEN_TTL }, hmacSecret), error: { code: safe.code, message: safe.message, ...(safe.providerStatus ? { providerStatus: safe.providerStatus } : {}) }, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) };
  }
}
