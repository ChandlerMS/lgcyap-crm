import { OFFICES, PIPELINE_ID, STAGE_PAGES, STAGES } from './recruiting-config.mjs';
import { RecruitingError } from './hubspot.mjs';

// Hiring-event attendance and online applications, counted from the notes the
// sign-in and application pages add to each person's recruiting ticket. Every
// sign-in and every application writes one note, including when the person
// already had an open ticket, so the notes are the complete record. Only counts
// leave the server: note text, names and contact details stay here.
const BASE = 'https://api.hubapi.com';
export const EVENT_ATTENDANCE_SINCE_DAY = '2026-11-10';
// Midnight Eastern on the day the hiring-event sign-in page went live.
export const EVENT_ATTENDANCE_SINCE = Date.parse('2026-11-10T05:00:00Z');
export const EVENT_TIME_ZONE = 'America/New_York';
// Each form note opens with a fixed heading; the rest of the note is never sent to the browser.
const SIGN_IN_NOTE = /^Hiring event sign-in\b/i;
const APPLICATION_NOTE = /^Agent application \(v[\d.]+\) submitted online\b/i;
const OFFICE_LINE = /<strong>\s*Office:\s*<\/strong>\s*([^<]{1,60})</i;
const COMPLETED_STAGE_ID = STAGE_PAGES.find(page => page.id === 'completed').stageId;
const PAGE_SIZE = 100;
const PAGE_LIMIT = 20;
const BATCH_SIZE = 100;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const validId = value => /^[1-9]\d{0,19}$/.test(value);
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: EVENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function easternDay(value) {
  const time = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? DAY.format(time) : null;
}

function retryDelay(value, now) {
  if (!value) return 60;
  if (/^\d+$/.test(value)) return Math.max(1, Math.min(86400, Number(value)));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.min(86400, Math.ceil((date - now) / 1000))) : 60;
}

const invalid = () => new RecruitingError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected response. Please try Refresh.', 502);

async function post(path, body, { accessToken, fetchImpl, timeoutMs, now }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${BASE}${path}`, {
      // Manual redirects keep the bearer credential from following one; non-2xx is rejected below.
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      throw new RecruitingError('HUBSPOT_ACCESS_REQUIRED', 'The HubSpot connection needs attention. Ask the app owner to check that it can read tickets and notes.', 502);
    }
    if (response.status === 429) {
      throw new RecruitingError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before using Refresh again.', 429, retryDelay(response.headers.get('Retry-After'), now()));
    }
    if (!response.ok) throw new RecruitingError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this read. Please try Refresh later.', 502);
    const reader = response.body?.getReader();
    if (!reader) throw invalid();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw invalid(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid(); }
  } catch (error) {
    if (error instanceof RecruitingError) throw error;
    if (controller.signal.aborted) throw new RecruitingError('HUBSPOT_TIMEOUT', 'The HubSpot read took too long. Please try Refresh later.', 504);
    throw new RecruitingError('HUBSPOT_UNAVAILABLE', 'HubSpot could not complete this read. Please try Refresh later.', 502);
  } finally { clearTimeout(timer); }
}

/** Notes the form integration wrote since the sign-in page went live. */
async function readFormNotes(options) {
  const notes = [];
  const cursors = new Set();
  let after;
  let total = 0;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const payload = await post('/crm/v3/objects/notes/search', {
      filterGroups: [{ filters: [
        { propertyName: 'hs_object_source_label', operator: 'EQ', value: 'INTEGRATION' },
        { propertyName: 'hs_createdate', operator: 'GTE', value: String(EVENT_ATTENDANCE_SINCE) },
      ] }],
      properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'],
      sorts: ['hs_object_id'], limit: PAGE_SIZE, ...(after === undefined ? {} : { after }),
    }, options);
    if (!payload || !Array.isArray(payload.results) || payload.results.length > PAGE_SIZE || !Number.isSafeInteger(payload.total) || payload.total < 0) throw invalid();
    total = payload.total;
    notes.push(...payload.results);
    const cursor = payload.paging?.next?.after;
    if (cursor === undefined || cursor === null || cursor === '') return { notes, partial: false };
    after = String(cursor);
    if (!/^\d{1,20}$/.test(after) || cursors.has(after) || payload.results.length === 0) throw invalid();
    cursors.add(after);
  }
  return { notes, partial: notes.length < total };
}

function chunks(values) {
  const out = [];
  for (let index = 0; index < values.length; index += BATCH_SIZE) out.push(values.slice(index, index + BATCH_SIZE));
  return out;
}

/** Ticket IDs linked to each note. A note with no ticket is simply absent from the results. */
async function readNoteTickets(noteIds, options) {
  const links = new Map(noteIds.map(id => [id, []]));
  for (const ids of chunks(noteIds)) {
    const payload = await post('/crm/v4/associations/notes/tickets/batch/read', { inputs: ids.map(id => ({ id })) }, options);
    if (!payload || !Array.isArray(payload.results)) throw invalid();
    for (const row of payload.results) {
      const from = String(row?.from?.id ?? '');
      if (!links.has(from) || !Array.isArray(row.to)) throw invalid();
      for (const target of row.to) {
        const ticketId = String(target?.toObjectId ?? '');
        if (!validId(ticketId)) throw invalid();
        if (!links.get(from).includes(ticketId)) links.get(from).push(ticketId);
      }
    }
  }
  return links;
}

/** Current pipeline, stage and office of each linked ticket. Deleted tickets are left out. */
async function readTickets(ticketIds, options) {
  const tickets = new Map();
  for (const ids of chunks(ticketIds)) {
    const payload = await post('/crm/v3/objects/tickets/batch/read', {
      properties: ['hs_pipeline', 'hs_pipeline_stage', 'orientation_office'], inputs: ids.map(id => ({ id })),
    }, options);
    if (!payload || !Array.isArray(payload.results)) throw invalid();
    for (const row of payload.results) {
      const id = String(row?.id ?? '');
      if (!ids.includes(id) || !row.properties || typeof row.properties !== 'object') throw invalid();
      if (row.archived) continue;
      tickets.set(id, { pipeline: String(row.properties.hs_pipeline ?? ''), stageId: String(row.properties.hs_pipeline_stage ?? ''), office: String(row.properties.orientation_office ?? '') });
    }
  }
  return tickets;
}

export function noteKind(body) {
  const heading = String(body ?? '').slice(0, 600).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return SIGN_IN_NOTE.test(heading) ? 'sign-in' : APPLICATION_NOTE.test(heading) ? 'application' : null;
}

function officeKey(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (Object.hasOwn(OFFICES, text)) return text;
  return Object.entries(OFFICES).find(([, label]) => label.toLowerCase() === text)?.[0] ?? null;
}

/** Classifies raw notes and builds the counts. Kept separate from the reads so it can be tested directly. */
export function summarizeEventAttendance({ notes, noteTickets, tickets, partial = false, fetchedAt }) {
  const events = [];
  for (const note of notes) {
    const id = String(note?.id ?? '');
    const body = String(note?.properties?.hs_note_body ?? '');
    const kind = noteKind(body);
    if (!kind || !validId(id)) continue;
    const day = easternDay(note.properties.hs_timestamp || note.properties.hs_createdate || note.createdAt);
    if (!day || day < EVENT_ATTENDANCE_SINCE_DAY) continue;
    // Only tickets still in the Recruiting pipeline count toward people and stages.
    const all = noteTickets.get(id) ?? [];
    const linked = all.filter(ticketId => tickets.get(ticketId)?.pipeline === PIPELINE_ID);
    events.push({ kind, day, linked, hasTicket: all.length > 0, office: kind === 'sign-in' ? officeKey(OFFICE_LINE.exec(body)?.[1]) : null });
  }
  const signedInTickets = new Set(events.filter(event => event.kind === 'sign-in').flatMap(event => event.linked));
  const appliedTickets = new Set(events.filter(event => event.kind === 'application').flatMap(event => event.linked).filter(id => signedInTickets.has(id)));
  const days = new Map();
  const dayRow = day => {
    if (!days.has(day)) days.set(day, { day, offices: {}, signIns: 0, applications: 0 });
    return days.get(day);
  };
  const applications = { total: 0, fromAttendees: 0, otherTickets: 0, noTicket: 0 };
  for (const event of events) {
    const row = dayRow(event.day);
    if (event.kind === 'sign-in') {
      const office = event.office ?? officeKey(event.linked.map(id => tickets.get(id)?.office).find(Boolean)) ?? 'other';
      row.offices[office] = (row.offices[office] ?? 0) + 1;
      row.signIns += 1;
    } else {
      row.applications += 1;
      applications.total += 1;
      if (event.linked.some(id => signedInTickets.has(id))) applications.fromAttendees += 1;
      else if (event.hasTicket) applications.otherTickets += 1;
      else applications.noTicket += 1;
    }
  }
  const stageCounts = new Map();
  for (const id of signedInTickets) {
    const stageId = tickets.get(id).stageId;
    stageCounts.set(stageId, (stageCounts.get(stageId) ?? 0) + 1);
  }
  const order = STAGE_PAGES.map(page => page.stageId);
  const rank = stageId => { const index = order.indexOf(stageId); return index === -1 ? order.length : index; };
  const stages = [...stageCounts].map(([stageId, count]) => ({ stageId, label: STAGES[stageId] ?? 'Other stage', count }))
    .sort((a, b) => rank(a.stageId) - rank(b.stageId) || a.label.localeCompare(b.label));
  const used = new Set([...days.values()].flatMap(row => Object.keys(row.offices)));
  const offices = ['orlando', 'miami', ...Object.keys(OFFICES).filter(key => key !== 'orlando' && key !== 'miami' && used.has(key)), ...(used.has('other') ? ['other'] : [])]
    .map(key => ({ key, label: OFFICES[key] ?? 'Office not recorded' }));
  return {
    fetchedAt, since: EVENT_ATTENDANCE_SINCE_DAY, timeZone: EVENT_TIME_ZONE, partial,
    people: { signedIn: signedInTickets.size, applied: appliedTickets.size, hired: [...signedInTickets].filter(id => tickets.get(id).stageId === COMPLETED_STAGE_ID).length },
    signIns: events.filter(event => event.kind === 'sign-in').length,
    applications, stages, offices,
    days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
  };
}

export async function readEventAttendance({ accessToken = '', fetchImpl = fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) {
    throw new RecruitingError('CONNECTION_NOT_CONFIGURED', 'The secure HubSpot connection has not been configured yet.', 503);
  }
  const options = { accessToken, fetchImpl, timeoutMs, now };
  const { notes, partial } = await readFormNotes(options);
  const relevant = notes.filter(note => validId(String(note?.id ?? '')) && noteKind(note?.properties?.hs_note_body));
  const noteTickets = relevant.length ? await readNoteTickets([...new Set(relevant.map(note => String(note.id)))], options) : new Map();
  const ticketIds = [...new Set([...noteTickets.values()].flat())];
  const tickets = ticketIds.length ? await readTickets(ticketIds, options) : new Map();
  return summarizeEventAttendance({ notes: relevant, noteTickets, tickets, partial, fetchedAt: new Date(now()).toISOString() });
}
