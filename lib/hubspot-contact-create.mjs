import { createHmac } from 'node:crypto';
import { ContactInputError, normalizeContactPhone, validateContactInput } from './contact-input.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
import { writeCapability } from './hubspot-write.mjs';

const API = 'https://api.hubapi.com';
const PORTAL = '50894788';
const APP = '59264745';
const SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write'];
const LICENSE = 'licensed_2_14_2_15';
const HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie',
});

export class ContactCreationError extends Error {
  constructor(code, message, status = 400, { uncertain = false, contact, retryAfterSeconds, definiteRejection = false } = {}) {
    super(message); this.name = 'ContactCreationError'; this.code = code; this.status = status;
    this.uncertain = uncertain; this.contact = contact; this.retryAfterSeconds = retryAfterSeconds; this.definiteRejection = definiteRejection;
  }
}
function unavailable() { return new ContactCreationError('CREATE_UNAVAILABLE', 'Contact creation is unavailable. Start a new request after access is restored.', 503); }
function uncertain(status = 502) { return new ContactCreationError('CREATE_UNCERTAIN', 'The creation outcome is uncertain. Check HubSpot with the app owner before submitting this phone again.', status, { uncertain: true }); }
function accessRequired() { return new ContactCreationError('CONTACT_ACCESS_REQUIRED', 'The app owner must verify HubSpot contact access before creating contacts.', 403); }
function searchUnavailable() { return new ContactCreationError('CONTACT_SEARCH_UNAVAILABLE', 'HubSpot could not safely check for an existing contact. Start a new request later.', 503); }
function safeId(value) { return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value); }
function contactLink(id) { return safeId(id) ? { id, hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL}/record/0-1/${id}` } : undefined; }
function duplicate(id) { return new ContactCreationError('CONTACT_EXISTS', 'A contact with this phone is already known. Review it in HubSpot.', 409, { contact: contactLink(id) }); }
function keyValid(secret) { return typeof secret === 'string' && secret.length >= 32 && secret.length <= 4096; }
function tokenValid(token) { return typeof token === 'string' && token.trim() && token.length <= 4096 && !/[\r\n]/.test(token); }
function digest(secret, purpose, value) { return createHmac('sha256', secret).update(`legacy-recruiting:${purpose}:v1\0`).update(value).digest('hex'); }

/** Database constraints arbitrate concurrent claims across users and function instances. */
export function createContactPostgresLedger(db) {
  return {
    async claim({ userId, requestId, phoneHash, hash, keyHash, now }) {
      await db.query('INSERT INTO contact_create_ledger_key (id, key_hash) VALUES (1, $1) ON CONFLICT DO NOTHING', [keyHash]);
      const key = await db.query('SELECT key_hash FROM contact_create_ledger_key WHERE id = 1');
      if (key.rows[0]?.key_hash !== keyHash) throw unavailable();
      await db.query("UPDATE contact_create_requests SET status = 'uncertain', updated_at = $1 WHERE status = 'pending' AND updated_at < $2", [now, now - 120000]);
      const inserted = await db.query("INSERT INTO contact_create_requests (user_id, request_id, phone_hash, payload_hash, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'pending', $5, $5) ON CONFLICT DO NOTHING RETURNING request_id", [userId, requestId, phoneHash, hash, now]);
      if (inserted.rows.length === 1) return { acquired: true };
      const same = await db.query('SELECT payload_hash, status, contact_id FROM contact_create_requests WHERE user_id = $1 AND request_id = $2', [userId, requestId]);
      if (same.rows[0]) return { acquired: false, source: 'request', hash: same.rows[0].payload_hash, status: same.rows[0].status, contactId: same.rows[0].contact_id };
      const phone = await db.query("SELECT status, contact_id FROM contact_create_requests WHERE phone_hash = $1 AND status IN ('pending', 'created', 'duplicate', 'uncertain')", [phoneHash]);
      return { acquired: false, source: 'phone', status: phone.rows[0]?.status ?? 'pending', contactId: phone.rows[0]?.contact_id };
    },
    async finish({ userId, requestId, hash, status, contactId = null, now }) {
      if (!['created', 'duplicate', 'failed', 'uncertain'].includes(status) || (contactId !== null && !safeId(contactId))) throw unavailable();
      const result = await db.query("UPDATE contact_create_requests SET status = $1, contact_id = $2, updated_at = $3 WHERE user_id = $4 AND request_id = $5 AND payload_hash = $6 AND status = 'pending' RETURNING request_id", [status, contactId, now, userId, requestId, hash]);
      return result.rows.length === 1;
    },
  };
}

export function contactCreationCapability(user, options = {}) {
  return options.contactCreationEnabled === 'true' && keyValid(options.hmacSecret) && writeCapability(user, options);
}

function retrySeconds(value, now) {
  if (/^\d+$/.test(value ?? '')) return Math.max(1, Math.min(86400, Number(value)));
  const date = Date.parse(value ?? '');
  return Number.isFinite(date) ? Math.max(1, Math.min(86400, Math.ceil((date - now) / 1000))) : 60;
}
async function boundedJson(response, maxBytes = 512 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON body');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new RangeError('JSON body exceeds limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** No redirects or retries. Failure after a possible create is always ambiguous. */
async function provider({ path, accessToken, method = 'POST', body, phase, fetchImpl, timeoutMs, now }) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, API).href, {
      method, redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const success = phase === 'create' ? response.status === 201 : response.status === 200;
    if (!success) {
      if (phase === 'confirm' || (phase === 'create' && !(response.status >= 400 && response.status < 500))) throw uncertain();
      if (response.status === 429) throw new ContactCreationError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before starting a new request.', 429, { retryAfterSeconds: retrySeconds(response.headers.get('Retry-After'), now()), definiteRejection: phase === 'create' });
      if ([401, 403].includes(response.status)) { const error = accessRequired(); error.definiteRejection = phase === 'create'; throw error; }
      if (phase === 'create' && response.status === 409) throw new ContactCreationError('CONTACT_CONFLICT', 'HubSpot rejected this creation as a conflict. Review HubSpot before starting another request.', 409, { definiteRejection: true });
      if (phase === 'search') throw searchUnavailable();
      const error = unavailable(); error.definiteRejection = phase === 'create'; throw error;
    }
    return await boundedJson(response);
  } catch (error) {
    if (error instanceof ContactCreationError) {
      // The body parser's unavailable error must never release a possible create.
      if (['create', 'confirm'].includes(phase) && error.code === 'CREATE_UNAVAILABLE' && !error.definiteRejection) throw uncertain();
      throw error;
    }
    if (phase === 'create' || phase === 'confirm') throw uncertain();
    if (phase === 'search') throw searchUnavailable();
    throw unavailable();
  } finally { clearTimeout(timer); }
}

/** Token is sent in a bounded server-only JSON POST, never in the URL. */
export async function verifyContactAccess({ accessToken, fetchImpl = fetch, timeoutMs = 5000, now = Date.now } = {}) {
  if (!tokenValid(accessToken)) throw unavailable();
  const info = await provider({ path: '/oauth/v2/private-apps/get/access-token-info', accessToken, body: { tokenKey: accessToken }, phase: 'access', fetchImpl, timeoutMs, now });
  if (!info || String(info.hubId) !== PORTAL || String(info.appId) !== APP
    || !Array.isArray(info.scopes) || !SCOPES.every(scope => info.scopes.includes(scope))) throw accessRequired();
  return true;
}

export async function checkContactCreationCapability(user, options = {}) {
  if (!contactCreationCapability(user, options)) return false;
  try { return await verifyContactAccess(options); } catch { return false; }
}

function searchBody(phone) {
  const common = { properties: ['phone', 'mobilephone'], limit: 200 };
  if (/^\+1\d{10}$/.test(phone)) return { ...common, query: phone.slice(-10) };
  // International phone filters can miss provider-normalized national values.
  // Coverage is deliberately documented as best effort; no country-code guess.
  const variants = [phone, phone.slice(1)];
  return { ...common, filterGroups: ['phone', 'mobilephone'].flatMap(propertyName => variants.map(value => ({ filters: [{ propertyName, operator: 'EQ', value }] }))) };
}
function existingContact(raw, phone) {
  if (!raw || !Array.isArray(raw.results) || raw.results.length > 200 || !Number.isInteger(raw.total)
    || raw.total !== raw.results.length || (raw.paging !== undefined && (!raw.paging || typeof raw.paging !== 'object' || Array.isArray(raw.paging))) || raw.paging?.next) throw searchUnavailable();
  let found;
  for (const result of raw.results) {
    if (!safeId(result?.id) || result.archived || !result.properties || typeof result.properties !== 'object' || Array.isArray(result.properties)
      || !['phone', 'mobilephone'].some(key => Object.hasOwn(result.properties, key))) throw searchUnavailable();
    for (const key of ['phone', 'mobilephone']) {
      const value = result.properties[key];
      if (value === null || value === undefined || value === '') continue;
      let canonical;
      try { canonical = normalizeContactPhone(value); } catch { throw searchUnavailable(); }
      if (canonical === phone) found ??= result.id;
    }
  }
  return found;
}

/** Inputs are synthetic-tested; the application never retries a provider create. */
export async function createContact(rawInput, { userId, accessToken, hmacSecret, ledger, fetchImpl = fetch, now = Date.now, timeoutMs = 10000 }) {
  const input = validateContactInput(rawInput);
  if (!tokenValid(accessToken) || !keyValid(hmacSecret) || typeof userId !== 'string' || !userId) throw unavailable();
  const hash = digest(hmacSecret, 'contact-create', JSON.stringify([input.firstName, input.lastName, input.phone, input.licensed]));
  const identity = { userId, requestId: input.requestId, hash };
  let claim;
  try { claim = await ledger.claim({ ...identity, phoneHash: digest(hmacSecret, 'contact-phone', input.phone), keyHash: digest(hmacSecret, 'contact-key', 'singleton'), now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.source === 'request' && claim.hash !== hash) throw new ContactCreationError('REQUEST_ID_REUSED', 'Start a new request before submitting different contact details.', 409);
    if (claim.status === 'created' && claim.source === 'request' && contactLink(claim.contactId)) return { status: 'created', contact: contactLink(claim.contactId), requestId: input.requestId, replayed: true };
    if (['created', 'duplicate'].includes(claim.status) && contactLink(claim.contactId)) throw duplicate(claim.contactId);
    if (claim.status === 'uncertain') throw uncertain(409);
    if (claim.status === 'failed') throw new ContactCreationError('CREATE_ALREADY_PROCESSED', 'This request already failed. Start a new request after reviewing the issue.', 409);
    throw new ContactCreationError('CREATE_IN_PROGRESS', 'A request for this phone is already in progress. Wait and check HubSpot before submitting again.', 409);
  }
  let attempted = false; let settled = false;
  try {
    await verifyContactAccess({ accessToken, fetchImpl, timeoutMs: Math.min(timeoutMs, 5000), now });
    const candidate = existingContact(await provider({ path: '/crm/v3/objects/contacts/search', accessToken, body: searchBody(input.phone), phase: 'search', fetchImpl, timeoutMs, now }), input.phone);
    if (candidate) {
      if (!await ledger.finish({ ...identity, status: 'duplicate', contactId: candidate, now: now() })) throw unavailable();
      settled = true; throw duplicate(candidate);
    }
    const properties = { firstname: input.firstName, lastname: input.lastName, phone: input.phone, [LICENSE]: input.licensed ? 'Yes' : 'No' };
    attempted = true;
    const ack = await provider({ path: '/crm/v3/objects/contacts', accessToken, body: { properties }, phase: 'create', fetchImpl, timeoutMs, now });
    if (!safeId(ack?.id) || ack.archived) throw uncertain();
    const after = await provider({ path: `/crm/v3/objects/contacts/${ack.id}?properties=${Object.keys(properties).join(',')}`, accessToken, method: 'GET', phase: 'confirm', fetchImpl, timeoutMs, now });
    if (after?.id !== ack.id || after.archived || !after.properties || Object.entries(properties).some(([key, value]) => key === 'phone' ? normalizeContactPhone(after.properties[key]) !== value : after.properties[key] !== value)) throw uncertain();
    if (!await ledger.finish({ ...identity, status: 'created', contactId: ack.id, now: now() })) throw uncertain();
    return { status: 'created', contact: contactLink(ack.id), requestId: input.requestId };
  } catch (error) {
    if (settled) throw error;
    // Explicit provider 4xx errors are definite rejections. Every other possible
    // post-create failure, including a failed database confirmation, stays blocked.
    const definite = error instanceof ContactCreationError && error.definiteRejection;
    const safe = attempted && !definite ? uncertain() : error instanceof ContactCreationError ? error : unavailable();
    try { await ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* Pending claim remains blocked until reconciliation. */ }
    throw safe;
  }
}

function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } }); }

export async function handleContactCreateRequest(request, { getUser, createData, ...options }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use Add Recruit to create a contact.' } }, 405, { Allow: 'POST' });
  let requestId;
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before creating contacts.' }, signInPath: '/sign-in' }, 401);
    if (!contactCreationCapability(user, options)) throw new ContactCreationError('CONTACT_CREATION_DISABLED', 'Contact creation is disabled for this account or environment.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new ContactCreationError('ORIGIN_NOT_ALLOWED', 'Open this app directly before creating a contact.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ContactCreationError('INVALID_REQUEST', 'Send a JSON contact request.', 415);
    let input;
    try { input = validateContactInput(await boundedJson(request, 4096)); } catch (error) {
      if (error instanceof ContactInputError) throw error;
      if (error instanceof RangeError) throw new ContactCreationError('INVALID_REQUEST', 'The contact request is too large.', 413);
      throw new ContactInputError();
    }
    requestId = input.requestId;
    const result = await createData(input, { userId: user.userId, ledger: options.ledger });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) {
    const safe = error instanceof ContactCreationError || error instanceof ContactInputError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message, ...(safe.fieldErrors ? { fieldErrors: safe.fieldErrors } : {}) }, ...(requestId ? { requestId } : {}), ...(safe.contact ? { contact: safe.contact } : {}), ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
