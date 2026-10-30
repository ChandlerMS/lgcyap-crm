import { PORTAL_ID, PIPELINE_ID } from './recruiting-config.mjs';
import { providerJson } from './hubspot-tools.mjs';
import { isAllowedOrigin } from './hubspot.mjs';

const BASE = 'https://api.hubapi.com';
const COMMON = ['hs_timestamp', 'hubspot_owner_id'];
export const ACTIVITY_TYPES = Object.freeze({
  notes: { objectId: '0-46', title: null, body: 'hs_note_body', fields: ['hs_note_body'] },
  calls: { objectId: '0-48', title: 'hs_call_title', body: 'hs_call_body', fields: ['hs_call_title', 'hs_call_body', 'hs_call_status', 'hs_call_direction', 'hs_call_duration', 'hs_call_recording_url', 'recording_url', 'hs_call_has_transcript', 'hs_call_summary'] },
  emails: { objectId: '0-49', title: 'hs_email_subject', body: 'hs_email_text', fields: ['hs_email_subject', 'hs_email_text', 'hs_email_status'] },
  tasks: { objectId: '0-27', title: 'hs_task_subject', body: 'hs_task_body', fields: ['hs_task_subject', 'hs_task_body', 'hs_task_status'] },
  meetings: { objectId: '0-47', title: 'hs_meeting_title', body: 'hs_meeting_body', fields: ['hs_meeting_title', 'hs_meeting_body', 'hs_meeting_outcome'] },
});
const validId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const text = value => typeof value === 'string' ? value.slice(0, 65536) : '';
export function activityText(value) {
  // Render as React text, never HTML. Keep paragraph boundaries from CRM rich text.
  return text(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/?(?:p|div|br|li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}
function fail(message, status = 502) { const error = new Error(message); error.status = status; throw error; }
export function normalizeActivity(kind, record) {
  const config = ACTIVITY_TYPES[kind], p = record.properties;
  if (!config || !validId(String(record.id)) || !p || typeof p !== 'object') fail('HubSpot returned an invalid activity.');
  const time = Date.parse(p.hs_timestamp ?? record.createdAt);
  const recording = Boolean(text(p.hs_call_recording_url) || text(p.recording_url));
  return { id: String(record.id), kind, title: activityText(p[config.title]) || (kind === 'notes' ? 'Note' : kind.slice(0, -1)), body: activityText(p[config.body]), occurredAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
    status: text(p.hs_call_status || p.hs_email_status || p.hs_task_status || p.hs_meeting_outcome), direction: text(p.hs_call_direction),
    recordingAvailable: recording, transcriptAvailable: p.hs_call_has_transcript === 'true' || p.hs_call_has_transcript === true, summary: activityText(p.hs_call_summary),
    hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/${config.objectId}/${record.id}` };
}

/** One resumable association page; no account-wide activity search or name matching. */
export async function readRecruitActivity(recruitId, input, { accessToken = '', fetchImpl = fetch, timeoutMs = 7000 } = {}) {
  if (!validId(recruitId) || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['kind', 'source', 'after'].includes(k))) fail('Invalid activity request.', 400);
  const { kind = 'notes', source = 'ticket', after = null } = input;
  if (!Object.hasOwn(ACTIVITY_TYPES, kind) || !['ticket', 'contact'].includes(source) || after !== null && (typeof after !== 'string' || !/^\d{1,30}$/.test(after))) fail('Invalid activity page.', 400);
  if (!accessToken) fail('The HubSpot connection is not configured.', 503);
  const options = { accessToken, fetchImpl, timeoutMs };
  const read = (path, body) => providerJson(`${BASE}${path}`, { ...options, ...(body ? { method: 'POST', body } : {}) });
  const ticket = await read(`/crm/v3/objects/tickets/${recruitId}?properties=hs_pipeline&archived=false`);
  if (String(ticket.id) !== recruitId || ticket.archived || ticket.properties?.hs_pipeline !== PIPELINE_ID) fail('Recruit not found in the Recruiting pipeline.', 404);
  let object = 'tickets', sourceId = recruitId;
  if (source === 'contact') {
    const association = await read('/crm/v4/associations/tickets/contacts/batch/read', { inputs: [{ id: recruitId }] });
    const matching = association.results?.filter(row => String(row.from?.id) === recruitId);
    if (association.status !== 'COMPLETE' || association.errors?.length || !Array.isArray(matching) || matching.length !== 1 || !Array.isArray(matching[0].to)) fail('Contact association could not be verified.');
    const links = matching[0];
    const ids = [...new Set(links.to.map(row => String(row.toObjectId)))];
    if (ids.some(id => !validId(id))) fail('Invalid contact association.');
    if (links.paging?.next || ids.length > 1) return { records: [], next: null, notice: 'This recruit has multiple linked contacts. Contact history is withheld until the correct contact is selected in HubSpot.' };
    if (!ids.length) return { records: [], next: null, notice: 'No linked HubSpot contact. Ticket activity is still available.' };
    object = 'contacts'; sourceId = ids[0];
  }
  const query = new URLSearchParams({ limit: '50', ...(after ? { after } : {}) });
  const associations = await read(`/crm/v4/objects/${object}/${sourceId}/associations/${kind}?${query}`);
  if (!Array.isArray(associations.results) || associations.results.length > 50) fail('HubSpot returned an invalid activity page.');
  const ids = [...new Set(associations.results.map(row => String(row.toObjectId)))];
  if (ids.some(id => !validId(id))) fail('HubSpot returned an invalid activity association.');
  const cursor = associations.paging?.next?.after;
  const next = cursor === undefined || cursor === null ? null : String(cursor);
  if (next && (!/^\d{1,30}$/.test(next) || next === after || !ids.length)) fail('HubSpot returned a repeated or invalid activity cursor. Refresh before continuing.');
  let records = [];
  if (ids.length) {
    const batch = await read(`/crm/v3/objects/${kind}/batch/read`, { properties: [...COMMON, ...ACTIVITY_TYPES[kind].fields], inputs: ids.map(id => ({ id })) });
    if (batch.status !== 'COMPLETE' || batch.errors?.length || !Array.isArray(batch.results) || batch.results.length > ids.length || batch.results.some(row => !ids.includes(String(row.id)))) fail('Some linked activities could not be loaded. Refresh to retry.');
    records = batch.results.filter(row => !row.archived).map(row => normalizeActivity(kind, row));
  }
  return { records, next, notice: source === 'ticket' ? 'Activities linked to this recruiting ticket.' : 'Activities linked to this recruit’s verified HubSpot contact.' };
}

export async function handleRecruitActivity(request, recruitId, { getUser, authorizeUser, allowedOrigin, readData }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
  if (request.method !== 'POST') return json({ error: 'Use POST for this read.' }, 405);
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to view activity.' }, 401);
    if (!authorizeUser(user) || !isAllowedOrigin(request, allowedOrigin)) return json({ error: 'Access denied.' }, 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Use JSON.' }, 415);
    const reader = request.body?.getReader(); let body = '', size = 0; const decoder = new TextDecoder();
    if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); } body += decoder.decode(part.value, { stream: true }); }
    body += decoder.decode();
    let input; try { input = JSON.parse(body); } catch { return json({ error: 'Invalid request.' }, 400); }
    return json(await readData(recruitId, input));
  } catch (error) {
    const status = [400, 401, 403, 404, 429, 503].includes(error.status) ? error.status : 502;
    return json({ error: status === 429 ? 'HubSpot is limiting requests. Wait before trying again.' : status === 403 || status === 401 ? 'HubSpot activity access is unavailable for this connection.' : 'Activity could not be loaded. Refresh to retry.' }, status);
  }
}
