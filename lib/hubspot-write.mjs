import { normalizeRecruit } from './hubspot.mjs';
import { PIPELINE_ID, RECRUIT_PROPERTIES } from './recruiting-config.mjs';
import { EDIT_FIELDS } from './recruit-edit-config.mjs';

const API_ORIGIN = 'https://api.hubapi.com';
const HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie',
});
const fields = new Map(EDIT_FIELDS.map(field => [field.property, field]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const uncertainMessage = 'The save outcome is uncertain. Refresh and check the record in HubSpot before saving again.';

export class WriteError extends Error {
  constructor(code, message, status = 400, { uncertain = false, retryAfterSeconds = null } = {}) {
    super(message); this.name = 'WriteError'; this.code = code; this.status = status;
    this.uncertain = uncertain; this.retryAfterSeconds = retryAfterSeconds;
  }
}

function uncertain() { return new WriteError('SAVE_UNCERTAIN', uncertainMessage, 502, { uncertain: true }); }
function unavailable() { return new WriteError('SAVE_UNAVAILABLE', 'Saving is unavailable right now. Refresh before trying again.', 503); }
function invalid(message = 'The edit request is invalid.') { return new WriteError('INVALID_EDIT', message, 400); }
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

export function editorAllowed(user, editorEmails) {
  if (!user || typeof user.userId !== 'string' || !user.userId || typeof user.email !== 'string') return false;
  const allowed = typeof editorEmails === 'string' ? editorEmails.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) : [];
  return allowed.includes(user.email.trim().toLowerCase());
}

export function writeCapability(user, { editorEmails, writesEnabled, db } = {}) {
  return writesEnabled === 'true' && typeof db?.prepare === 'function' && editorAllowed(user, editorEmails);
}

export function validateWriteInput(id, input) {
  if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) throw invalid('Choose a valid recruiting record.');
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['expectedUpdatedAt', 'expectedValues', 'requestId', 'changes'].includes(key))) throw invalid();
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw invalid('Start a new edit before saving.');
  if (typeof input.expectedUpdatedAt !== 'string' || !ISO.test(input.expectedUpdatedAt)
    || !Number.isFinite(Date.parse(input.expectedUpdatedAt))
    || new Date(input.expectedUpdatedAt).toISOString() !== input.expectedUpdatedAt) throw invalid('Refresh the record before editing.');
  if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)) throw invalid();
  const entries = Object.entries(input.changes);
  if (!entries.length || entries.length > EDIT_FIELDS.length) throw invalid('Change at least one supported field.');
  if (!input.expectedValues || typeof input.expectedValues !== 'object' || Array.isArray(input.expectedValues)
    || Object.keys(input.expectedValues).length !== entries.length
    || Object.keys(input.expectedValues).some(key => !Object.hasOwn(input.changes, key))) throw invalid('Refresh the record before reviewing these changes.');
  const changes = {};
  const expectedValues = {};
  for (const [key, raw] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    const field = fields.get(key);
    if (!field || typeof raw !== 'string') throw invalid('Only supported recruiting fields can be edited.');
    if (!Object.hasOwn(input.expectedValues, key) || typeof input.expectedValues[key] !== 'string' || input.expectedValues[key].length > 200) throw invalid('Refresh the record before reviewing these changes.');
    let value = raw;
    if (field.type === 'text') {
      value = raw.trim();
      if (!value || value.length > field.maxLength || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(`Enter a valid ${field.label.toLowerCase()} (up to ${field.maxLength} characters).`);
    } else if (field.type === 'date') {
      if (value !== '' && !validDate(value)) throw invalid('Choose a real orientation date.');
    } else if (!field.options.some(option => option.value === value)) throw invalid(`Choose a valid ${field.label.toLowerCase()}.`);
    changes[key] = value;
    expectedValues[key] = input.expectedValues[key];
  }
  return { id, requestId: input.requestId.toLowerCase(), expectedUpdatedAt: input.expectedUpdatedAt, expectedValues, changes };
}

async function payloadHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** D1 stores request metadata and hashes only; schema is owned by migrations. */
export function createD1Ledger(db) {
  return {
    async claim({ userId, requestId, ticketId, hash, now }) {
      await db.prepare("UPDATE recruit_write_requests SET status = 'uncertain', updated_at = ? WHERE status = 'pending' AND updated_at < ?")
        .bind(now, now - 120000).run();
      const inserted = await db.prepare("INSERT OR IGNORE INTO recruit_write_requests (user_id, request_id, ticket_id, payload_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
        .bind(userId, requestId, ticketId, hash, now, now).run();
      if (inserted.meta?.changes === 1) return { acquired: true };
      const existing = await db.prepare('SELECT payload_hash, status FROM recruit_write_requests WHERE user_id = ? AND request_id = ?')
        .bind(userId, requestId).first();
      return existing ? { acquired: false, hash: existing.payload_hash, status: existing.status } : { acquired: false, status: 'busy' };
    },
    async finish({ userId, requestId, hash, status, now }) {
      const result = await db.prepare("UPDATE recruit_write_requests SET status = ?, updated_at = ? WHERE user_id = ? AND request_id = ? AND payload_hash = ? AND status = 'pending'")
        .bind(status, now, userId, requestId, hash).run();
      return result.meta?.changes === 1;
    },
  };
}

function retrySeconds(value, now) {
  if (/^\d+$/.test(value ?? '')) return Math.max(1, Math.min(86400, Number(value)));
  const date = Date.parse(value ?? '');
  return Number.isFinite(date) ? Math.max(1, Math.min(86400, Math.ceil((date - now) / 1000))) : 60;
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 512 * 1024) { await reader.cancel(); throw invalid(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid(); }
}

function canonical(property, value) {
  if (value === null || value === undefined || value === '') return '';
  if (property === 'orientation_date') {
    if (typeof value === 'string' && validDate(value)) return value;
    const date = new Date(/^\d+$/.test(String(value)) ? Number(value) : value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value);
  }
  return String(value);
}

function scopedRecord(raw, id) {
  if (!raw || String(raw.id) !== id || raw.archived || !raw.properties || raw.properties.hs_pipeline !== PIPELINE_ID) {
    throw new WriteError('RECORD_NOT_FOUND', 'This recruiting record is unavailable or outside the Recruiting pipeline.', 404);
  }
  try { return { raw, recruit: normalizeRecruit(raw) }; } catch { throw new WriteError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected recruiting record. Refresh before saving.', 502); }
}

/** No provider retry or redirect following is permitted in the mutation path. */
async function providerCall({ id, accessToken, method, changes, phase, fetchImpl, timeoutMs, now }) {
  const url = new URL(`/crm/v3/objects/tickets/${id}`, API_ORIGIN);
  if (method === 'GET') url.searchParams.set('properties', RECRUIT_PROPERTIES.join(','));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.href, {
      method, redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(method === 'PATCH' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'PATCH' ? { body: JSON.stringify({ properties: changes }) } : {}),
    });
    if (!response.ok) {
      if (phase === 'after' || (phase === 'patch' && ![400, 401, 403, 404, 429].includes(response.status))) throw uncertain();
      if (response.status === 429) throw new WriteError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait, then refresh before saving again.', 429, { retryAfterSeconds: retrySeconds(response.headers.get('Retry-After'), now()) });
      if (response.status === 401 || response.status === 403) throw new WriteError('HUBSPOT_WRITE_ACCESS_REQUIRED', 'HubSpot has not allowed this save. Ask the app owner to check its ticket write permission.', 403);
      if (response.status === 404) throw new WriteError('RECORD_NOT_FOUND', 'This recruiting record is no longer available.', 404);
      if (response.status === 400) throw new WriteError('HUBSPOT_REJECTED_EDIT', 'HubSpot did not accept these field values. Refresh and review the edit.', 400);
      throw new WriteError('HUBSPOT_UNAVAILABLE', 'HubSpot could not read this record. Refresh before saving again.', 502);
    }
    try { return await readJson(response); } catch { if (phase !== 'before') throw uncertain(); throw new WriteError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected response. Refresh before saving.', 502); }
  } catch (error) {
    if (error instanceof WriteError) throw error;
    if (phase !== 'before') throw uncertain();
    throw new WriteError(controller.signal.aborted ? 'HUBSPOT_TIMEOUT' : 'HUBSPOT_UNAVAILABLE', 'HubSpot could not read this record. Refresh before saving again.', controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); }
}

/**
 * Uses a fresh read to detect prior changes; HubSpot's PATCH is not an atomic compare-and-swap.
 * @param {{id:string,requestId:string,expectedUpdatedAt:string,expectedValues:Record<string,string>,changes:Record<string,string>}} input
 * @param {{userId:string,accessToken?:string,ledger:{claim:(value:any)=>Promise<any>,finish:(value:any)=>Promise<boolean>},fetchImpl?:typeof fetch,now?:()=>number,timeoutMs?:number}} options
 */
export async function saveRecruit(input, { userId, accessToken, ledger, fetchImpl = fetch, now = Date.now, timeoutMs = 12000 }) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) throw unavailable();
  const hash = await payloadHash({ id: input.id, expectedUpdatedAt: input.expectedUpdatedAt, expectedValues: input.expectedValues, changes: input.changes });
  const identity = { userId, requestId: input.requestId, ticketId: input.id, hash };
  let claim;
  try { claim = await ledger.claim({ ...identity, now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.hash && claim.hash !== hash) throw new WriteError('REQUEST_ID_REUSED', 'Start a new edit before saving different changes.', 409);
    if (claim.status === 'saved') {
      const current = await providerCall({ ...input, accessToken, method: 'GET', phase: 'before', fetchImpl, timeoutMs, now });
      return { status: 'saved', recruit: scopedRecord(current, input.id).recruit, requestId: input.requestId, replayed: true };
    }
    const message = claim.status === 'uncertain' ? uncertainMessage : claim.status === 'failed'
      ? 'This save request was already processed. Refresh before starting another edit.'
      : 'A save for this record is already in progress. Wait, then refresh before editing again.';
    throw new WriteError(claim.status === 'uncertain' ? 'SAVE_UNCERTAIN' : 'SAVE_ALREADY_PROCESSED', message, 409, { uncertain: claim.status === 'uncertain' });
  }
  try {
    const before = scopedRecord(await providerCall({ ...input, accessToken, method: 'GET', phase: 'before', fetchImpl, timeoutMs, now }), input.id);
    if (!before.recruit.updatedAt || before.recruit.updatedAt !== input.expectedUpdatedAt) throw new WriteError('RECORD_CHANGED', 'This record changed in HubSpot. Refresh, then review your edit before saving.', 409);
    if (Object.entries(input.expectedValues).some(([property, value]) => before.recruit.editValues?.[property] !== value)) throw new WriteError('RECORD_CHANGED', 'The fields you reviewed changed in HubSpot. Refresh, then review your edit before saving.', 409);
    const dirty = Object.fromEntries(Object.entries(input.changes).filter(([property, value]) => canonical(property, before.raw.properties[property]) !== value));
    if (!Object.keys(dirty).length) {
      if (!await ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
      return { status: 'saved', recruit: before.recruit, requestId: input.requestId, unchanged: true };
    }
    const ack = await providerCall({ ...input, changes: dirty, accessToken, method: 'PATCH', phase: 'patch', fetchImpl, timeoutMs, now });
    if (!ack || String(ack.id) !== input.id || ack.archived) throw uncertain();
    let after;
    try {
      after = scopedRecord(await providerCall({ ...input, accessToken, method: 'GET', phase: 'after', fetchImpl, timeoutMs, now }), input.id);
      if (Object.entries(dirty).some(([property, value]) => canonical(property, after.raw.properties[property]) !== value)) throw uncertain();
    } catch { throw uncertain(); }
    if (!await ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
    return { status: 'saved', recruit: after.recruit, requestId: input.requestId };
  } catch (error) {
    const safe = error instanceof WriteError ? error : uncertain();
    try { await ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* No automatic retry: an unconfirmed ledger result remains blocked. */ }
    throw safe;
  }
}

function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } }); }

/**
 * Testable request boundary. Identity and the server's editor allowlist are both required.
 * @param {Request} request
 * @param {string} id
 * @param {{getUser:()=>any,editorEmails?:string,writesEnabled?:string,db?:any,ledger?:any,saveData:(input:any,options:any)=>Promise<any>}} options
 */
export async function handleRecruitWriteRequest(request, id, { getUser, editorEmails, writesEnabled, db, ledger, saveData }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use Save to submit an edit.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before editing recruiting records.' }, signInPath: '/signin-with-chatgpt?return_to=%2F' }, 401);
    if (!editorAllowed(user, editorEmails)) throw new WriteError('EDITOR_NOT_ALLOWED', 'Your account is not allowed to edit recruiting records.', 403);
    if (!writeCapability(user, { editorEmails, writesEnabled, db })) throw new WriteError('WRITES_DISABLED', 'Saving is waiting for the app owner to enable HubSpot write access.', 403);
    if (request.headers.get('Origin') !== new URL(request.url).origin) throw new WriteError('ORIGIN_NOT_ALLOWED', 'Open this app directly before saving.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new WriteError('INVALID_REQUEST', 'Use a JSON edit request.', 415);
    const reader = request.body?.getReader(); const decoder = new TextDecoder(); let length = 0, body = '';
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new WriteError('INVALID_REQUEST', 'The edit request is too large.', 413); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let input; try { input = JSON.parse(body); } catch { throw invalid('Use a valid JSON edit request.'); }
    const validated = validateWriteInput(id, input);
    return json(await saveData(validated, { userId: user.userId, ledger: ledger ?? createD1Ledger(db) }));
  } catch (error) {
    const safe = error instanceof WriteError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message }, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status,
      safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
