import { createHmac } from 'node:crypto';
import { normalizeContactPhone } from './contact-input.mjs';
import { RecruitIntakeInputError, validateRecruitIntakeInput } from './recruit-intake-input.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
import { writeCapability } from './hubspot-write.mjs';
import { PORTAL_ID, PIPELINE_ID, STAGE_PAGES } from './recruiting-config.mjs';

const API = 'https://api.hubapi.com';
const APP_ID = '59264745';
const STAGE_ID = STAGE_PAGES.find(page => page.id === 'recruits').stageId;
const SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.tickets.read', 'crm.objects.tickets.write'];
const STATES = ['pending', 'contact_ready', 'ticket_pending', 'needs_ticket', 'created', 'already_exists', 'failed', 'uncertain'];
const CONTACT_PROPERTIES = ['firstname', 'lastname', 'phone', 'mobilephone', 'email'];
const PRIVATE_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' });
const safeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const keyValid = value => typeof value === 'string' && value.length >= 32 && value.length <= 4096;
const tokenValid = value => typeof value === 'string' && value.trim() && value.length <= 4096 && !/[\r\n]/.test(value);
const digest = (secret, purpose, value) => createHmac('sha256', secret).update(`legacy-recruit-intake:${purpose}:v1\0`).update(value).digest('hex');
const link = (id, object) => safeId(id) ? { id, hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/${object}/${id}` } : undefined;
const contactLink = id => link(id, '0-1');
const ticketLink = id => link(id, '0-5');

export class RecruitIntakeError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message); this.name = 'RecruitIntakeError'; this.code = code; this.status = status;
    Object.assign(this, extra);
  }
}
const unavailable = () => new RecruitIntakeError('INTAKE_UNAVAILABLE', 'Recruit entry is unavailable. No confirmed setup can be reported; check access and try later.', 503);
const accessRequired = () => new RecruitIntakeError('INTAKE_ACCESS_REQUIRED', 'The app owner must verify contact and recruiting access before adding recruits.', 403);
const searchUnavailable = () => new RecruitIntakeError('INTAKE_SEARCH_UNAVAILABLE', 'HubSpot could not safely check existing contacts and recruiting records. Try later.', 503);
const conflict = () => new RecruitIntakeError('CONTACT_IDENTITY_CONFLICT', 'Existing contact details or recruiting links need review in HubSpot. Nothing was overwritten.', 409);
const uncertain = () => new RecruitIntakeError('INTAKE_UNCERTAIN', 'The setup outcome is unconfirmed. Check HubSpot with the app owner before submitting this recruit again.', 502, { uncertain: true });
const needsTicket = retryAfterSeconds => new RecruitIntakeError('INTAKE_TICKET_REQUIRED', 'The contact is confirmed, but its recruiting record was not created. Use Resume to finish this same submission after reviewing the issue.', retryAfterSeconds ? 429 : 409, { canResume: true, retryAfterSeconds });
function safeResult(row, requestId, replayed = false) {
  if (!contactLink(row.contactId) || !ticketLink(row.ticketId)) throw uncertain();
  return { status: row.status === 'already_exists' ? 'already_exists' : 'created', requestId, contact: contactLink(row.contactId), recruit: ticketLink(row.ticketId), ...(replayed ? { replayed: true } : {}) };
}
function rowResult(row) { return { status: row.status, hash: row.payload_hash, contactId: row.contact_id, ticketId: row.ticket_id }; }

/** A single INSERT atomically arbitrates both identity indexes across users/functions. */
export function createRecruitIntakePostgresLedger(db) {
  return {
    async claim({ userId, requestId, hash, phoneHash, emailHash, keyHash, now }) {
      await db.query('INSERT INTO recruit_intake_ledger_key (id,key_hash) VALUES (1,$1) ON CONFLICT DO NOTHING', [keyHash]);
      const key = await db.query('SELECT key_hash FROM recruit_intake_ledger_key WHERE id=1');
      if (key.rows[0]?.key_hash !== keyHash) throw unavailable();
      await db.query("UPDATE recruit_intake_requests SET status='uncertain',updated_at=$1 WHERE status IN ('pending','contact_ready','ticket_pending') AND updated_at<$2", [now, now - 120000]);
      const inserted = await db.query("INSERT INTO recruit_intake_requests (user_id,request_id,phone_hash,email_hash,payload_hash,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,$6) ON CONFLICT DO NOTHING RETURNING status", [userId, requestId, phoneHash, emailHash, hash, now]);
      if (inserted.rows.length === 1) return { acquired: true, status: 'pending' };
      const same = await db.query('SELECT payload_hash,status,contact_id,ticket_id FROM recruit_intake_requests WHERE user_id=$1 AND request_id=$2', [userId, requestId]);
      if (same.rows[0]) {
        if (same.rows[0].payload_hash === hash && same.rows[0].status === 'needs_ticket') {
          const resumed = await db.query("UPDATE recruit_intake_requests SET status='contact_ready',updated_at=$1 WHERE user_id=$2 AND request_id=$3 AND payload_hash=$4 AND status='needs_ticket' RETURNING contact_id,ticket_id", [now, userId, requestId, hash]);
          if (resumed.rows.length === 1) return { acquired: true, resumed: true, status: 'contact_ready', contactId: resumed.rows[0].contact_id, ticketId: resumed.rows[0].ticket_id };
          const current = await db.query('SELECT payload_hash,status,contact_id,ticket_id FROM recruit_intake_requests WHERE user_id=$1 AND request_id=$2', [userId, requestId]);
          return { acquired: false, source: 'request', ...rowResult(current.rows[0] ?? same.rows[0]) };
        }
        return { acquired: false, source: 'request', ...rowResult(same.rows[0]) };
      }
      const identities = await db.query("SELECT payload_hash,status,contact_id,ticket_id FROM recruit_intake_requests WHERE status<>'failed' AND (phone_hash=$1 OR (email_hash IS NOT NULL AND email_hash=$2))", [phoneHash, emailHash]);
      if (identities.rows.length === 1) return { acquired: false, source: 'identity', ...rowResult(identities.rows[0]) };
      return { acquired: false, source: 'identity', status: identities.rows.length ? 'conflict' : 'pending' };
    },
    async finish({ userId, requestId, hash, from, status, contactId = null, ticketId = null, now }) {
      if (!STATES.includes(from) || !STATES.includes(status) || (contactId !== null && !safeId(contactId)) || (ticketId !== null && !safeId(ticketId))) throw unavailable();
      const result = await db.query('UPDATE recruit_intake_requests SET status=$1,contact_id=COALESCE($2,contact_id),ticket_id=COALESCE($3,ticket_id),updated_at=$4 WHERE user_id=$5 AND request_id=$6 AND payload_hash=$7 AND status=$8 RETURNING request_id', [status, contactId, ticketId, now, userId, requestId, hash, from]);
      return result.rows.length === 1;
    },
  };
}

export function recruitIntakeCapability(user, options = {}) {
  return options.intakeEnabled === 'true' && keyValid(options.hmacSecret) && writeCapability(user, options);
}

async function boundedJson(source, limit = 512 * 1024) {
  const reader = source.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); throw new RangeError('Body too large'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function retrySeconds(value, now) {
  if (/^\d+$/.test(value ?? '')) return Math.max(1, Math.min(86400, Number(value)));
  const date = Date.parse(value ?? ''); return Number.isFinite(date) ? Math.max(1, Math.min(86400, Math.ceil((date - now) / 1000))) : 60;
}
async function provider(path, { accessToken, fetchImpl, timeoutMs, now, deadline }, { method = 'GET', body, mutation = false } = {}) {
  const remaining = deadline - now();
  if (remaining <= 0) throw unavailable();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, remaining)));
  try {
    const response = await fetchImpl(new URL(path, API).href, { method, redirect: 'manual', signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status !== (mutation ? 201 : 200)) {
      const definiteRejection = mutation && response.status >= 400 && response.status < 500;
      if (mutation && !definiteRejection) throw uncertain();
      if (response.status === 429) throw new RecruitIntakeError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before another deliberate attempt.', 429, { definiteRejection, retryAfterSeconds: retrySeconds(response.headers.get('Retry-After'), now()) });
      if ([401, 403].includes(response.status)) { const error = accessRequired(); error.definiteRejection = definiteRejection; throw error; }
      if (mutation) throw new RecruitIntakeError('INTAKE_REJECTED', 'HubSpot rejected this setup step. Review the submitted details before another attempt.', 409, { definiteRejection });
      throw searchUnavailable();
    }
    try { return await boundedJson(response); } catch { throw mutation ? uncertain() : searchUnavailable(); }
  } catch (error) {
    if (error instanceof RecruitIntakeError) throw error;
    throw mutation ? uncertain() : searchUnavailable();
  } finally { clearTimeout(timer); }
}
function providerOptions(options = {}) { return { accessToken: options.accessToken, fetchImpl: options.fetchImpl ?? fetch, now: options.now ?? Date.now, timeoutMs: options.timeoutMs ?? 5000, deadline: options.deadline ?? (options.now ?? Date.now)() + 45000 }; }

export async function verifyRecruitIntakeAccess(options = {}) {
  if (!tokenValid(options.accessToken)) throw accessRequired();
  const context = providerOptions(options);
  const info = await provider('/oauth/v2/private-apps/get/access-token-info', context, { method: 'POST', body: { tokenKey: options.accessToken } });
  if (!info || String(info.hubId) !== PORTAL_ID || String(info.appId) !== APP_ID || !Array.isArray(info.scopes) || !SCOPES.every(scope => info.scopes.includes(scope))) throw accessRequired();
  return true;
}
async function ticketContactType(context) {
  const raw = await provider('/crm/v4/associations/tickets/contacts/labels', context);
  if (!raw || !Array.isArray(raw.results) || raw.results.length > 200) throw unavailable();
  const matches = raw.results.filter(item => item?.category === 'HUBSPOT_DEFINED' && item.label === null && Number.isInteger(item.typeId) && item.typeId > 0);
  if (matches.length !== 1) throw unavailable();
  return matches[0].typeId;
}
export async function checkRecruitIntakeCapability(user, options = {}) {
  if (!recruitIntakeCapability(user, options)) return false;
  try { const context = providerOptions(options); await verifyRecruitIntakeAccess(context); await ticketContactType(context); return true; } catch { return false; }
}

function searchRows(raw) {
  if (!raw || !Array.isArray(raw.results) || raw.results.length > 200 || !Number.isInteger(raw.total) || raw.total !== raw.results.length || raw.paging?.next) throw searchUnavailable();
  return raw.results.map(row => {
    if (!safeId(row?.id) || row.archived || !row.properties || typeof row.properties !== 'object' || Array.isArray(row.properties)
      || CONTACT_PROPERTIES.some(key => !Object.hasOwn(row.properties, key) || (row.properties[key] !== null && typeof row.properties[key] !== 'string'))) throw searchUnavailable();
    return row;
  });
}
function canonicalPhone(value) { if (value === '' || value === undefined || value === null) return ''; try { return normalizeContactPhone(value); } catch { throw conflict(); } }
function nameKey(value) { return typeof value === 'string' ? value.trim().normalize('NFC').toLowerCase() : ''; }
function contactMatches(row, input) {
  const properties = row.properties;
  const phone = [properties.phone, properties.mobilephone].some(value => canonicalPhone(value) === input.phone);
  return phone && nameKey(properties.firstname) === nameKey(input.firstName) && nameKey(properties.lastname) === nameKey(input.lastName)
    && (!input.email || String(properties.email ?? '').trim().toLowerCase() === input.email);
}
async function findContact(input, context) {
  const phoneBody = /^\+1\d{10}$/.test(input.phone) ? { query: input.phone.slice(-10) } : { filterGroups: ['phone', 'mobilephone'].flatMap(propertyName => [input.phone, input.phone.slice(1)].map(value => ({ filters: [{ propertyName, operator: 'EQ', value }] }))) };
  const phoneRows = searchRows(await provider('/crm/v3/objects/contacts/search', context, { method: 'POST', body: { ...phoneBody, properties: CONTACT_PROPERTIES, limit: 200 } }));
  const candidates = new Map();
  for (const row of phoneRows) if ([row.properties.phone, row.properties.mobilephone].some(value => canonicalPhone(value) === input.phone)) candidates.set(row.id, row);
  if (input.email) {
    const emailRows = searchRows(await provider('/crm/v3/objects/contacts/search', context, { method: 'POST', body: { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: input.email }] }], properties: CONTACT_PROPERTIES, limit: 200 } }));
    for (const row of emailRows) if (String(row.properties.email ?? '').trim().toLowerCase() === input.email) candidates.set(row.id, row);
  }
  if (candidates.size > 1) throw conflict();
  const found = [...candidates.values()][0];
  if (found && !contactMatches(found, input)) throw conflict();
  return found?.id ?? null;
}
async function readContact(id, input, context) {
  const row = await provider(`/crm/v3/objects/contacts/${id}?properties=${CONTACT_PROPERTIES.join(',')}`, context);
  if (row?.id !== id || row.archived || !row.properties || !contactMatches(row, input)) throw conflict();
}
async function readTicket(id, contactId, context, expectedProperties) {
  const properties = ['hs_pipeline', 'hs_pipeline_stage', 'recruit_name', 'subject'];
  const row = await provider(`/crm/v3/objects/tickets/${id}?properties=${properties.join(',')}&associations=contacts`, context);
  const contacts = row?.associations?.contacts;
  if (row?.id !== id || row.archived || row.properties?.hs_pipeline !== PIPELINE_ID || !STAGE_PAGES.some(page => page.stageId === row.properties?.hs_pipeline_stage)
    || !Array.isArray(contacts?.results) || contacts.paging?.next || !contacts.results.some(item => item?.id === contactId)
    || (expectedProperties && Object.entries(expectedProperties).some(([key, value]) => row.properties?.[key] !== value))) throw searchUnavailable();
  return row;
}
async function existingRecruit(contactId, context) {
  // Direct association reads avoid relying on recently indexed ticket search results.
  const ids = []; let after;
  for (let page = 0; page < 5; page++) {
    const raw = await provider(`/crm/v4/objects/contacts/${contactId}/associations/tickets?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, context);
    if (!raw || !Array.isArray(raw.results) || raw.results.length > 100) throw searchUnavailable();
    for (const row of raw.results) { if (typeof row?.toObjectId === 'number' && !Number.isSafeInteger(row.toObjectId)) throw searchUnavailable(); const id = String(row?.toObjectId ?? ''); if (!safeId(id) || ids.includes(id)) throw searchUnavailable(); ids.push(id); }
    if (!raw.paging?.next) { after = null; break; }
    after = String(raw.paging.next.after ?? ''); if (!after || after.length > 300 || page === 4) throw searchUnavailable();
  }
  const found = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const group = ids.slice(offset, offset + 100);
    const raw = await provider('/crm/v3/objects/tickets/batch/read', context, { method: 'POST', body: { properties: ['hs_pipeline', 'hs_pipeline_stage'], inputs: group.map(id => ({ id })) } });
    if (!raw || raw.status !== 'COMPLETE' || !Array.isArray(raw.results) || raw.results.length !== group.length || raw.errors?.length) throw searchUnavailable();
    const seen = new Set();
    for (const row of raw.results) {
      if (!safeId(row?.id) || !group.includes(row.id) || seen.has(row.id) || row.archived || !row.properties) throw searchUnavailable();
      seen.add(row.id); if (row.properties.hs_pipeline === PIPELINE_ID) found.push(row.id);
    }
  }
  if (found.length > 1) throw conflict();
  if (found[0]) await readTicket(found[0], contactId, context);
  return found[0] ?? null;
}

/** Creates one confirmed Contact plus one linked recruiting Ticket, with no automatic write retries. */
export async function createRecruitIntake(rawInput, { userId, accessToken, hmacSecret, ledger, fetchImpl = fetch, now = Date.now, timeoutMs = 8000 }) {
  const input = validateRecruitIntakeInput(rawInput);
  if (!tokenValid(accessToken) || !keyValid(hmacSecret) || typeof userId !== 'string' || !userId || typeof ledger?.claim !== 'function' || typeof ledger?.finish !== 'function') throw unavailable();
  const hash = digest(hmacSecret, 'payload', JSON.stringify([input.firstName, input.lastName, input.phone, input.email]));
  const identity = { userId, requestId: input.requestId, hash };
  let claim;
  try { claim = await ledger.claim({ ...identity, phoneHash: digest(hmacSecret, 'phone', input.phone), emailHash: input.email ? digest(hmacSecret, 'email', input.email) : null, keyHash: digest(hmacSecret, 'key', 'singleton'), now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.source === 'request' && claim.hash !== hash) throw new RecruitIntakeError('REQUEST_ID_REUSED', 'This submission ID belongs to different details. Start a new entry after reviewing the original outcome.', 409);
    if (['created', 'already_exists'].includes(claim.status) && claim.hash === hash) return safeResult({ ...claim, status: claim.source === 'identity' ? 'already_exists' : claim.status }, input.requestId, true);
    if (claim.status === 'uncertain') { const error = uncertain(); error.status = 409; error.contact = contactLink(claim.contactId); error.recruit = ticketLink(claim.ticketId); throw error; }
    if (claim.status === 'failed') throw new RecruitIntakeError('INTAKE_ALREADY_PROCESSED', 'This submission already failed. Start a new entry after reviewing the issue.', 409);
    if (claim.status === 'needs_ticket' || claim.status === 'conflict' || (claim.hash && claim.hash !== hash)) throw conflict();
    throw new RecruitIntakeError('INTAKE_IN_PROGRESS', 'Setup for this phone or email is already in progress. Wait and check HubSpot before submitting again.', 409);
  }
  let state = claim.status, contactId = claim.contactId ?? null, ticketId = claim.ticketId ?? null;
  let contactConfirmed = claim.resumed === true, possibleContactCreate = false, possibleTicketCreate = false;
  const context = providerOptions({ accessToken, fetchImpl, now, timeoutMs, deadline: now() + 45000 });
  const checkpoint = async (status, extra = {}) => {
    if (!await ledger.finish({ ...identity, from: state, status, contactId, ticketId, now: now(), ...extra })) throw uncertain();
    state = status;
  };
  try {
    await verifyRecruitIntakeAccess(context);
    const associationTypeId = await ticketContactType(context);
    if (claim.resumed) {
      if (!safeId(contactId) || ticketId) throw uncertain();
      await readContact(contactId, input, context);
    } else {
      contactId = await findContact(input, context);
      if (!contactId) {
        possibleContactCreate = true;
        const properties = { firstname: input.firstName, lastname: input.lastName, phone: input.phone, ...(input.email ? { email: input.email } : {}) };
        const ack = await provider('/crm/v3/objects/contacts', context, { method: 'POST', body: { properties }, mutation: true });
        if (!safeId(ack?.id) || ack.archived) throw uncertain();
        contactId = ack.id; await checkpoint('pending');
      }
      await readContact(contactId, input, context); contactConfirmed = true;
      await checkpoint('contact_ready');
    }
    const existing = await existingRecruit(contactId, context);
    if (existing) { ticketId = existing; await checkpoint('already_exists'); return safeResult({ status: state, contactId, ticketId }, input.requestId); }
    const fullName = `${input.firstName} ${input.lastName}`;
    const properties = { subject: `Recruiting: ${fullName}`, recruit_name: fullName, hs_pipeline: PIPELINE_ID, hs_pipeline_stage: STAGE_ID };
    await checkpoint('ticket_pending'); possibleTicketCreate = true;
    const ack = await provider('/crm/v3/objects/tickets', context, { method: 'POST', mutation: true, body: { properties, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId }] }] } });
    if (!safeId(ack?.id) || ack.archived) throw uncertain();
    ticketId = ack.id; await checkpoint('ticket_pending');
    await readTicket(ticketId, contactId, context, properties);
    await checkpoint('created');
    return safeResult({ status: state, contactId, ticketId }, input.requestId);
  } catch (caught) {
    const error = caught instanceof RecruitIntakeError ? caught : unavailable();
    const ticketDefiniteRejection = possibleTicketCreate && error.definiteRejection === true;
    const contactDefiniteRejection = possibleContactCreate && !contactId && error.definiteRejection === true;
    let safe;
    if ((possibleTicketCreate && !ticketDefiniteRejection) || (possibleContactCreate && !contactConfirmed && !contactDefiniteRejection) || error.uncertain) safe = uncertain();
    else if (contactConfirmed) safe = needsTicket(error.retryAfterSeconds);
    else safe = error;
    const finalState = safe.uncertain ? 'uncertain' : contactConfirmed ? 'needs_ticket' : 'failed';
    try { await checkpoint(finalState); } catch { safe = uncertain(); }
    safe.contact = contactLink(contactId); safe.recruit = ticketLink(ticketId);
    throw safe;
  }
}

function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...PRIVATE_HEADERS, ...extra } }); }
export async function handleRecruitIntakeRequest(request, { getUser, createData, ...options }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use Add Recruits to submit recruits.' } }, 405, { Allow: 'POST' });
  let requestId;
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before adding recruits.' }, signInPath: '/sign-in' }, 401);
    if (!recruitIntakeCapability(user, options)) throw new RecruitIntakeError('INTAKE_DISABLED', 'Adding recruits is disabled for this account or environment.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new RecruitIntakeError('ORIGIN_NOT_ALLOWED', 'Open this app directly before adding recruits.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new RecruitIntakeError('INVALID_REQUEST', 'Send a JSON recruit entry.', 415);
    let input;
    try { input = validateRecruitIntakeInput(await boundedJson(request, 4096)); }
    catch (error) { if (error instanceof RecruitIntakeInputError) throw error; if (error instanceof RangeError) throw new RecruitIntakeError('INVALID_REQUEST', 'The recruit entry is too large.', 413); throw new RecruitIntakeInputError(); }
    requestId = input.requestId;
    const result = await createData(input, { userId: user.userId, ledger: options.ledger });
    return json(result, result.replayed || result.status === 'already_exists' ? 200 : 201);
  } catch (error) {
    const safe = error instanceof RecruitIntakeError || error instanceof RecruitIntakeInputError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message, ...(safe.fieldErrors ? { fieldErrors: safe.fieldErrors } : {}) }, ...(requestId ? { requestId } : {}), ...(safe.contact ? { contact: safe.contact } : {}), ...(safe.recruit ? { recruit: safe.recruit } : {}), ...(safe.canResume ? { canResume: true } : {}), ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
