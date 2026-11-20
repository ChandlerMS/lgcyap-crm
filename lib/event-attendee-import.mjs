import { createRecruitIntake, RecruitIntakeError, recruitIntakeCapability } from './recruit-intake.mjs';
import { RecruitIntakeInputError } from './recruit-intake-input.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
import { OFFICES } from './recruiting-config.mjs';
import { easternDay, hubspotJson, noteKind } from './event-attendance.mjs';
import { validateAttendeeImportInput } from './event-attendee-input.mjs';

// Records one attendee from an imported sign-in list. The contact and recruiting ticket go
// through the same intake as Add Recruits (no duplicates, nothing overwritten); then a
// sign-in note for the event day is added unless that ticket already has one for that day.
const API = 'https://api.hubapi.com';
const NOTE_TO_TICKET = 228;
const NOTE_TO_CONTACT = 202;
const PRIVATE_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' });
const safeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const DATE_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const STAMP = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export class AttendeeImportError extends Error {
  constructor(code, message, status = 502, extra = {}) { super(message); this.name = 'AttendeeImportError'; this.code = code; this.status = status; Object.assign(this, extra); }
}
const unavailable = () => new AttendeeImportError('IMPORT_UNAVAILABLE', 'Importing is unavailable right now. Nothing was confirmed; try again later.', 503);

export function importedSignInNote(input, { importedBy, importedAt }) {
  const lines = [
    ['Event date', DATE_LABEL.format(Date.parse(`${input.eventDate}T12:00:00Z`))],
    ['Name', `${input.firstName} ${input.lastName}`],
    ['Email', input.email || 'Not given'],
    ['Phone', input.phone],
    ['Office', OFFICES[input.office]],
    ['Recorded by', `${importedBy}, ${STAMP.format(importedAt)}, from an imported sign-in list`],
  ];
  return '<p><strong>Hiring event sign-in (imported from a sign-in list)</strong></p>' + lines.map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`).join('');
}

/** Eastern days that already have a sign-in note on this ticket, read through direct associations. */
async function signInDays(ticketId, options) {
  const ids = [];
  let after = null;
  for (let page = 0; page < 5; page += 1) {
    const raw = await hubspotJson(`/crm/v4/objects/tickets/${ticketId}/associations/notes?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`, {}, options);
    if (!raw || !Array.isArray(raw.results) || raw.results.length > 500) throw unavailable();
    for (const row of raw.results) { const id = String(row?.toObjectId ?? ''); if (!safeId(id)) throw unavailable(); if (!ids.includes(id)) ids.push(id); }
    if (!raw.paging?.next) { after = null; break; }
    after = String(raw.paging.next.after ?? '');
    if (!after || after.length > 300 || page === 4) throw unavailable();
  }
  const days = new Set();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const group = ids.slice(offset, offset + 100);
    const raw = await hubspotJson('/crm/v3/objects/notes/batch/read', { method: 'POST', body: { properties: ['hs_note_body', 'hs_timestamp'], inputs: group.map(id => ({ id })) } }, options);
    if (!raw || !Array.isArray(raw.results)) throw unavailable();
    for (const row of raw.results) {
      if (!group.includes(String(row?.id ?? '')) || !row.properties) throw unavailable();
      if (!row.archived && noteKind(row.properties.hs_note_body) === 'sign-in') { const day = easternDay(row.properties.hs_timestamp); if (day) days.add(day); }
    }
  }
  return days;
}

async function createNote({ ticketId, contactId, html, timestamp }, { accessToken, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${API}/crm/v3/objects/notes`, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { hs_timestamp: new Date(timestamp).toISOString(), hs_note_body: html },
        associations: [
          { to: { id: ticketId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_TICKET }] },
          { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }] },
        ],
      }),
    });
  } catch {
    throw new AttendeeImportError('NOTE_UNCONFIRMED', 'The sign-in note may not have been saved. Import this row again: it will not add a second sign-in for the same day.', 502);
  } finally { clearTimeout(timer); }
  if (response.status === 429) {
    const value = response.headers.get('Retry-After');
    throw new AttendeeImportError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait a minute, then import the remaining rows.', 429, { retryAfterSeconds: /^\d{1,5}$/.test(value ?? '') ? Math.max(1, Number(value)) : 60 });
  }
  if (response.status >= 400 && response.status < 500) throw new AttendeeImportError('NOTE_REJECTED', 'HubSpot did not accept the sign-in note. The contact and recruiting ticket are ready; review them in HubSpot.', 409);
  let body = null;
  try { body = await response.json(); } catch { /* checked below */ }
  if (![200, 201].includes(response.status) || !safeId(String(body?.id ?? ''))) throw new AttendeeImportError('NOTE_UNCONFIRMED', 'The sign-in note may not have been saved. Import this row again: it will not add a second sign-in for the same day.', 502);
  return String(body.id);
}

export async function importAttendee(rawInput, { user, accessToken, hmacSecret, ledger, fetchImpl = fetch, now = Date.now, timeoutMs = 8000 }) {
  const input = validateAttendeeImportInput(rawInput, { today: easternDay(now()) });
  if (!user || typeof user.userId !== 'string') throw unavailable();
  const intake = await createRecruitIntake(
    { requestId: input.requestId, firstName: input.firstName, lastName: input.lastName, phone: input.phone, email: input.email, recruitingPath: 'genpop' },
    { userId: user.userId, accessToken, hmacSecret, ledger, fetchImpl, now, timeoutMs, ticketProperties: { orientation_office: input.office, source_type: 'FORM' } },
  );
  const contactId = intake?.contact?.id, ticketId = intake?.recruit?.id;
  if (!safeId(contactId) || !safeId(ticketId)) throw unavailable();
  const links = { contact: intake.contact, recruit: intake.recruit, ticketCreated: intake.status === 'created' };
  const options = { accessToken, fetchImpl, timeoutMs, now };
  try {
    if ((await signInDays(ticketId, options)).has(input.eventDate)) return { status: 'already_recorded', ...links };
    const html = importedSignInNote(input, { importedBy: user.displayName || user.email || 'A recruiting editor', importedAt: now() });
    // Noon UTC-5 keeps the note on the event's Eastern day in every season.
    const noteId = await createNote({ ticketId, contactId, html, timestamp: Date.parse(`${input.eventDate}T17:00:00Z`) }, options);
    return { status: 'added', noteId, ...links };
  } catch (error) {
    const safe = error instanceof AttendeeImportError ? error : new AttendeeImportError(error?.code === 'HUBSPOT_RATE_LIMITED' ? 'HUBSPOT_RATE_LIMITED' : 'SIGN_IN_CHECK_FAILED',
      error?.code === 'HUBSPOT_RATE_LIMITED' ? 'HubSpot is limiting requests. Wait a minute, then import the remaining rows.' : 'The contact and recruiting ticket are ready, but the sign-in could not be checked. Import this row again.',
      error?.code === 'HUBSPOT_RATE_LIMITED' ? 429 : 502, error?.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {});
    Object.assign(safe, links);
    throw safe;
  }
}

function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...PRIVATE_HEADERS, ...extra } }); }
async function boundedJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); throw new RangeError('Body too large'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Same sign-in, editor, write-access, origin and JSON checks as Add Recruits. */
export async function handleAttendeeImportRequest(request, { getUser, importData, ...options }) {
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use Import attendees on the Event Attendance page.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before importing attendees.' }, signInPath: '/sign-in' }, 401);
    if (!recruitIntakeCapability(user, options)) throw new AttendeeImportError('IMPORT_DISABLED', 'Importing attendees is disabled for this account or environment.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new AttendeeImportError('ORIGIN_NOT_ALLOWED', 'Open this app directly before importing attendees.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new AttendeeImportError('INVALID_REQUEST', 'Send one attendee as JSON.', 415);
    let input;
    try { input = await boundedJson(request, 4096); }
    catch (error) { if (error instanceof RangeError) throw new AttendeeImportError('INVALID_REQUEST', 'The attendee entry is too large.', 413); throw new RecruitIntakeInputError(); }
    const result = await importData(input, { user });
    return json(result, result.status === 'added' ? 201 : 200);
  } catch (error) {
    const safe = error instanceof AttendeeImportError || error instanceof RecruitIntakeError || error instanceof RecruitIntakeInputError ? error : unavailable();
    return json({
      error: { code: safe.code, message: safe.message, ...(safe.fieldErrors && Object.keys(safe.fieldErrors).length ? { fieldErrors: safe.fieldErrors } : {}) },
      ...(safe.contact ? { contact: safe.contact } : {}), ...(safe.recruit ? { recruit: safe.recruit } : {}),
      ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}),
    }, safe.status ?? 503, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
