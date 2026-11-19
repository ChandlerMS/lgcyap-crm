import { createHmac } from 'node:crypto';
import { isAllowedOrigin, readViewerOwnerIds } from './hubspot.mjs';
import { WriteError } from './hubspot-write.mjs';
import { toolWriteCapability, verifyToolWriteAccess } from './hubspot-tool-write.mjs';
import { PIPELINE_ID, PORTAL_ID } from './recruiting-config.mjs';

// Quick note, Add task and Follow-up from a recruit's row on the dashboard. Each creates one HubSpot
// note or task on the recruit's Recruiting ticket (and its contact). Tasks and follow-ups are assigned
// to the signed-in user. The write ledger keeps a retried request from creating a second record.
const API = 'https://api.hubapi.com';
const ZONE = 'America/New_York';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
export const QUICK_ACTION_KINDS = Object.freeze(['note', 'task', 'follow-up', 'meeting']);
// HubSpot-defined associations from each activity to its recruiting ticket and contact.
const ASSOCIATION_TYPES = Object.freeze({ note: { ticket: 228, contact: 202 }, task: { ticket: 230, contact: 204 }, meeting: { ticket: 216, contact: 200 } });
const HEADERS = Object.freeze({ 'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
const safeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const paragraphs = text => text.split(/\n{2,}/).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('');
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', hourCycle: 'h23' });
const invalid = message => new WriteError('INVALID_QUICK_ACTION', message ?? 'Check the note or task and try again.', 400);
const uncertain = () => new WriteError('SAVE_UNCERTAIN', 'HubSpot may have saved this. Check the recruit in HubSpot before trying again.', 502, { uncertain: true });
const unavailable = () => new WriteError('SAVE_UNAVAILABLE', 'Saving is unavailable right now. Try again shortly.', 503);

export function easternToday(now) { return DAY.format(now); }
const addDays = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** 9:00 AM Eastern on a calendar day, in either standard or daylight time. */
export function easternNineAm(day) {
  const [year, month, date] = day.split('-').map(Number);
  for (const offset of [4, 5]) { const time = Date.UTC(year, month - 1, date, 9 + offset); if (Number(HOUR.format(time)) === 9) return time; }
  return Date.UTC(year, month - 1, date, 14);
}

function text(value, { label, max, required = false, multiline = false }) {
  if (value === undefined || value === null || value === '') { if (required) throw invalid(`Enter ${label}.`); return ''; }
  if (typeof value !== 'string') throw invalid();
  const trimmed = value.replace(/\r\n?/g, '\n').trim();
  if (required && !trimmed) throw invalid(`Enter ${label}.`);
  if ([...trimmed].length > max) throw invalid(`Keep ${label} within ${max} characters.`);
  if (CONTROLS.test(trimmed) || (!multiline && /\n/.test(trimmed))) throw invalid(`Remove unusual characters from ${label}.`);
  return trimmed;
}

/** Fixed fields only: kind, the text, a subject for tasks and a due date for tasks and follow-ups. */
export function validateQuickAction(input, { today }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'kind', 'body', 'subject', 'dueDate', 'startsAt', 'endsAt', 'location'].includes(key))) throw invalid();
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId) || !QUICK_ACTION_KINDS.includes(input.kind)) throw invalid();
  const kind = input.kind;
  const body = text(input.body, { label: kind === 'note' ? 'the note' : 'the notes', max: 5000, required: kind === 'note', multiline: true });
  const subject = ['task', 'meeting'].includes(kind) ? text(input.subject, { label: kind === 'meeting' ? 'a meeting title' : 'a task title', max: 200, required: true }) : '';
  if (kind === 'note' && (input.subject || input.dueDate)) throw invalid();
  if (kind === 'follow-up' && input.subject) throw invalid();
  let dueDate = '';
  if (kind !== 'meeting' && ['startsAt', 'endsAt', 'location'].some(key => input[key] !== undefined)) throw invalid();
  if (kind === 'meeting') {
    if (input.dueDate !== undefined) throw invalid();
    const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (!validTime(input.startsAt) || !validTime(input.endsAt) || input.endsAt <= input.startsAt) throw invalid('Choose an end time after the meeting start.');
    if (input.startsAt.slice(0,10) < addDays(today, -1) || input.endsAt.slice(0,10) > addDays(today, 730)) throw invalid('Choose a meeting date within two years.');
    return { requestId: input.requestId.toLowerCase(), kind, body, subject, dueDate: '', startsAt: input.startsAt, endsAt: input.endsAt, location: text(input.location, {label: 'the location', max: 500}) };
  }
  if (kind !== 'note') {
    dueDate = typeof input.dueDate === 'string' ? input.dueDate : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || new Date(`${dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== dueDate) throw invalid('Choose a due date.');
    if (dueDate < today) throw invalid('Choose today or a later date.');
    if (dueDate > addDays(today, 730)) throw invalid('Choose a date within two years.');
  }
  return { requestId: input.requestId.toLowerCase(), kind, body, subject, dueDate };
}

async function hubspot(path, { method = 'GET', body } = {}, { accessToken, fetchImpl, timeoutMs }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${API}${path}`, { method, redirect: 'manual', cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } finally { clearTimeout(timer); }
}

/** The recruit's name and contacts, read fresh; only tickets in the Recruiting pipeline qualify. */
async function readRecruit(id, options) {
  let response;
  try { response = await hubspot(`/crm/v3/objects/tickets/${id}?properties=hs_pipeline,subject,recruit_name&associations=contacts&archived=false`, {}, options); }
  catch { throw new WriteError('HUBSPOT_UNAVAILABLE', 'HubSpot could not be reached. Try again shortly.', 502); }
  if (response.status === 404) throw new WriteError('RECORD_NOT_FOUND', 'This recruit is no longer in HubSpot.', 404);
  if (response.status === 429) throw new WriteError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait a moment, then try again.', 429, { retryAfterSeconds: 10 });
  if (!response.ok) throw new WriteError('HUBSPOT_UNAVAILABLE', 'HubSpot could not read this recruit. Try again shortly.', 502);
  const raw = await response.json().catch(() => null);
  if (String(raw?.id) !== id || raw.archived || raw.properties?.hs_pipeline !== PIPELINE_ID) throw new WriteError('RECORD_NOT_FOUND', 'This recruit is not in the Recruiting pipeline.', 404);
  const contacts = [...new Set((raw.associations?.contacts?.results ?? []).map(item => String(item?.id ?? '')).filter(safeId))].slice(0, 5);
  const name = String(raw.properties.recruit_name || raw.properties.subject || '').replace(/^Recruiting:\s*/i, '').trim().slice(0, 150) || 'this recruit';
  return { name, contacts };
}

function associations(kind, recruitId, contacts) {
  const types = ASSOCIATION_TYPES[kind === 'note' ? 'note' : kind === 'meeting' ? 'meeting' : 'task'];
  return [
    { to: { id: recruitId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: types.ticket }] },
    ...contacts.map(id => ({ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: types.contact }] })),
  ];
}

/** Creates one note or task. A repeated request ID returns its earlier outcome instead of creating another record. */
export async function createQuickAction(recruitId, rawInput, { user, accessToken, hmacSecret, ledger, fetchImpl = fetch, now = Date.now, timeoutMs = 8000 }) {
  if (!safeId(recruitId)) throw new WriteError('RECORD_NOT_FOUND', 'This recruit is unavailable.', 404);
  const input = validateQuickAction(rawInput, { today: easternToday(now()) });
  if (!user || typeof user.userId !== 'string' || typeof hmacSecret !== 'string' || hmacSecret.length < 32 || typeof ledger?.claim !== 'function' || typeof ledger?.finish !== 'function') throw unavailable();
  const options = { accessToken, fetchImpl, timeoutMs, now };
  await verifyToolWriteAccess('tasks', options);
  const recruit = await readRecruit(recruitId, options);
  let ownerId = null;
  if (input.kind !== 'note') {
    const owners = await readViewerOwnerIds(user.email, options).catch(() => ({ ids: [], complete: false }));
    ownerId = owners.ids[0] ?? null;
    if (!ownerId) throw new WriteError('HUBSPOT_OWNER_NOT_FOUND', owners.complete ? 'Your sign-in email does not match a HubSpot user, so this activity cannot be assigned to you.' : 'Your HubSpot user could not be confirmed. Try again shortly.', owners.complete ? 403 : 502);
  }
  const hash = createHmac('sha256', hmacSecret).update('legacy-recruit-quick-action:v1\0').update(JSON.stringify([recruitId, input.kind, input.body, input.subject, input.dueDate, ...(input.kind === 'meeting' ? [input.startsAt, input.endsAt, input.location] : [])])).digest('hex');
  const identity = { userId: user.userId, requestId: input.requestId, hash };
  let claim;
  try { claim = await ledger.claim({ ...identity, ticketId: `quick:${recruitId}`, now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.hash && claim.hash !== hash) throw new WriteError('REQUEST_ID_REUSED', 'This form was already used for different details. Close it and start again.', 409);
    if (claim.status === 'saved') return { status: 'saved', kind: input.kind, replayed: true, hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-5/${recruitId}` };
    if (claim.status === 'uncertain') throw uncertain();
    if (claim.status === 'failed') throw new WriteError('QUICK_ACTION_FAILED', 'This save already failed. Close the form and start again.', 409);
    throw new WriteError('QUICK_ACTION_BUSY', 'Another note or task for this recruit is being saved. Try again in a moment.', 409);
  }
  const finish = async status => { try { return await ledger.finish({ ...identity, status, now: now() }); } catch { return false; } };
  const by = escapeHtml(user.displayName || user.email || 'a recruiting editor');
  const kindPath = input.kind === 'note' ? 'notes' : input.kind === 'meeting' ? 'meetings' : 'tasks';
  const properties = input.kind === 'note'
    ? { hs_timestamp: new Date(now()).toISOString(), hs_note_body: `${paragraphs(input.body)}<p><em>Added in the CRM by ${by}</em></p>` }
    : input.kind === 'meeting' ? { hs_timestamp: input.startsAt, hs_meeting_title: input.subject, hs_meeting_start_time: input.startsAt, hs_meeting_end_time: input.endsAt, hs_meeting_location: input.location, hs_meeting_body: `${input.body ? paragraphs(input.body) : ''}<p><em>Meeting added in the CRM by ${by}</em></p>`, hubspot_owner_id: ownerId } : {
      hs_timestamp: new Date(easternNineAm(input.dueDate)).toISOString(),
      hs_task_subject: input.kind === 'task' ? input.subject : `Follow up with ${recruit.name}`,
      hs_task_body: `${input.body ? paragraphs(input.body) : ''}<p><em>${input.kind === 'task' ? 'Task' : 'Follow-up'} added in the CRM by ${by}</em></p>`,
      hs_task_status: 'NOT_STARTED', hs_task_type: input.kind === 'follow-up' ? 'CALL' : 'TODO', hubspot_owner_id: ownerId,
    };
  let response;
  try { response = await hubspot(`/crm/v3/objects/${kindPath}`, { method: 'POST', body: { properties, associations: associations(input.kind, recruitId, recruit.contacts) } }, options); }
  catch { await finish('uncertain'); throw uncertain(); }
  if (response.status >= 400 && response.status < 500) {
    await finish('failed');
    if (response.status === 429) throw new WriteError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait a moment, then try again.', 429, { retryAfterSeconds: 10 });
    if (response.status === 401 || response.status === 403) throw new WriteError('HUBSPOT_WRITE_ACCESS_REQUIRED', 'HubSpot has not allowed this save. Ask the app owner to check the CRM’s HubSpot access.', 403);
    throw new WriteError('HUBSPOT_REJECTED', 'HubSpot did not accept this. Review it and try again.', 409);
  }
  const created = await response.json().catch(() => null);
  if (![200, 201].includes(response.status) || !safeId(String(created?.id ?? ''))) { await finish('uncertain'); throw uncertain(); }
  if (!await finish('saved')) throw uncertain();
  return { status: 'saved', kind: input.kind, id: String(created.id), subject: properties.hs_task_subject ?? null, dueDate: input.dueDate || null, hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-5/${recruitId}` };
}

function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } }); }

/** Same editor, write-switch, production, origin and JSON checks as other CRM writes. */
export async function handleQuickActionRequest(request, recruitId, { getUser, saveData, ...options }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use the dashboard to add notes and tasks.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before adding notes or tasks.' }, signInPath: '/sign-in' }, 401);
    if (!toolWriteCapability('tasks', user, options)) throw new WriteError('QUICK_ACTIONS_DISABLED', 'Adding notes and tasks is not enabled for this account.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new WriteError('ORIGIN_NOT_ALLOWED', 'Open the CRM directly before adding notes or tasks.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw invalid();
    const reader = request.body?.getReader(); const decoder = new TextDecoder(); let body = '', size = 0;
    if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 32 * 1024) { await reader.cancel(); throw invalid('The note is too long.'); } body += decoder.decode(part.value, { stream: true }); }
    body += decoder.decode();
    let input;
    try { input = JSON.parse(body); } catch { throw invalid(); }
    const result = await saveData(recruitId, input, { user, ledger: options.ledger });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) {
    const safe = error instanceof WriteError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message }, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status ?? 503, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
