import {
  ASSOCIATION, CONTRACTED_BEFORE, HEARD_ABOUT, HIRING_EVENT_STAGE_ID, LICENSE_FOLDER, OFFICES,
  PORTAL_ID, RECRUITING_PATH, RECRUITING_PIPELINE_ID, REQUIRED_SCOPES, SIGN_IN_SOURCES, TERMINAL_STAGE_IDS,
} from './config.mjs';
import { formatPhone } from './validate.mjs';

const API = 'https://api.hubapi.com';

export class SignInError extends Error {
  constructor(code, status, { phase, upstreamStatus } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.phase = phase;
    this.upstreamStatus = upstreamStatus;
  }
}

/**
 * Minimal HubSpot REST client: fixed host, manual redirects, per-request timeout,
 * one bounded retry on 429 (and on 5xx for reads), and no request data in errors.
 */
export function createHubSpotClient({ accessToken, fetchImpl = fetch, baseUrl = API, timeoutMs = 9000, now = Date.now, budgetMs = 40000, sleep } = {}) {
  if (!accessToken) throw new SignInError('NOT_CONFIGURED', 503, { phase: 'config' });
  const deadline = now() + budgetMs;
  const wait = sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  async function call(phase, method, path, { json, form, retryable = method === 'GET' } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new SignInError('HUBSPOT_TIMEOUT', 504, { phase });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
      let response;
      try {
        response = await fetchImpl(new URL(path, baseUrl).href, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
          ...(json ? { body: JSON.stringify(json) } : form ? { body: form } : {}),
        });
      } catch {
        clearTimeout(timer);
        if (retryable && attempt === 0) continue;
        throw new SignInError('HUBSPOT_UNAVAILABLE', 502, { phase });
      }
      clearTimeout(timer);
      const status = response.status;
      if (status === 429 || (retryable && status >= 500)) {
        const after = Math.min(2000, Math.max(250, Number(response.headers.get('retry-after')) * 1000 || 1000));
        if (attempt === 0 && deadline - now() > after + 1000) { await wait(after); continue; }
      }
      let body = null;
      const textBody = await response.text().catch(() => '');
      if (textBody) { try { body = JSON.parse(textBody); } catch { body = null; } }
      if (status >= 200 && status < 300) return { status, body };
      return { status, body, failed: true };
    }
  }

  function ok(result, phase) {
    if (!result.failed) return result.body;
    const status = result.status;
    if (status === 401 || status === 403) throw new SignInError('HUBSPOT_ACCESS', 503, { phase, upstreamStatus: status });
    if (status === 429) throw new SignInError('HUBSPOT_BUSY', 503, { phase, upstreamStatus: status });
    throw new SignInError('HUBSPOT_REJECTED', 502, { phase, upstreamStatus: status });
  }

  return { call, ok, accessToken };
}

let verifiedUntil = 0;
let verifiedToken = '';

/** Confirms the token belongs to the Legacy portal and has every scope sign-in needs. */
export async function verifyAccess(client, { now = Date.now, cache = true } = {}) {
  if (cache && verifiedToken === client.accessToken && now() < verifiedUntil) return true;
  const info = client.ok(await client.call('access', 'POST', '/oauth/v2/private-apps/get/access-token-info', { json: { tokenKey: client.accessToken }, retryable: true }), 'access');
  const scopes = Array.isArray(info?.scopes) ? info.scopes : [];
  if (String(info?.hubId) !== PORTAL_ID || !REQUIRED_SCOPES.every(scope => scopes.includes(scope))) {
    throw new SignInError('HUBSPOT_ACCESS', 503, { phase: 'access' });
  }
  verifiedToken = client.accessToken;
  verifiedUntil = now() + 10 * 60 * 1000;
  return true;
}

export function resetAccessCache() { verifiedUntil = 0; verifiedToken = ''; }

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function easternTime(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) + ' ET';
}

/** Human-readable lines shared by the ticket description and the note. */
export function summaryLines(input, { signedInAt, licenseFiles }) {
  const heard = input.heardAbout === 'referral' ? `${HEARD_ABOUT.referral} (${input.referredBy})`
    : input.heardAbout === 'other' ? `Other: ${input.heardAboutOther}`
      : HEARD_ABOUT[input.heardAbout];
  const license = input.licenseStatus === 'licensed'
    ? `Licensed. NPN: ${input.npn ?? 'not given'}. Contracted with an agency before: ${CONTRACTED_BEFORE[input.contractedBefore]}`
    : 'Unlicensed';
  return [
    ['Signed in', easternTime(signedInAt)],
    ['Signed in from', SIGN_IN_SOURCES[input.source]],
    ['Name', `${input.firstName} ${input.lastName}`],
    ['Email', input.email],
    ['Phone', formatPhone(input.phone)],
    ['Office', OFFICES[input.office]],
    ['How they heard about us', heard],
    ['License', license],
    ["Driver's license", licenseFiles],
  ];
}

function ticketProperties(input, { description, heardAboutProperty }) {
  const fullName = `${input.firstName} ${input.lastName}`;
  const properties = {
    subject: `Recruiting: ${fullName}`,
    recruit_name: fullName,
    recruit_email: input.email,
    recruit_phone_number: input.phone,
    hs_pipeline: RECRUITING_PIPELINE_ID,
    hs_pipeline_stage: HIRING_EVENT_STAGE_ID,
    recruiting_path: RECRUITING_PATH,
    orientation_office: input.office,
    intake_license_status: input.licenseStatus === 'licensed' ? 'already_licensed' : 'unlicensed',
    already_licensed: input.licenseStatus === 'licensed' ? 'true' : 'false',
    source_type: 'FORM',
    content: description,
  };
  if (input.licenseStatus === 'licensed') {
    properties.has_recruit_contracted_before_transfer = input.contractedBefore === 'yes' ? 'Yes' : 'No';
    if (input.npn) properties.npn_number = input.npn;
  }
  if (input.heardAbout === 'referral' && input.referredBy) properties.invited_by_name = input.referredBy;
  if (heardAboutProperty) properties[heardAboutProperty] = input.heardAbout;
  return properties;
}

async function findContact(client, email) {
  const body = client.ok(await client.call('contact_search', 'POST', '/crm/v3/objects/contacts/search', {
    retryable: true,
    json: { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], properties: ['firstname', 'lastname', 'phone', 'email'], limit: 2 },
  }), 'contact_search');
  const match = Array.isArray(body?.results) ? body.results[0] : null;
  return match && /^\d+$/.test(String(match.id)) ? { id: String(match.id), properties: match.properties ?? {} } : null;
}

async function ensureContact(client, input) {
  const existing = await findContact(client, input.email);
  if (existing) {
    // Fill only blanks on an existing contact; never overwrite what staff already have.
    const fill = {};
    if (!existing.properties.firstname) fill.firstname = input.firstName;
    if (!existing.properties.lastname) fill.lastname = input.lastName;
    if (!existing.properties.phone) fill.phone = input.phone;
    if (Object.keys(fill).length) {
      client.ok(await client.call('contact_fill', 'PATCH', `/crm/v3/objects/contacts/${existing.id}`, { json: { properties: fill } }), 'contact_fill');
    }
    return { id: existing.id, created: false };
  }
  const result = await client.call('contact_create', 'POST', '/crm/v3/objects/contacts', {
    json: { properties: { firstname: input.firstName, lastname: input.lastName, email: input.email, phone: input.phone } },
  });
  if (result.status === 409) {
    // Created moments ago (search indexing lags) or by a double tap: use the existing ID.
    const id = /Existing ID:\s*(\d+)/.exec(String(result.body?.message ?? ''))?.[1];
    if (id) return { id, created: false };
  }
  const body = client.ok(result, 'contact_create');
  if (!/^\d+$/.test(String(body?.id))) throw new SignInError('HUBSPOT_REJECTED', 502, { phase: 'contact_create' });
  return { id: String(body.id), created: true };
}

async function openRecruitingTicket(client, contactId) {
  const assoc = client.ok(await client.call('ticket_lookup', 'GET', `/crm/v4/objects/contacts/${contactId}/associations/tickets?limit=100`), 'ticket_lookup');
  const ids = (Array.isArray(assoc?.results) ? assoc.results : []).map(item => String(item.toObjectId)).filter(id => /^\d+$/.test(id));
  if (!ids.length) return null;
  const tickets = client.ok(await client.call('ticket_lookup', 'POST', '/crm/v3/objects/tickets/batch/read', {
    retryable: true,
    json: { inputs: ids.slice(0, 100).map(id => ({ id })), properties: ['hs_pipeline', 'hs_pipeline_stage'] },
  }), 'ticket_lookup');
  const open = (Array.isArray(tickets?.results) ? tickets.results : [])
    .filter(t => t?.properties?.hs_pipeline === RECRUITING_PIPELINE_ID && !TERMINAL_STAGE_IDS.includes(t.properties.hs_pipeline_stage))
    .sort((a, b) => Number(b.id) - Number(a.id));
  return open[0] ? String(open[0].id) : null;
}

async function createTicket(client, contactId, properties) {
  const body = client.ok(await client.call('ticket_create', 'POST', '/crm/v3/objects/tickets', {
    json: { properties, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.ticketToContact }] }] },
  }), 'ticket_create');
  if (!/^\d+$/.test(String(body?.id))) throw new SignInError('HUBSPOT_REJECTED', 502, { phase: 'ticket_create' });
  return String(body.id);
}

async function uploadLicense(client, file, fileName) {
  const form = new FormData();
  form.append('file', new Blob([file.bytes], { type: file.type }), fileName);
  form.append('fileName', fileName);
  form.append('folderPath', LICENSE_FOLDER);
  form.append('options', JSON.stringify({ access: 'PRIVATE', overwrite: false, duplicateValidationStrategy: 'NONE', duplicateValidationScope: 'EXACT_FOLDER' }));
  const body = client.ok(await client.call('license_upload', 'POST', '/files/v3/files', { form, retryable: true }), 'license_upload');
  if (!/^\d+$/.test(String(body?.id))) throw new SignInError('HUBSPOT_REJECTED', 502, { phase: 'license_upload' });
  return String(body.id);
}

async function createNote(client, { contactId, ticketId, html, attachmentIds, timestamp }) {
  client.ok(await client.call('note_create', 'POST', '/crm/v3/objects/notes', {
    json: {
      properties: { hs_timestamp: new Date(timestamp).toISOString(), hs_note_body: html, ...(attachmentIds.length ? { hs_attachment_ids: attachmentIds.join(';') } : {}) },
      associations: [
        { to: { id: ticketId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.noteToTicket }] },
        { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.noteToContact }] },
      ],
    },
  }), 'note_create');
}

/**
 * Records one validated sign-in:
 * 1. reuse the Contact with this email (filling blanks) or create it;
 * 2. reuse its open Recruiting ticket, or create one at Hiring Event;
 * 3. upload the license photos as PRIVATE files;
 * 4. add a note with every answer and the photos to the ticket and contact.
 * A retry after a failure reuses the ticket from step 2, so it does not create a second one.
 */
export async function recordSignIn(client, input, { now = Date.now, heardAboutProperty = null } = {}) {
  const signedInAt = now();
  await verifyAccess(client, { now });
  const contact = await ensureContact(client, input);
  const existingTicketId = await openRecruitingTicket(client, contact.id);
  const licenseFiles = input.licenseBack ? 'Front and back attached to the sign-in note' : 'Front attached to the sign-in note';
  const lines = summaryLines(input, { signedInAt, licenseFiles });
  const description = ['Hiring event sign-in', ...lines.map(([k, v]) => `${k}: ${v}`)].join('\n');

  const ticketId = existingTicketId ?? await createTicket(client, contact.id, ticketProperties(input, { description, heardAboutProperty }));

  const stamp = new Date(signedInAt).toISOString().slice(0, 10);
  const attachmentIds = [await uploadLicense(client, input.licenseFront, `license-front-${contact.id}-${stamp}-${signedInAt}.${input.licenseFront.ext}`)];
  if (input.licenseBack) attachmentIds.push(await uploadLicense(client, input.licenseBack, `license-back-${contact.id}-${stamp}-${signedInAt}.${input.licenseBack.ext}`));

  const heading = existingTicketId
    ? 'Hiring event sign-in (this person already had an open recruiting ticket, so no new ticket was created)'
    : 'Hiring event sign-in';
  const html = `<p><strong>${escapeHtml(heading)}</strong></p>` + lines.map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`).join('');
  await createNote(client, { contactId: contact.id, ticketId, html, attachmentIds, timestamp: signedInAt });

  return { contactId: contact.id, ticketId, contactCreated: contact.created, ticketCreated: !existingTicketId, attachments: attachmentIds.length };
}
