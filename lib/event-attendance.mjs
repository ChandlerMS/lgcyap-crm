import { completeNoteLinks } from './complete-note-links.mjs';
import { EVENT_REVIEW_TOKEN, parseEventReview, hasEventReviewProof, newerEventReview } from './event-review.mjs';
import { OFFICES, PIPELINE_ID, PORTAL_ID, STAGE_PAGES, STAGES } from './recruiting-config.mjs';
import { RecruitingError } from './hubspot.mjs';

// Hiring-event attendance and online applications, counted from the notes the
// sign-in and application pages add to each person's recruiting ticket. Every
// sign-in and every application writes one note, including when the person
// already had an open ticket, so the notes are the complete record. The page is
// for recruiting editors, who also see recruits in the workspace: it gets names,
// contact details, office, sign-in answers and stage. Application answers, and
// which required item someone missed, never leave the server.
const BASE = 'https://api.hubapi.com';
export const EVENT_ATTENDANCE_SINCE_DAY = '2026-11-10';
// Midnight Eastern on the day the hiring-event sign-in page went live.
export const EVENT_ATTENDANCE_SINCE = Date.parse('2026-11-10T05:00:00Z');
export const EVENT_TIME_ZONE = 'America/New_York';
// Each form note opens with a fixed heading.
const SIGN_IN_NOTE = /^Hiring event sign-in\b/i;
const APPLICATION_NOTE = /^Agent application \(v[\d.]+\) submitted online\b/i;
const IMPORTED_SIGN_IN = /^Hiring event sign-in \(imported\b/i;
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

const post = (path, body, options) => hubspotJson(path, { method: 'POST', body }, options);

/** One bounded HubSpot read. Failures become safe RecruitingErrors; nothing is retried. */
export async function hubspotJson(path, { method = 'GET', body } = {}, { accessToken, fetchImpl = fetch, timeoutMs = 12000, now = Date.now }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${BASE}${path}`, {
      // Manual redirects keep the bearer credential from following one; non-2xx is rejected below.
      method, redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
async function readFormNotes(options, reviews = false) {
  const notes = [];
  const cursors = new Set();
  let after, lastId, expectedTotal;
  let total = 0;
  for (let page = 0; options.strictComplete && !reviews || page < PAGE_LIMIT; page += 1) {
    const payload = await post('/crm/v3/objects/notes/search', {
      filterGroups: [{ filters: [
        { propertyName: 'hs_object_source_label', operator: 'EQ', value: 'INTEGRATION' },
        { propertyName: 'hs_createdate', operator: 'GTE', value: String(EVENT_ATTENDANCE_SINCE) },
        ...(options.strictComplete && !reviews ? [{ propertyName: 'hs_createdate', operator: 'LT', value: String(options.readAt) }, ...(lastId ? [{ propertyName: 'hs_object_id', operator: 'GT', value: lastId }] : [])] : []),
        ...(reviews ? [{ propertyName: 'hs_note_body', operator: 'CONTAINS_TOKEN', value: EVENT_REVIEW_TOKEN }] : []),
      ] }],
      properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'],
      sorts: reviews ? [{ propertyName: 'hs_object_id', direction: 'DESCENDING' }] : ['hs_object_id'], limit: PAGE_SIZE, ...(after === undefined || options.strictComplete && !reviews ? {} : { after }),
    }, options);
    if (!payload || !Array.isArray(payload.results) || payload.results.length > PAGE_SIZE || !Number.isSafeInteger(payload.total) || payload.total < 0) throw invalid();
    total = payload.total;
    if (options.strictComplete && !reviews) {
      expectedTotal ??= total;
      if (payload.status && payload.status !== 'COMPLETE' || payload.errors?.length || payload.numErrors > 0) throw invalid();
      for (const note of payload.results) {
        const id = String(note?.id ?? '');
        if (!validId(id) || lastId && BigInt(id) <= BigInt(lastId) || !note.properties || !Object.hasOwn(note.properties, 'hs_note_body') || note.properties.hs_note_body !== null && typeof note.properties.hs_note_body !== 'string') throw invalid();
        lastId = id;
      }
    }
    notes.push(...payload.results);
    const cursor = payload.paging?.next?.after;
    if (cursor === undefined || cursor === null || cursor === '') {
      if (options.strictComplete && !reviews && (notes.length !== expectedTotal || total !== payload.results.length)) throw invalid();
      return { notes, partial: reviews && notes.length < total };
    }
    after = String(cursor);
    if (!/^\d{1,20}$/.test(after) || (!(options.strictComplete && !reviews) && cursors.has(after)) || payload.results.length === 0) throw invalid();
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
async function readNoteTickets(noteIds, options, strict = false) {
  const links = new Map(noteIds.map(id => [id, []]));
  for (const ids of chunks(noteIds)) {
    const payload = await post('/crm/v4/associations/notes/tickets/batch/read', { inputs: ids.map(id => ({ id })) }, options);
    if (!payload || !Array.isArray(payload.results)) throw invalid();
    if (strict) {
      const complete = await completeNoteLinks(ids, payload, (noteId, after) => {
        const query = new URLSearchParams({ limit: '500', ...(after === null ? {} : { after }) });
        return hubspotJson(`/crm/v4/objects/notes/${noteId}/associations/tickets?${query}`, {}, options);
      });
      for (const [id, values] of complete) links.set(id, values);
      continue;
    }
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

/** Current pipeline, stage, office and recruit name of each linked ticket. Deleted tickets are left out. */
async function readTickets(ticketIds, options) {
  const tickets = new Map();
  const text = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';
  for (const ids of chunks(ticketIds)) {
    const payload = await post('/crm/v3/objects/tickets/batch/read', {
      properties: ['hs_pipeline', 'hs_pipeline_stage', 'orientation_office', 'subject', 'recruit_name', 'recruit_email', 'recruit_phone_number'], inputs: ids.map(id => ({ id })),
    }, options);
    if (!payload || !Array.isArray(payload.results)) throw invalid();
    if (options.strictComplete && (payload.status && payload.status !== 'COMPLETE' || payload.errors?.length || payload.numErrors > 0 || payload.results.length !== ids.length)) throw invalid();
    const seen = new Set();
    for (const row of payload.results) {
      const id = String(row?.id ?? '');
      if (!ids.includes(id) || !row.properties || typeof row.properties !== 'object' || options.strictComplete && seen.has(id)) throw invalid();
      seen.add(id);
      if (row.archived) continue;
      const p = row.properties;
      tickets.set(id, {
        pipeline: String(p.hs_pipeline ?? ''), stageId: String(p.hs_pipeline_stage ?? ''), office: String(p.orientation_office ?? ''),
        name: text(p.recruit_name) || text(p.subject).replace(/^Recruiting:\s*/i, ''), email: text(p.recruit_email), phone: text(p.recruit_phone_number),
      });
    }
  }
  return tickets;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
/** A note as plain text lines: "Key: value" lines from paragraphs, and label/value line pairs from lists. */
export function noteLines(body) {
  return String(body ?? '').slice(0, 40000)
    .replace(/<(?:\/p|br\s*\/?|\/li|\/div|\/h\d)\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const field = (lines, key) => { const line = lines.find(item => item.startsWith(`${key}:`)); return line ? line.slice(key.length + 1).trim().slice(0, 200) : ''; };
const answer = (lines, label) => { const index = lines.indexOf(label); return index >= 0 && index + 1 < lines.length ? lines[index + 1].slice(0, 200) : ''; };
// The apply site writes "Not answered" for a blank answer.
const given = value => value === 'Not answered' ? '' : value;
const ticketUrl = id => `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-5/${id}`;

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
export function summarizeEventAttendance({ notes, noteTickets, tickets, partial = false, fetchedAt, strictComplete = false }) {
  const events = [];
  for (const note of notes) {
    const id = String(note?.id ?? '');
    const body = String(note?.properties?.hs_note_body ?? '');
    const kind = noteKind(body);
    if (!kind || !validId(id)) continue;
    const time = Date.parse(String(note.properties.hs_timestamp || note.properties.hs_createdate || note.createdAt || ''));
    const day = easternDay(time);
    // The note's own time is the event day, so an imported list from an earlier event lands on that day.
    if (!day) { if (strictComplete) throw invalid(); else continue; }
    // Only tickets still in the Recruiting pipeline count toward people and stages.
    const all = noteTickets.get(id) ?? [];
    const linked = all.filter(ticketId => tickets.get(ticketId)?.pipeline === PIPELINE_ID).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    const lines = noteLines(body);
    const details = kind === 'sign-in'
      ? { name: field(lines, 'Name'), email: field(lines, 'Email'), phone: field(lines, 'Phone'), heardAbout: field(lines, 'How they heard about us'), license: field(lines, 'License'), source: field(lines, 'Signed in from'), imported: IMPORTED_SIGN_IN.test(lines[0] ?? '') }
      : { name: answer(lines, 'Full legal name'), email: answer(lines, 'Email address'), phone: answer(lines, 'Mobile phone'), license: given(answer(lines, 'Which best describes you today?')), location: [given(answer(lines, 'City')), given(answer(lines, 'State'))].filter(Boolean).join(', '), requirementsMet: /^Meets all required items/i.test(field(lines, 'Required items')) ? true : /^Did not meet/i.test(field(lines, 'Required items')) ? false : null };
    const office = kind === 'sign-in' ? officeKey(field(lines, 'Office')) : officeKey(answer(lines, 'Which office are you applying for?'));
    events.push({ noteId: id, kind, day, at: new Date(time).toISOString(), linked, hasTicket: all.length > 0, office, details });
  }
  const signedInTickets = new Set(events.filter(event => event.kind === 'sign-in').flatMap(event => event.linked.slice(0, 1)));
  const appliedTickets = new Set(events.filter(event => event.kind === 'application').flatMap(event => event.linked).filter(id => signedInTickets.has(id)));
  const days = new Map();
  const dayRow = day => {
    if (!days.has(day)) days.set(day, { day, offices: {}, signIns: 0, applications: 0 });
    return days.get(day);
  };
  const applications = { total: 0, fromAttendees: 0, otherTickets: 0, noTicket: 0 };
  const stageOf = ticketId => { const stageId = tickets.get(ticketId)?.stageId ?? ''; return { stageId, stage: stageId ? STAGES[stageId] ?? 'Other stage' : '' }; };
  const visits = [], applicants = [];
  for (const event of events) {
    const row = dayRow(event.day);
    const ticketId = event.linked[0] ?? null;
    const fallback = ticketId ? tickets.get(ticketId) : null;
    const person = { ticketId, day: event.day, at: event.at, name: event.details.name || fallback?.name || 'Name not recorded', email: event.details.email || fallback?.email || '', phone: event.details.phone || fallback?.phone || '', ...stageOf(ticketId), hubspotUrl: ticketId ? ticketUrl(ticketId) : null };
    if (event.kind === 'sign-in') {
      const office = event.office ?? officeKey(event.linked.map(id => tickets.get(id)?.office).find(Boolean)) ?? 'other';
      row.offices[office] = (row.offices[office] ?? 0) + 1;
      row.signIns += 1;
      visits.push({ ...person, noteId: event.noteId, office, heardAbout: event.details.heardAbout, license: event.details.license, source: event.details.source, imported: event.details.imported });
    } else {
      row.applications += 1;
      applications.total += 1;
      const fromAttendee = event.linked.some(id => signedInTickets.has(id));
      // The same three groups as the counts, so each count opens the people in it.
      const group = fromAttendee ? 'signed-in' : event.hasTicket ? 'new' : 'no-ticket';
      if (group === 'signed-in') applications.fromAttendees += 1;
      else if (group === 'new') applications.otherTickets += 1;
      else applications.noTicket += 1;
      applicants.push({ ...person, office: event.office ?? '', license: event.details.license, location: event.details.location, requirementsMet: event.details.requirementsMet, fromAttendee, group });
    }
  }
  // One entry per person who signed in, with their latest sign-in details and first application.
  const attendees = [...signedInTickets].map(ticketId => {
    const mine = visits.filter(visit => visit.ticketId === ticketId).sort((a, b) => b.at.localeCompare(a.at));
    const applied = applicants.filter(item => item.ticketId === ticketId).sort((a, b) => a.at.localeCompare(b.at))[0];
    const latest = mine[0];
    return { ticketId, name: latest.name, email: latest.email, phone: latest.phone, office: latest.office, ...stageOf(ticketId), signIns: mine.length, firstDay: mine.at(-1).day, lastDay: latest.day, appliedAt: applied?.at ?? null, hubspotUrl: ticketUrl(ticketId) };
  }).sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.name.localeCompare(b.name));
  visits.sort((a, b) => b.at.localeCompare(a.at));
  applicants.sort((a, b) => b.at.localeCompare(a.at));
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
  // Orlando, Miami and Tampa always have a column; a sign-in with no office gets one only when needed.
  const offices = [...['orlando', 'miami', 'tampa'], ...(used.has('other') ? ['other'] : [])]
    .map(key => ({ key, label: OFFICES[key] ?? 'Office not recorded' }));
  return {
    fetchedAt, since: EVENT_ATTENDANCE_SINCE_DAY, timeZone: EVENT_TIME_ZONE, partial,
    people: { signedIn: signedInTickets.size, applied: appliedTickets.size, hired: [...signedInTickets].filter(id => tickets.get(id).stageId === COMPLETED_STAGE_ID).length },
    signIns: events.filter(event => event.kind === 'sign-in').length,
    applications, stages, offices,
    days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
    attendees, visits, applicants,
  };
}

// If the global search window fills, resolve notes from the actual displayed
// tickets instead. Association pagination has no search-result-window cutoff.
async function readTicketReviewNotes(ticketIds, options) {
  const links = new Map();
  const addLinks = (ticketId, rows) => {
    if (!Array.isArray(rows)) throw invalid();
    for (const row of rows) {
      const id = String(row.toObjectId ?? '');
      if (!validId(id)) throw invalid();
      links.set(id, [...new Set([...(links.get(id) ?? []), ticketId])]);
    }
  };
  for (let offset = 0; offset < ticketIds.length; offset += BATCH_SIZE) {
    const batch = ticketIds.slice(offset, offset + BATCH_SIZE);
    const payload = await post('/crm/v4/associations/tickets/notes/batch/read', { inputs: batch.map(id => ({ id })) }, options);
    if (!Array.isArray(payload?.results) || payload.errors?.length || Number(payload.numErrors) > 0 || (payload.status && payload.status !== 'COMPLETE')) throw invalid();
    const seen = new Set();
    for (const row of payload.results) {
      const ticketId = String(row.from?.id ?? '');
      if (!batch.includes(ticketId) || seen.has(ticketId)) throw invalid();
      seen.add(ticketId); addLinks(ticketId, row.to);
      let cursor = row.paging?.next?.after;
      const cursors = new Set();
      while (cursor !== undefined && cursor !== null && cursor !== '') {
        const after = String(cursor);
        if (cursors.has(after)) throw invalid();
        cursors.add(after);
        const query = new URLSearchParams({ limit: '500', after });
        const next = await hubspotJson(`/crm/v4/objects/tickets/${ticketId}/associations/notes?${query}`, {}, options);
        addLinks(ticketId, next?.results);
        cursor = next.paging?.next?.after;
        if (cursor && !next.results.length) throw invalid();
      }
    }
    if (seen.size !== batch.length) throw invalid();
  }
  const notes = []; const ids = [...links.keys()];
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    const payload = await post('/crm/v3/objects/notes/batch/read', { properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'], inputs: batch.map(id => ({ id })) }, options);
    if (!Array.isArray(payload?.results) || payload.errors?.length || Number(payload.numErrors) > 0 || (payload.status && payload.status !== 'COMPLETE')) throw invalid();
    const seen = new Set(payload.results.map(note => String(note.id)));
    if (seen.size !== batch.length || batch.some(id => !seen.has(id))) throw invalid();
    notes.push(...payload.results);
  }
  return { notes, links };
}

export async function readEventAttendance({ accessToken = '', fetchImpl = fetch, now = Date.now, timeoutMs = 12000, strictComplete = false, includeReviews = false, reviewSecrets = /** @type {string[]} */ ([]) } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) {
    throw new RecruitingError('CONNECTION_NOT_CONFIGURED', 'The secure HubSpot connection has not been configured yet.', 503);
  }
  const options = { accessToken, fetchImpl, timeoutMs, now, strictComplete, readAt: now() };
  const { notes, partial } = await readFormNotes(options);
  const relevant = notes.filter(note => validId(String(note?.id ?? '')) && noteKind(note?.properties?.hs_note_body));
  const noteTickets = relevant.length ? await readNoteTickets([...new Set(relevant.map(note => String(note.id)))], options, strictComplete) : new Map();
  const ticketIds = [...new Set([...noteTickets.values()].flat())];
  const tickets = ticketIds.length ? await readTickets(ticketIds, options) : new Map();
  const report = summarizeEventAttendance({ notes: relevant, noteTickets, tickets, partial, strictComplete, fetchedAt: new Date(now()).toISOString() });
  if (!includeReviews) return report;
  return { ...report, ...await readEventReviews({ ticketIds, inRecruiting: id => tickets.get(id)?.pipeline === PIPELINE_ID, options, reviewSecrets }) };
}

/**
 * The latest signed Approved or Denied decision on each recruiting ticket, for Event Attendance and the Applications
 * page. A failed read leaves the decisions empty with a notice, so the rest of the page still loads.
 */
export async function readEventReviews({ ticketIds, inRecruiting, options, reviewSecrets = /** @type {string[]} */ ([]), notice = 'Review statuses could not refresh. Existing attendance data is still available.' }) {
  const now = options.now ?? Date.now;
  try {
    const reviewRead = await readFormNotes(options, true);
    const fallback = reviewRead.partial ? await readTicketReviewNotes(ticketIds, options) : null;
    const candidates = (fallback?.notes ?? reviewRead.notes).filter(hasEventReviewProof);
    const links = fallback?.links ?? (candidates.length ? await readNoteTickets(candidates.map(note => String(note.id)), options, true) : new Map());
    const reviews = {};
    let complete = true;
    const seenDecisions = new Map();
    for (const note of candidates) {
      const review = parseEventReview(note, reviewSecrets);
      if (!review) { complete = false; continue; }
      // Replayed copies of one signed decision retain its earliest note ID.
      const decisionKey = JSON.stringify([review.ticketId, review.requestId, review.status, review.reviewedAt]);
      const previous = seenDecisions.get(decisionKey);
      if (previous && BigInt(previous.noteId) <= BigInt(review.noteId)) continue;
      seenDecisions.set(decisionKey, review);
    }
    for (const review of seenDecisions.values()) {
      if (Date.parse(review.reviewedAt) > now() + 60000) continue;
      for (const ticketId of links.get(review.noteId) ?? []) {
        if (review.ticketId !== ticketId || !inRecruiting(ticketId)) continue;
        reviews[ticketId] = newerEventReview(reviews[ticketId], review);
      }
    }
    return { reviews, reviewComplete: complete };
  } catch {
    return { reviews: {}, reviewComplete: false, reviewNotice: notice };
  }
}
