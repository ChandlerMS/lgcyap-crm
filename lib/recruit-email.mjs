import { applicationReminder } from './application-reminder.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import sanitizeHtml from 'sanitize-html';
import { PIPELINE_ID } from './recruiting-config.mjs';
import { providerJson } from './hubspot-tools.mjs';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export function mailError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
const address = value => typeof value === 'string' && value.length <= 254 && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const mailHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateEmailInput(input, { maxSubjectLength = 200 } = {}) {
  if (!input || typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > maxSubjectLength || /[\r\n\x00-\x1f]/.test(input.subject) || typeof input.body !== 'string' || input.body.length > 60000 || /\x00/.test(input.body)) throw mailError('Enter a subject and a message of at most 60,000 characters.');
  return { subject: input.subject.trim(), body: input.body.trim() };
}
export function cleanOfferHtml(html) {
  return sanitizeHtml(html, { allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2'], allowedAttributes: { '*': ['style', 'class', 'align'], a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], table: ['width', 'cellspacing', 'cellpadding', 'border', 'role'], td: ['colspan', 'width'] }, allowedSchemes: ['https', 'mailto', 'tel', 'cid'], allowedStyles: { '*': { color: [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgba?\([\d.,%\s]+\)$/i], background: [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgba?\([\d.,%\s]+\)$/i], 'background-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgba?\([\d.,%\s]+\)$/i], 'font-family': [/^[\w\s,'-]+$/], 'font-size': [/^\d+(?:\.\d+)?(?:px|pt|em|%)$/], 'font-weight': [/^(?:normal|bold|[1-9]00)$/], 'text-align': [/^(?:left|right|center)$/], 'line-height': [/^[\d.]+(?:px|%)?$/], padding: [/^(?:[\d.]+(?:px|pt|em|%)?\s*){1,4}$/], margin: [/^(?:[\d.]+(?:px|pt|em|%)?\s*){1,4}$/], width: [/^[\d.]+(?:px|%)$/], 'max-width': [/^[\d.]+(?:px|%)$/], border: [/^[\w\s#.,()-]+$/], 'border-collapse': [/^(collapse|separate)$/], 'border-radius': [/^[\d.]+px$/] } } });
}
export function offerTemplates(env = process.env) {
  try {
    const rows = JSON.parse(env.RECRUIT_OFFER_TEMPLATES ? gunzipSync(Buffer.from(env.RECRUIT_OFFER_TEMPLATES, 'base64'), { maxOutputLength: 500000 }).toString() : '[]');
    if (!Array.isArray(rows) || rows.length !== 2) return [{ ...applicationReminder, html: cleanOfferHtml(applicationReminder.html) }];
    return [{ ...applicationReminder, html: cleanOfferHtml(applicationReminder.html) }, ...rows.filter(t => ['licensed', 'unlicensed'].includes(t.id) && ['licensed', 'not_licensed'].includes(t.route) && typeof t.html === 'string' && typeof t.text === 'string').map(t => ({ ...t, html: cleanOfferHtml(t.html) }))];
  } catch { return [{ ...applicationReminder, html: cleanOfferHtml(applicationReminder.html) }]; }
}
export function renderOffer(template, recipient, fields = {}) {
  if (template.route !== 'all' && recipient.route !== template.route) throw mailError('This offer is unavailable for this recruit’s current licensing route. Update the verified licensing route first.');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw mailError('Complete the offer dates.');
  const values = { ...fields, firstName: recipient.firstName };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const key of template.fields || []) {
    const value = fields[key];
    if (key === 'contractingTime') {
      if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw mailError('Complete the contracting time.');
      const [hour, minute] = value.split(':').map(Number);
      values[key] = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'} Eastern Time`;
    } else {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || (key !== 'eventDate' && value < today)) throw mailError(`Choose a current or future ${key}.`);
      values[key] = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value));
    }
  }
  if (fields.eventDate && fields.applicationDeadline && fields.applicationDeadline < fields.eventDate) throw mailError('The application deadline must be on or after the event.');
  if (fields.contractingDate && fields.trainingDate && fields.trainingDate < fields.contractingDate) throw mailError('Training must start on or after contracting.');
  if (fields.acceptBy && fields.contractingDate && fields.acceptBy > fields.contractingDate) throw mailError('The acceptance deadline must be on or before contracting.');
  const replace = (source, html) => source.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[<>\r\n]/.test(value) && key !== 'firstName') throw mailError(`Complete ${key} before previewing or sending.`);
    return html ? escape(value.trim()) : value.trim();
  });
  return { html: replace(template.html, true), text: replace(template.text, false) };
}
/** @param {{from:string,to:string,subject:string,text:string,html?:string,assets?:{cid:string,data:string}[],subjectLimit?:number}} input */
export function emailMime({ from, to, subject, text, html, assets = [], subjectLimit = 200 }) {
  if (!address(from) || !address(to)) throw mailError('A valid sender and verified recruit email are required.');
  validateEmailInput({ subject, body: text }, { maxSubjectLength: subjectLimit });
  // RFC 2047 encoded words have a 75-character maximum. Split at code points so
  // folded Unicode subjects decode without breaking a multibyte character.
  const subjectWords = []; let word = '';
  for (const char of subject) {
    if (Buffer.byteLength(word + char, 'utf8') > 42) { subjectWords.push(word); word = ''; }
    word += char;
  }
  if (word) subjectWords.push(word);
  const encodedSubject = subjectWords.map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
  const boundary = `lgcy-${randomUUID()}`;
  const encoded = value => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const mime = [`From: ${from}`, `To: ${to}`, `Subject: ${encodedSubject}`, 'MIME-Version: 1.0', `Content-Type: multipart/related; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded(html || `<div style="white-space:pre-wrap">${escape(text)}</div>`), ...assets.flatMap(asset => {
    if (!/^[\w.-]+$/.test(asset.cid) || typeof asset.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(asset.data) || asset.data.length > 500000) throw mailError('The template logo is invalid.');
    return [`--${boundary}`, 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', `Content-ID: <${asset.cid}>`, 'Content-Disposition: inline', '', asset.data.match(/.{1,76}/g).join('\r\n')];
  }), `--${boundary}--`, ''].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
export async function sendGmail(token, raw, fetchImpl = fetch) {
  let response;
  try { response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(20000) }); }
  catch { throw mailError('Delivery outcome is uncertain. Check your Gmail Sent folder before composing another message.', 502); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw mailError('Google could not authorize sending. Connect Google email again; your administrator may need to enable Gmail API access.', 403);
    throw mailError('Delivery outcome is uncertain. Check your Gmail Sent folder before composing another message.', 502);
  }
  let result; try { result = await response.json(); } catch { /* uncertain */ }
  if (!result?.id || typeof result.id !== 'string') throw mailError('Delivery outcome is uncertain. Check your Gmail Sent folder before composing another message.', 502);
  return result.id;
}
export async function verifiedRecipient(id, { accessToken = process.env.HUBSPOT_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  if (!/^[1-9]\d{0,19}$/.test(id)) throw mailError('Choose a live recruit.');
  const read = (path, body) => providerJson(`https://api.hubapi.com${path}`, { accessToken, fetchImpl, timeoutMs: 7000, ...(body ? { method: 'POST', body } : {}) });
  const ticket = await read(`/crm/v3/objects/tickets/${id}?properties=hs_pipeline,licensing_branch,intake_license_status,recruit_email&archived=false`);
  if (String(ticket.id) !== id || ticket.archived || ticket.properties?.hs_pipeline !== PIPELINE_ID) throw mailError('Recruit not found in the Recruiting pipeline.', 404);
  const links = await read('/crm/v4/associations/tickets/contacts/batch/read', { inputs: [{ id }] });
  const rows = links.results?.filter(r => String(r.from?.id) === id);
  const ids = rows?.length === 1 && Array.isArray(rows[0].to) ? [...new Set(rows[0].to.map(r => String(r.toObjectId)))] : [];
  if (links.status !== 'COMPLETE' || links.errors?.length || ids.length !== 1 || rows[0].paging?.next || !/^[1-9]\d{0,19}$/.test(ids[0])) throw mailError('This recruit needs exactly one verified linked contact before email can be sent.', 409);
  const contact = await read(`/crm/v3/objects/contacts/${ids[0]}?properties=email,firstname,lastname&archived=false`);
  const p = contact.properties;
  if (contact.archived || String(contact.id) !== ids[0] || !address(p?.email)) throw mailError('The linked contact needs a valid email address.', 409);
  if (ticket.properties.recruit_email && ticket.properties.recruit_email.trim().toLowerCase() !== p.email.trim().toLowerCase()) throw mailError('The ticket and linked contact have different email addresses. Resolve them before sending.', 409);
  // Current declared licensing status overrides a stale branch.
  const route = ticket.properties.intake_license_status === 'already_licensed' ? 'licensed' : ticket.properties.intake_license_status === 'unlicensed' || ticket.properties.intake_license_status === 'in_progress' ? 'not_licensed' : ticket.properties.licensing_branch;
  return { email: p.email.trim(), firstName: p.firstname?.trim() || '', name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email, contactId: ids[0], route };
}

export async function logSentEmail({ recruitId, recipient, sender, subject, text }, accessToken = process.env.HUBSPOT_ACCESS_TOKEN) {
  const read = (path, body) => providerJson(`https://api.hubapi.com${path}`, { accessToken, timeoutMs: 7000, ...(body ? { method: 'POST', body } : {}) });
  const associations = [];
  for (const [object, id] of [['contacts', recipient.contactId], ['tickets', recruitId]]) {
    const labels = await read(`/crm/v4/associations/emails/${object}/labels`);
    const label = labels.results?.find(r => r.category === 'HUBSPOT_DEFINED' && r.label === null);
    if (!label?.typeId) throw mailError('Email sent; HubSpot history could not be updated.', 502);
    associations.push({ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: label.typeId }] });
  }
  await read('/crm/v3/objects/emails', { properties: { hs_timestamp: new Date().toISOString(), hs_email_direction: 'EMAIL', hs_email_status: 'SENT', hs_email_subject: subject, hs_email_text: text, hs_email_headers: JSON.stringify({ from: { email: sender }, to: [{ email: recipient.email }] }) }, associations });
}
