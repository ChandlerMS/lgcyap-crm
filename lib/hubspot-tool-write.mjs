import { WriteError, writeCapability } from './hubspot-write.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
import { HUBSPOT_TOOL_CONFIG, normalizeToolRecord } from './hubspot-tools.mjs';
import { editableFields, toolEditValues } from './hubspot-tool-edit-config.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const uncertain = () => new WriteError('SAVE_UNCERTAIN', 'The save outcome is uncertain. Reload and check the record in HubSpot before saving again.', 502, { uncertain: true });
const invalid = message => new WriteError('INVALID_EDIT', message ?? 'The edit request is invalid.', 400);
const unavailable = () => new WriteError('SAVE_UNAVAILABLE', 'Saving is unavailable right now. Reload before trying again.', 503);
const validIso = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
let accessCache = null;

export function toolWriteCapability(tool, user, options = {}) {
  return editableFields(tool).length > 0 && typeof options.hmacSecret === 'string' && options.hmacSecret.length >= 32
    && typeof options.accessToken === 'string' && Boolean(options.accessToken.trim()) && writeCapability(user, options);
}

/** Fixed private-app introspection. Credential stays in a server-only POST body, never a URL.
 * @param {string} tool
 * @param {{accessToken?:string,fetchImpl?:typeof fetch,now?:()=>number,timeoutMs?:number}} options
 */
export async function verifyToolWriteAccess(tool, { accessToken, fetchImpl = fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  if (!editableFields(tool).length || typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) throw unavailable();
  const kind = tool === 'customer-success' ? 'companies' : tool === 'tickets' ? 'tickets' : 'contacts';
  const scopes = [`crm.objects.${kind}.read`, `crm.objects.${kind}.write`];
  if (accessCache?.accessToken === accessToken && accessCache.fetchImpl === fetchImpl && accessCache.expiresAt > now() && scopes.every(scope => accessCache.scopes.includes(scope))) return true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info', { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenKey: accessToken }) });
    if (response.status !== 200) throw new WriteError('HUBSPOT_WRITE_ACCESS_REQUIRED', 'The app owner must verify HubSpot access before this record can be edited.', 403);
    const info = await readJson(response);
    if (!info || String(info.hubId) !== '50894788' || String(info.appId) !== '59264745' || !Array.isArray(info.scopes) || !scopes.every(scope => info.scopes.includes(scope))) throw new WriteError('HUBSPOT_WRITE_ACCESS_REQUIRED', 'The app owner must verify this app, HubSpot account and required write access.', 403);
    accessCache = { accessToken, fetchImpl, expiresAt: now() + 60000, scopes: info.scopes.filter(scope => typeof scope === 'string') };
    return true;
  } catch (error) { if (error instanceof WriteError) throw error; throw unavailable(); }
  finally { clearTimeout(timer); }
}

/** @param {string} tool @param {unknown} user @param {any} options */
export async function checkToolWriteCapability(tool, user, options = {}) {
  if (!toolWriteCapability(tool, user, options)) return false;
  try { return await verifyToolWriteAccess(tool, options); } catch { return false; }
}

export function validateToolWriteInput(tool, id, input) {
  const definitions = editableFields(tool), fields = new Map(definitions.map(field => [field.property, field]));
  if (!definitions.length || typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) throw invalid('Choose a valid editable HubSpot record.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'expectedUpdatedAt', 'expectedValues', 'changes'].includes(key))) throw invalid();
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId) || !validIso(input.expectedUpdatedAt)) throw invalid('Reload the record before starting this edit.');
  if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)) throw invalid();
  const entries = Object.entries(input.changes).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length || entries.length > definitions.length || !input.expectedValues || typeof input.expectedValues !== 'object' || Array.isArray(input.expectedValues) || Object.keys(input.expectedValues).length !== entries.length || Object.keys(input.expectedValues).some(key => !Object.hasOwn(input.changes, key))) throw invalid('Review at least one changed field from a fresh record.');
  const changes = {}, expectedValues = {};
  for (const [property, raw] of entries) {
    const field = fields.get(property);
    if (!field || typeof raw !== 'string' || typeof input.expectedValues[property] !== 'string' || input.expectedValues[property].length > 4000) throw invalid('Only the displayed HubSpot fields can be edited.');
    let value = raw.trim();
    if (/[\u0000-\u001f\u007f]/.test(value) || value.length > field.maxLength || field.required && !value) throw invalid(`Enter a valid ${field.label.toLowerCase()}.`);
    if (field.owner) { if (value && !/^[1-9]\d{0,19}$/.test(value)) throw invalid('Choose a valid HubSpot owner.'); }
    else if (field.type === 'select' && !field.options.some(option => option.value === value)) throw invalid(`Choose a valid ${field.label.toLowerCase()}.`);
    if (field.type === 'email') { value = value.toLowerCase(); if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw invalid('Enter a valid email address.'); }
    if (property === 'domain') { value = value.toLowerCase(); if (value && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value)) throw invalid('Enter a company domain such as example.com.'); }
    if (field.type === 'tel' && value && !/\d/.test(value)) throw invalid('Enter a valid phone number.');
    if (field.type === 'date' && value && !validDate(value)) throw invalid('Choose a real calendar date.');
    if (field.type === 'datetime' && value && !validIso(value)) throw invalid('Choose a valid date and time.');
    changes[property] = value; expectedValues[property] = input.expectedValues[property];
  }
  return { tool, id, requestId: input.requestId.toLowerCase(), expectedUpdatedAt: input.expectedUpdatedAt, expectedValues, changes };
}

async function hashPayload(input, hmacSecret) {
  const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', encoder.encode(hmacSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = { domain: 'legacy-hubspot-tool-edit-v1', tool: input.tool, id: input.id, expectedUpdatedAt: input.expectedUpdatedAt, expectedValues: input.expectedValues, changes: input.changes };
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(payload))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(response) {
  const reader = response.body?.getReader(); if (!reader) throw Error('payload');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 512 * 1024) { await reader.cancel(); throw Error('payload'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function provider(input, { accessToken, fetchImpl, timeoutMs }, phase, changes) {
  const config = HUBSPOT_TOOL_CONFIG[input.tool], url = new URL(`https://api.hubapi.com/crm/v3/objects/${config.object}/${input.id}`);
  const patch = phase === 'patch';
  if (!patch) url.searchParams.set('properties', [...new Set([...config.fields, ...editableFields(input.tool).map(field => field.property)])].join(','));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.href, { method: patch ? 'PATCH' : 'GET', redirect: 'manual', signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(patch ? { 'Content-Type': 'application/json' } : {}) }, ...(patch ? { body: JSON.stringify({ properties: changes }) } : {}) });
    if (!response.ok) {
      if (phase === 'after' || patch && ![400, 401, 403, 404, 429].includes(response.status)) throw uncertain();
      if (response.status === 429) { const raw = response.headers.get('Retry-After'); throw new WriteError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait, then reload before saving again.', 429, { retryAfterSeconds: /^\d{1,6}$/.test(raw ?? '') ? Math.max(1, Math.min(86400, Number(raw))) : 60 }); }
      if ([401, 403].includes(response.status)) throw new WriteError('HUBSPOT_WRITE_ACCESS_REQUIRED', 'HubSpot has not granted permission for this save.', 403);
      if (response.status === 404) throw new WriteError('RECORD_NOT_FOUND', 'This HubSpot record is no longer available.', 404);
      if (response.status === 400) throw new WriteError('HUBSPOT_REJECTED_EDIT', 'HubSpot did not accept these field values. Reload and review the edit.', 400);
      throw new WriteError('HUBSPOT_UNAVAILABLE', 'HubSpot could not read the record. Reload before editing.', 502);
    }
    try { return await readJson(response); } catch { if (phase !== 'before') throw uncertain(); throw new WriteError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected record. Reload before editing.', 502); }
  } catch (error) {
    if (error instanceof WriteError) throw error;
    if (phase !== 'before') throw uncertain();
    throw new WriteError(controller.signal.aborted ? 'HUBSPOT_TIMEOUT' : 'HUBSPOT_UNAVAILABLE', 'HubSpot could not read the record. Reload before editing.', controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); }
}

function scopedRecord(input, raw) {
  const fields = editableFields(input.tool);
  if (!raw || String(raw.id) !== input.id || raw.archived || !raw.properties || fields.some(field => !Object.hasOwn(raw.properties, field.property))) throw new WriteError('RECORD_NOT_FOUND', 'This HubSpot record or its editable snapshot is unavailable.', 404);
  let record;
  try { record = normalizeToolRecord(input.tool, raw); } catch { throw new WriteError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected record. Reload before editing.', 502); }
  record.editValues = toolEditValues(input.tool, raw.properties);
  if (!validIso(record.updatedAt)) throw new WriteError('HUBSPOT_RESPONSE_INVALID', 'Reload a fresh HubSpot record before editing.', 502);
  return record;
}

/** Metadata-only ledger; ticket locks intentionally share the recruiting writer's raw ID namespace.
 * @param {{tool:string,id:string,requestId:string,expectedUpdatedAt:string,expectedValues:Record<string,string>,changes:Record<string,string>}} input
 * @param {{userId:string,accessToken?:string,hmacSecret?:string,ledger:any,fetchImpl?:typeof fetch,now?:()=>number,timeoutMs?:number}} options
 */
export async function saveHubSpotToolRecord(input, { userId, accessToken, hmacSecret, ledger, fetchImpl = fetch, now = Date.now, timeoutMs = 10000 }) {
  const { tool, id, ...request } = input;
  input = validateToolWriteInput(tool, id, request);
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096 || typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw unavailable();
  await verifyToolWriteAccess(input.tool, { accessToken, fetchImpl, now, timeoutMs: Math.min(timeoutMs, 5000) });
  const hash = await hashPayload(input, hmacSecret), object = HUBSPOT_TOOL_CONFIG[input.tool].object;
  const identity = { userId, requestId: input.requestId, ticketId: input.tool === 'tickets' ? input.id : `${object}:${input.id}`, hash };
  let claim; try { claim = await ledger.claim({ ...identity, now: now() }); } catch { throw unavailable(); }
  const options = { accessToken, fetchImpl, timeoutMs };
  if (!claim.acquired) {
    if (claim.hash && claim.hash !== hash) throw new WriteError('REQUEST_ID_REUSED', 'Start a new edit before saving different changes.', 409);
    if (claim.status === 'saved') { const record = scopedRecord(input, await provider(input, options, 'before')); return { status: 'saved', requestId: input.requestId, record, replayed: true }; }
    throw new WriteError(claim.status === 'uncertain' ? 'SAVE_UNCERTAIN' : 'SAVE_ALREADY_PROCESSED', claim.status === 'uncertain' ? 'The previous save outcome is uncertain. Reload and check the record before editing again.' : 'This save is already in progress or was processed. Reload before starting another edit.', 409, { uncertain: claim.status === 'uncertain' });
  }
  try {
    const before = scopedRecord(input, await provider(input, options, 'before'));
    if (before.updatedAt !== input.expectedUpdatedAt || Object.entries(input.expectedValues).some(([key, value]) => before.editValues[key] !== value)) throw new WriteError('RECORD_CHANGED', 'This record changed in HubSpot. Reload and review the edit before saving.', 409);
    const dirty = Object.fromEntries(Object.entries(input.changes).filter(([key, value]) => before.editValues[key] !== value));
    if (input.tool === 'meetings' && ['hs_meeting_start_time', 'hs_meeting_end_time'].some(key => Object.hasOwn(dirty, key))) {
      const merged = { ...before.editValues, ...dirty };
      if (merged.hs_meeting_end_time && (!merged.hs_meeting_start_time || merged.hs_meeting_end_time < merged.hs_meeting_start_time)) throw invalid('Meeting end must follow its start.');
    }
    if (!Object.keys(dirty).length) { if (!await ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain(); return { status: 'saved', requestId: input.requestId, record: before, unchanged: true }; }
    const ack = await provider(input, options, 'patch', dirty);
    if (!ack || String(ack.id) !== input.id || ack.archived) throw uncertain();
    let after;
    try { after = scopedRecord(input, await provider(input, options, 'after')); if (Object.entries(dirty).some(([key, value]) => after.editValues[key] !== value)) throw uncertain(); } catch { throw uncertain(); }
    if (!await ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
    return { status: 'saved', requestId: input.requestId, record: after };
  } catch (error) {
    const safe = error instanceof WriteError ? error : uncertain();
    try { await ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* Preserve the pending lock; never retry a provider mutation. */ }
    throw safe;
  }
}

function json(value, status = 200, extra = {}) { return new Response(JSON.stringify(value), { status, headers: { ...HEADERS, ...extra } }); }
/** @param {Request} request @param {string} tool @param {string} id
 * @param {{getUser:()=>any,editorEmails?:string,writesEnabled?:string,accessToken?:string,hmacSecret?:string,ledger?:any,vercel?:string,vercelEnv?:string,allowedOrigin?:string,saveData:(input:any,options:any)=>Promise<any>}} options */
export async function handleHubSpotToolWriteRequest(request, tool, id, options) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use Save to submit an edit.' } }, 405, { Allow: 'POST' });
  try {
    const user = await options.getUser(); if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before editing.' }, signInPath: '/sign-in' }, 401);
    if (!toolWriteCapability(tool, user, options)) throw new WriteError('WRITES_DISABLED', 'Saving is disabled for this page or environment.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new WriteError('ORIGIN_NOT_ALLOWED', 'Open this app directly before saving.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new WriteError('INVALID_REQUEST', 'Use a JSON edit request.', 415);
    const reader = request.body?.getReader(), decoder = new TextDecoder(); let body = '', size = 0;
    if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); throw new WriteError('INVALID_REQUEST', 'The edit request is too large.', 413); } body += decoder.decode(value, { stream: true }); }
    body += decoder.decode(); let input; try { input = JSON.parse(body); } catch { throw invalid(); }
    const validated = validateToolWriteInput(tool, id, input);
    return json(await options.saveData(validated, { userId: user.userId, ledger: options.ledger }));
  } catch (error) {
    const safe = error instanceof WriteError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message }, ...(safe.uncertain ? { uncertain: true } : {}), ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
