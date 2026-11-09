import { visibleSections, isShown, answerText } from '../public/rules.js';
import {
  ALREADY_LICENSED, ASSOCIATION, FILE_SCOPES, INTAKE_LICENSE_STATUS, LICENSE_FOLDER, OFFICE_VALUES, PORTAL_ID,
  RECRUITING_PIPELINE_ID, REQUIRED_SCOPES, STAGE, TERMINAL_STAGE_IDS,
} from './config.mjs';
import { formatPhone, splitName } from './validate.mjs';

const API = 'https://api.hubapi.com';

export class ApplyError extends Error {
  constructor(code, status, { phase, upstreamStatus } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.phase = phase;
    this.upstreamStatus = upstreamStatus;
  }
}

/**
 * Minimal HubSpot REST client: fixed host, manual redirects, per-request timeout, one bounded
 * retry on 429 (and on network or 5xx errors for retry-safe calls), and no request data in errors.
 */
export function createHubSpotClient({ accessToken, fetchImpl = fetch, baseUrl = API, timeoutMs = 9000, now = Date.now, budgetMs = 45000, sleep } = {}) {
  if (!accessToken) throw new ApplyError('NOT_CONFIGURED', 503, { phase: 'config' });
  const deadline = now() + budgetMs;
  const wait = sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  async function call(phase, method, path, { json, form, retryable = method === 'GET' } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new ApplyError('HUBSPOT_TIMEOUT', 504, { phase });
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
        throw new ApplyError('HUBSPOT_UNAVAILABLE', 502, { phase });
      }
      clearTimeout(timer);
      const status = response.status;
      if (status === 429 || (retryable && status >= 500)) {
        const after = Math.min(2000, Math.max(250, Number(response.headers.get('retry-after')) * 1000 || 1000));
        if (attempt === 0 && deadline - now() > after + 1000) { await response.text().catch(() => ''); await wait(after); continue; }
      }
      let body = null;
      const text = await response.text().catch(() => '');
      if (text) { try { body = JSON.parse(text); } catch { body = null; } }
      return status >= 200 && status < 300 ? { status, body } : { status, body, failed: true };
    }
  }

  function ok(result, phase) {
    if (!result.failed) return result.body;
    const status = result.status;
    if (status === 401 || status === 403) throw new ApplyError('HUBSPOT_ACCESS', 503, { phase, upstreamStatus: status });
    if (status === 429) throw new ApplyError('HUBSPOT_BUSY', 503, { phase, upstreamStatus: status });
    throw new ApplyError('HUBSPOT_REJECTED', 502, { phase, upstreamStatus: status });
  }

  return { call, ok, accessToken };
}

let verifiedUntil = 0;
let verifiedToken = '';
let verifiedVia = '';

export function hasScopes(scopes) {
  return REQUIRED_SCOPES.every(scope => scopes.includes(scope)) && FILE_SCOPES.some(scope => scopes.includes(scope));
}

/**
 * Confirms the token belongs to the Legacy portal before anything is written.
 * 1. HubSpot's token-info lookup gives the portal and scopes for private-app tokens; both must match.
 * 2. HubSpot does not document that lookup for service keys. If it answers 400 or 404, the portal is
 *    confirmed through account details instead. Scopes cannot be listed that way, so a missing scope
 *    shows up as a 403 on the HubSpot call that needs it, and that application reports a failure.
 * Returns how access was confirmed: 'token_info' or 'account_info'.
 */
export async function verifyAccess(client, { now = Date.now, cache = true } = {}) {
  if (cache && verifiedToken === client.accessToken && now() < verifiedUntil) return verifiedVia;
  let via;
  const info = await client.call('access', 'POST', '/oauth/v2/private-apps/get/access-token-info', { json: { tokenKey: client.accessToken }, retryable: true });
  if (!info.failed) {
    const scopes = Array.isArray(info.body?.scopes) ? info.body.scopes : [];
    if (String(info.body?.hubId) !== PORTAL_ID || !hasScopes(scopes)) throw new ApplyError('HUBSPOT_ACCESS', 503, { phase: 'access' });
    via = 'token_info';
  } else if (info.status === 400 || info.status === 404) {
    const account = client.ok(await client.call('access_account', 'GET', '/account-info/v3/details'), 'access_account');
    if (String(account?.portalId) !== PORTAL_ID) throw new ApplyError('HUBSPOT_ACCESS', 503, { phase: 'access_account' });
    via = 'account_info';
  } else {
    client.ok(info, 'access');
  }
  verifiedToken = client.accessToken;
  verifiedVia = via;
  verifiedUntil = now() + 10 * 60 * 1000;
  return via;
}

export function resetAccessCache() { verifiedUntil = 0; verifiedToken = ''; verifiedVia = ''; }

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function easternTime(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) + ' ET';
}

const id = value => /^\d+$/.test(String(value ?? '')) ? String(value) : null;

async function findContactId(client, email) {
  // Only the ID is needed: an existing contact is linked, never read into or changed.
  const body = client.ok(await client.call('contact_search', 'POST', '/crm/v3/objects/contacts/search', {
    retryable: true,
    json: { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], properties: ['email'], limit: 2 },
  }), 'contact_search');
  const match = Array.isArray(body?.results) ? body.results[0] : null;
  return match ? id(match.id) : null;
}

/**
 * The form is public and the email is not verified, so a contact that already has this email is
 * only linked to. Its fields are never changed; staff confirm details with the person first.
 * A new contact is created with the applicant's details.
 */
async function ensureContact(client, properties) {
  const existingId = await findContactId(client, properties.email);
  if (existingId) return { id: existingId, created: false };
  const result = await client.call('contact_create', 'POST', '/crm/v3/objects/contacts', { json: { properties } });
  if (result.status === 409) {
    // Created moments ago (search indexing lags) or by a double tap: use the existing ID.
    const existingId = id(/Existing ID:\s*(\d+)/.exec(String(result.body?.message ?? ''))?.[1]);
    if (existingId) return { id: existingId, created: false };
  }
  const body = client.ok(result, 'contact_create');
  if (!id(body?.id)) throw new ApplyError('HUBSPOT_REJECTED', 502, { phase: 'contact_create' });
  return { id: id(body.id), created: true };
}

/** The newest open Recruiting ticket on this contact, or null. Read only, never changed. */
async function openRecruitingTicket(client, contactId) {
  const assoc = client.ok(await client.call('ticket_lookup', 'GET', `/crm/v4/objects/contacts/${contactId}/associations/tickets?limit=100`), 'ticket_lookup');
  const ids = (Array.isArray(assoc?.results) ? assoc.results : []).map(item => id(item?.toObjectId)).filter(Boolean);
  if (!ids.length) return null;
  const tickets = client.ok(await client.call('ticket_lookup', 'POST', '/crm/v3/objects/tickets/batch/read', {
    retryable: true,
    json: { inputs: ids.slice(0, 100).map(ticketId => ({ id: ticketId })), properties: ['hs_pipeline', 'hs_pipeline_stage'] },
  }), 'ticket_lookup');
  const open = (Array.isArray(tickets?.results) ? tickets.results : [])
    .filter(t => id(t?.id) && t.properties?.hs_pipeline === RECRUITING_PIPELINE_ID && !TERMINAL_STAGE_IDS.includes(t.properties.hs_pipeline_stage))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  return open ? { id: id(open.id), properties: open.properties } : null;
}

async function uploadLicense(client, file, fileName) {
  const form = new FormData();
  form.append('file', new Blob([file.bytes], { type: file.type }), fileName);
  form.append('fileName', fileName);
  form.append('folderPath', LICENSE_FOLDER);
  form.append('options', JSON.stringify({ access: 'PRIVATE', overwrite: false, duplicateValidationStrategy: 'NONE', duplicateValidationScope: 'EXACT_FOLDER' }));
  const body = client.ok(await client.call('license_upload', 'POST', '/files/v3/files', { form, retryable: true }), 'license_upload');
  if (!id(body?.id)) throw new ApplyError('HUBSPOT_REJECTED', 502, { phase: 'license_upload' });
  return id(body.id);
}

/** Ticket fields drawn from the application. Blank answers are left out. */
export function ticketFields(answers) {
  const fields = {
    recruit_name: answers.legalName,
    recruit_email: answers.email,
    recruit_phone_number: answers.phone,
    orientation_office: OFFICE_VALUES[answers.office],
    intake_license_status: INTAKE_LICENSE_STATUS[answers.licenseStatus],
    already_licensed: ALREADY_LICENSED[answers.licenseStatus],
    npn_number: answers.npn ? String(answers.npn).replace(/[^\dA-Za-z]/g, '').slice(0, 20) : undefined,
    invited_by_name: answers.referredBy,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}

/** Every visible question and answer, grouped by section, for the note. */
export function applicationSections(answers) {
  return visibleSections(answers).map(section => ({
    title: section.title,
    rows: section.items
      .filter(item => item.type !== 'file' && isShown(item, answers))
      .map(item => [item.label, item.id === 'phone' && answers.phone ? formatPhone(answers.phone) : answerText(item, answers[item.id]) || 'Not answered']),
  }));
}

export const EXISTING_CONTACT_NOTE = 'The email matched an existing contact, which was not changed. Confirm these details with the person before updating it.';

function noteHtml({ submittedAt, evaluation, outcome, answers, hasLicense, existingContact }) {
  const p = (label, value) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
  let html = `<p><strong>Agent application (v3.1) submitted online, ${escapeHtml(easternTime(submittedAt))}</strong></p>`;
  html += p('Required items', evaluation.pass ? 'Meets all five' : `Did not meet: ${evaluation.failed.join('; ')}`);
  html += p('Needs a private conversation', evaluation.review.length ? evaluation.review.join(' | ') : 'Nothing flagged');
  html += p('In HubSpot', outcome);
  if (existingContact) html += p('Contact', EXISTING_CONTACT_NOTE);
  html += p("Driver's license", hasLicense ? 'Attached to this note (private file)' : 'Not attached');
  for (const section of applicationSections(answers)) {
    html += `<p><strong>${escapeHtml(section.title.toUpperCase())}</strong></p><ul>`;
    html += section.rows.map(([label, value]) => `<li><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value).replace(/\n/g, '<br>')}</li>`).join('');
    html += '</ul>';
  }
  return html;
}

function ticketDescription({ submittedAt, evaluation, answers }) {
  return [
    `Agent application submitted online ${easternTime(submittedAt)}.`,
    `Office: ${answers.office}. License: ${answers.licenseStatus}.`,
    evaluation.pass ? 'Meets all five required items.' : `Did not meet: ${evaluation.failed.join('; ')}.`,
    evaluation.review.length ? `${evaluation.review.length} answer(s) need a private conversation.` : 'No answers flagged for review.',
    'Every answer and the license photo are in the application note.',
  ].join('\n');
}

/**
 * Records one validated application. The form is public and the email is unverified, so existing
 * records are only linked and noted, never changed:
 * 1. link the contact that has this email, or create a new one;
 * 2. if that contact has an open Recruiting ticket, add the application to it as a note, leaving
 *    its stage and fields alone (staff confirm the person, then move it in the CRM);
 * 3. otherwise create a ticket at Application, unless a required item failed (that applicant was
 *    told the role is not a fit, so only the contact and note are kept);
 * 4. upload the license as a PRIVATE file and add a note with every answer.
 */
export async function recordApplication(client, { answers, license }, evaluation, { now = Date.now } = {}) {
  const submittedAt = now();
  await verifyAccess(client, { now });
  const { firstName, lastName } = splitName(answers.legalName);
  const contact = await ensureContact(client, {
    firstname: firstName, lastname: lastName, email: answers.email, phone: answers.phone,
    city: answers.city, state: answers.state, zip: answers.zip,
  });

  const fields = ticketFields(answers);
  const open = await openRecruitingTicket(client, contact.id);
  let ticketId = null;
  let action;
  let outcome;
  if (open) {
    ticketId = open.id;
    action = 'noted';
    outcome = open.properties.hs_pipeline_stage === STAGE.hiringEvent
      ? 'Added to this open recruiting ticket, which is at Hiring Event. Its stage and fields were not changed: confirm this is the same person, then move it to Application in the CRM.'
      : 'Added to this open recruiting ticket. Its stage and fields were not changed.';
  } else if (evaluation.pass) {
    const body = client.ok(await client.call('ticket_create', 'POST', '/crm/v3/objects/tickets', {
      json: {
        properties: {
          ...fields,
          subject: `Recruiting: ${answers.legalName}`,
          hs_pipeline: RECRUITING_PIPELINE_ID,
          hs_pipeline_stage: STAGE.application,
          source_type: 'FORM',
          content: ticketDescription({ submittedAt, evaluation, answers }),
        },
        associations: [{ to: { id: contact.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.ticketToContact }] }],
      },
    }), 'ticket_create');
    ticketId = id(body?.id);
    if (!ticketId) throw new ApplyError('HUBSPOT_REJECTED', 502, { phase: 'ticket_create' });
    action = 'created';
    outcome = 'Created this recruiting ticket at Application';
  } else {
    action = 'contact_only';
    outcome = 'No recruiting ticket: a required item was not met, and the applicant was told the role is not a fit';
  }

  const stamp = new Date(submittedAt).toISOString().slice(0, 10);
  const fileId = await uploadLicense(client, license, `application-license-${contact.id}-${stamp}-${submittedAt}.${license.ext}`);

  const associations = [{ to: { id: contact.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.noteToContact }] }];
  if (ticketId) associations.unshift({ to: { id: ticketId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.noteToTicket }] });
  client.ok(await client.call('note_create', 'POST', '/crm/v3/objects/notes', {
    json: {
      properties: { hs_timestamp: new Date(submittedAt).toISOString(), hs_note_body: noteHtml({ submittedAt, evaluation, outcome, answers, hasLicense: true, existingContact: !contact.created }), hs_attachment_ids: fileId },
      associations,
    },
  }), 'note_create');

  return { contactId: contact.id, contactCreated: contact.created, ticketId, action };
}
