import { EVENT_ATTENDANCE_SINCE, EVENT_ATTENDANCE_SINCE_DAY, EVENT_TIME_ZONE, easternDay, hubspotJson, noteKind } from './event-attendance.mjs';
import { OFFICES, PIPELINE_ID, PORTAL_ID, STAGE_PAGES, STAGES } from './recruiting-config.mjs';
import { RecruitingError } from './hubspot.mjs';

// Online agent applications from the apply site (apply.lgcyap.com), read from the note the site adds for each one.
// The note holds every answer, so it is the complete record. This read is for recruiting editors, who can already
// open these notes from each recruit's activity; the Applications page lays them out in one place.
const PAGE_SIZE = 100;
const PAGE_LIMIT = 20;
const BATCH_SIZE = 100;
const validId = value => /^[1-9]\d{0,19}$/.test(value);
const HIRING_EVENT_STAGE_ID = STAGE_PAGES.find(page => page.id === 'hiring-event').stageId;
const invalid = () => new RecruitingError('HUBSPOT_RESPONSE_INVALID', 'HubSpot returned an unexpected response. Please try Refresh.', 502);
const post = (path, body, options) => hubspotJson(path, { method: 'POST', body }, options);
export const ticketUrl = id => `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-5/${id}`;
export const contactUrl = id => `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-1/${id}`;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Note HTML as plain text, keeping line breaks. */
export function htmlText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#\d{1,6}|#x[\da-f]{1,6}|[a-z]+);/gi, (match, name) => {
      if (name[0] === '#') { const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)); return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const sentenceCase = title => { const text = title.trim().toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };
const CERTIFY = /^I certify that the information/i;

/**
 * One application note, parsed: the opening details (required items, private-conversation flags, what happened in
 * HubSpot, photo ID) and every section of questions and answers. Returns null for any other note.
 */
export function parseApplicationNote(body) {
  const html = String(body ?? '').slice(0, 200_000);
  if (noteKind(html) !== 'application') return null;
  const meta = {}, sections = [];
  for (const block of html.matchAll(/<p>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>\s*(<ul>[\s\S]*?<\/ul>)?/gi)) {
    const strong = htmlText(block[1]);
    if (block[3]) {
      const rows = [...block[3].matchAll(/<li>\s*<strong>([\s\S]*?)<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*?)<\/li>/gi)].map(item => {
        const label = htmlText(item[1]);
        return { label: CERTIFY.test(label) ? 'Certifies the application is true and complete' : label.slice(0, 400), value: htmlText(item[2]).slice(0, 4000) || 'Not answered' };
      });
      sections.push({ title: sentenceCase(strong).slice(0, 120), rows });
    } else if (strong.endsWith(':')) meta[strong.slice(0, -1).trim().toLowerCase()] = htmlText(block[2]).slice(0, 2000);
  }
  const answers = new Map(sections.flatMap(section => section.rows.map(row => [row.label.toLowerCase(), row.value])));
  const get = label => { const value = answers.get(label.toLowerCase()) ?? ''; return value === 'Not answered' ? '' : value; };
  const required = meta['required items'] ?? '';
  const review = meta['needs a private conversation'] ?? '';
  const inHubSpot = meta['in hubspot'] ?? '';
  const office = get('Which office are you applying for?');
  return {
    name: get('Full legal name'), preferredName: get('Preferred name'), email: get('Email address'), phone: get('Mobile phone'),
    city: get('City'), state: get('State'), zip: get('ZIP'),
    office, officeKey: Object.entries(OFFICES).find(([, label]) => label.toLowerCase() === office.toLowerCase())?.[0] ?? null,
    license: get('Which best describes you today?'), startDate: get('Earliest start date'),
    heardAbout: get('How did you hear about this position?'), referredBy: get('Were you referred? If so, by whom?'),
    requirementsMet: /^Meets all/i.test(required) ? true : /^Did not meet/i.test(required) ? false : null,
    missed: /^Did not meet:/i.test(required) ? required.replace(/^Did not meet:\s*/i, '').split(/\s*;\s*/).filter(Boolean) : [],
    flags: !review || /^Nothing flagged/i.test(review) ? [] : review.split(/\s*\|\s*/).filter(Boolean),
    outcome: /^Created this recruiting ticket/i.test(inHubSpot) ? 'new-ticket' : /^Added to this open recruiting ticket/i.test(inHubSpot) ? 'existing-ticket' : /^No recruiting ticket/i.test(inHubSpot) ? 'contact-only' : 'unknown',
    outcomeText: inHubSpot,
    existingContact: Boolean(meta.contact),
    photoId: /^Attached/i.test(meta['photo id'] ?? meta["driver's license"] ?? ''),
    sections,
  };
}

/** Application notes the apply site wrote since the forms went live, oldest first. */
async function readApplicationNotes(options) {
  const notes = [];
  const cursors = new Set();
  let after, total = 0;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const payload = await post('/crm/v3/objects/notes/search', {
      filterGroups: [{ filters: [
        { propertyName: 'hs_object_source_label', operator: 'EQ', value: 'INTEGRATION' },
        { propertyName: 'hs_createdate', operator: 'GTE', value: String(EVENT_ATTENDANCE_SINCE) },
        // Every application note opens "Agent application (vX) submitted online".
        { propertyName: 'hs_note_body', operator: 'CONTAINS_TOKEN', value: 'submitted' },
      ] }],
      properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'], sorts: ['hs_object_id'], limit: PAGE_SIZE, ...(after === undefined ? {} : { after }),
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

const chunks = values => Array.from({ length: Math.ceil(values.length / BATCH_SIZE) }, (_, index) => values.slice(index * BATCH_SIZE, index * BATCH_SIZE + BATCH_SIZE));

/** Record IDs of one type linked to each note. */
async function readNoteLinks(noteIds, toType, options) {
  const links = new Map(noteIds.map(id => [id, []]));
  for (const ids of chunks(noteIds)) {
    const payload = await post(`/crm/v4/associations/notes/${toType}/batch/read`, { inputs: ids.map(id => ({ id })) }, options);
    if (!payload || !Array.isArray(payload.results)) throw invalid();
    for (const row of payload.results) {
      const from = String(row?.from?.id ?? '');
      if (!links.has(from) || !Array.isArray(row.to)) throw invalid();
      for (const target of row.to) {
        const id = String(target?.toObjectId ?? '');
        if (!validId(id)) throw invalid();
        if (!links.get(from).includes(id)) links.get(from).push(id);
      }
    }
  }
  return links;
}

/** Each linked ticket's current pipeline and stage. Deleted tickets are left out. */
async function readTickets(ticketIds, options) {
  const tickets = new Map();
  for (const ids of chunks(ticketIds)) {
    const payload = await post('/crm/v3/objects/tickets/batch/read', { properties: ['hs_pipeline', 'hs_pipeline_stage'], inputs: ids.map(id => ({ id })) }, options);
    if (!payload || !Array.isArray(payload.results)) throw invalid();
    for (const row of payload.results) {
      const id = String(row?.id ?? '');
      if (!ids.includes(id) || !row.properties || typeof row.properties !== 'object') throw invalid();
      if (!row.archived) tickets.set(id, { pipeline: String(row.properties.hs_pipeline ?? ''), stageId: String(row.properties.hs_pipeline_stage ?? '') });
    }
  }
  return tickets;
}

/** Parsed applications, newest first, with each one's recruiting ticket as it is now, and the counts. */
export function summarizeApplications({ notes, noteTickets = new Map(), noteContacts = new Map(), tickets = new Map(), partial = false, fetchedAt }) {
  const applications = [];
  for (const note of notes) {
    const id = String(note?.id ?? '');
    const parsed = validId(id) ? parseApplicationNote(note?.properties?.hs_note_body) : null;
    if (!parsed) continue;
    const time = Date.parse(String(note.properties.hs_timestamp || note.properties.hs_createdate || ''));
    if (!Number.isFinite(time)) continue;
    const ticketId = (noteTickets.get(id) ?? []).find(ticket => tickets.get(ticket)?.pipeline === PIPELINE_ID) ?? null;
    const stageId = ticketId ? tickets.get(ticketId).stageId : '';
    const contactId = (noteContacts.get(id) ?? [])[0] ?? null;
    applications.push({
      id, at: new Date(time).toISOString(), day: easternDay(time), ...parsed,
      ticket: ticketId ? { id: ticketId, stageId, stage: STAGES[stageId] ?? 'Other stage', url: ticketUrl(ticketId) } : null,
      contact: contactId ? { id: contactId, url: contactUrl(contactId) } : null,
      // Applying does not move an open ticket, so one still at Hiring Event waits for staff to move it.
      waitingAtHiringEvent: stageId === HIRING_EVENT_STAGE_ID,
    });
  }
  applications.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return {
    fetchedAt, since: EVENT_ATTENDANCE_SINCE_DAY, timeZone: EVENT_TIME_ZONE, partial,
    summary: {
      total: applications.length,
      met: applications.filter(item => item.requirementsMet === true).length,
      notMet: applications.filter(item => item.requirementsMet === false).length,
      flagged: applications.filter(item => item.flags.length > 0).length,
      waitingAtHiringEvent: applications.filter(item => item.waitingAtHiringEvent).length,
      photoId: applications.filter(item => item.photoId).length,
    },
    applications,
  };
}

export async function readApplications({ accessToken = '', fetchImpl = fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) || accessToken.length > 4096) {
    throw new RecruitingError('CONNECTION_NOT_CONFIGURED', 'The secure HubSpot connection has not been configured yet.', 503);
  }
  const options = { accessToken, fetchImpl, timeoutMs, now };
  const { notes, partial } = await readApplicationNotes(options);
  const relevant = notes.filter(note => validId(String(note?.id ?? '')) && noteKind(note?.properties?.hs_note_body) === 'application');
  const ids = [...new Set(relevant.map(note => String(note.id)))];
  const noteTickets = ids.length ? await readNoteLinks(ids, 'tickets', options) : new Map();
  const noteContacts = ids.length ? await readNoteLinks(ids, 'contacts', options) : new Map();
  const ticketIds = [...new Set([...noteTickets.values()].flat())];
  const tickets = ticketIds.length ? await readTickets(ticketIds, options) : new Map();
  return summarizeApplications({ notes: relevant, noteTickets, noteContacts, tickets, partial, fetchedAt: new Date(now()).toISOString() });
}
