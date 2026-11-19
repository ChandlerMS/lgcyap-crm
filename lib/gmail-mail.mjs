import sanitizeHtml from 'sanitize-html';
import { getGmailDb } from '../db/gmail.mjs';
import { getGmailAccess } from './gmail-connection.mjs';
import { editorAllowed, hostingAllowsWrites } from './hubspot-write.mjs';
import { isAllowedOrigin } from './hubspot.mjs';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const PAGE_SIZE = 10, MAX_RESPONSE = 2 * 1024 * 1024, MAX_BODY = 512 * 1024;
const HEADERS = ['From', 'To', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'References'];
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const hexId = value => typeof value === 'string' && /^[a-f0-9]{1,40}$/i.test(value);
const pageToken = value => typeof value === 'string' && /^[A-Za-z0-9._~+/=-]{1,2048}$/.test(value);
const controls = /[\x00-\x1f\x7f]/g;

export class GmailMailError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
const invalid = () => new GmailMailError('GMAIL_INVALID_REQUEST', 'Choose a valid Gmail folder or message.', 400);
const malformed = () => new GmailMailError('GMAIL_RESPONSE_INVALID', 'Gmail returned an incomplete response. Refresh to try again.');
const tooLarge = () => new GmailMailError('GMAIL_MESSAGE_TOO_LARGE', 'This email is too large or complex to display safely in the CRM.', 413);
const replyUnavailable = () => new GmailMailError('GMAIL_REPLY_UNAVAILABLE', 'This message does not have one safe reply recipient. Start a new email instead.', 409);

function requireEmployee(user, env) {
  if (!user) throw new GmailMailError('GMAIL_SIGN_IN_REQUIRED', 'Sign in to read your Gmail mailbox.', 401);
  if (!editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) throw new GmailMailError('GMAIL_ACCESS_DENIED', 'Employee access is required.', 403);
  if (!hostingAllowsWrites({ vercel: env.VERCEL, vercelEnv: env.VERCEL_ENV })) throw new GmailMailError('GMAIL_DISABLED', 'Read Gmail from the production CRM.', 403);
}
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  if (input.action === 'list') {
    if (Object.keys(input).some(key => !['action', 'folder', 'pageToken'].includes(key)) || !['inbox', 'sent'].includes(input.folder)
      || input.pageToken !== undefined && !pageToken(input.pageToken)) throw invalid();
  } else if (input.action === 'read') {
    if (Object.keys(input).some(key => !['action', 'messageId'].includes(key)) || !hexId(input.messageId)) throw invalid();
  } else throw invalid();
  return input;
}
async function boundedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw malformed();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw tooLarge(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function googleRead(url, token, fetchImpl) {
  const signal = AbortSignal.timeout(12000);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new GmailMailError('GMAIL_READ_PERMISSION_REQUIRED', 'Reconnect Google to allow Gmail reading. Your administrator may need to enable Gmail API access.', 403);
      if (response.status === 404) throw new GmailMailError('GMAIL_MESSAGE_NOT_FOUND', 'This Gmail message is no longer available. Refresh the mailbox.', 404);
      if (response.status === 429) throw new GmailMailError('GMAIL_RATE_LIMITED', 'Gmail is limiting requests. Wait before refreshing again.', 429);
      throw new GmailMailError('GMAIL_UNAVAILABLE', 'Gmail could not finish this read. Refresh to try again.');
    }
    const bytes = await boundedBytes(response, MAX_RESPONSE);
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw malformed(); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw malformed();
    return data;
  } catch (error) {
    if (error instanceof GmailMailError) throw error;
    throw new GmailMailError(signal.aborted ? 'GMAIL_TIMEOUT' : 'GMAIL_UNAVAILABLE', 'Gmail could not finish this read. Refresh to try again.', signal.aborted ? 504 : 502);
  }
}
async function ownAccess({ user, env, db, fetchImpl, access }) {
  requireEmployee(user, env);
  const result = await access({ user, env, db, fetchImpl, requireRead: true });
  if (typeof result?.email !== 'string' || result.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    || typeof result.accessToken !== 'string' || !result.accessToken || result.accessToken.length > 16384 || /[\x00-\x20\x7f]/.test(result.accessToken)) {
    throw new GmailMailError('GMAIL_ACCOUNT_MISMATCH', 'Reconnect the Google account matching your CRM sign-in.', 403);
  }
  return result;
}
function headerMap(values = []) {
  if (!Array.isArray(values) || values.length > 256) throw malformed();
  const headers = new Map(); let size = 0;
  for (const value of values) {
    if (typeof value?.name !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(value.name) || typeof value.value !== 'string' || value.value.length > 16384) throw malformed();
    size += Buffer.byteLength(value.name) + Buffer.byteLength(value.value);
    if (size > 128 * 1024) throw tooLarge();
    const name = value.name.toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), value.value]);
  }
  return headers;
}
const singleHeader = (headers, name) => headers.get(name)?.length === 1 ? headers.get(name)[0] : undefined;
function decodeWords(value) {
  return value.replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([^?\s]{1,40})\?([bq])\?([^?]{1,8192})\?=/gi, (word, charset, encoding, data) => {
    try {
      let bytes;
      if (encoding.toLowerCase() === 'b') {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return word;
        bytes = Buffer.from(data, 'base64');
      } else {
        const decoded = data.replaceAll('_', ' ').replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        bytes = Buffer.from(decoded, 'latin1');
      }
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch { return word; }
  });
}
function display(value, limit = 8192) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit) throw malformed();
  return decodeWords(value).replace(controls, ' ').replace(/\s+/g, ' ').trim();
}
function entities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? whole;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
function normalizedMessage(data, expectedId, expectedThread) {
  if (!hexId(data.id) || !hexId(data.threadId) || data.id.toLowerCase() !== expectedId.toLowerCase()
    || expectedThread && data.threadId.toLowerCase() !== expectedThread.toLowerCase() || !data.payload || typeof data.payload !== 'object') throw malformed();
  const headers = headerMap(data.payload.headers);
  const dateHeader = singleHeader(headers, 'date');
  let at = typeof data.internalDate === 'string' && /^\d{1,16}$/.test(data.internalDate) ? Number(data.internalDate) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(new Date(at).getTime())) at = dateHeader ? Date.parse(dateHeader) : NaN;
  const date = Number.isFinite(at) ? new Date(at).toISOString() : null;
  if (data.labelIds !== undefined && (!Array.isArray(data.labelIds) || data.labelIds.length > 100 || data.labelIds.some(label => typeof label !== 'string'))) throw malformed();
  return { headers, value: { id: data.id.toLowerCase(), threadId: data.threadId.toLowerCase(), from: display(headers.get('from')?.join(', ')), to: display(headers.get('to')?.join(', ')),
    subject: display(headers.get('subject')?.join(', ')), date }, unread: (data.labelIds ?? []).includes('UNREAD') };
}
function metadataUrl(id) {
  const url = new URL(`${API}/${id.toLowerCase()}`);
  url.searchParams.set('format', 'metadata');
  for (const header of HEADERS) url.searchParams.append('metadataHeaders', header);
  return url.href;
}

async function listMessages(input, google, fetchImpl) {
  const url = new URL(API);
  url.searchParams.set('labelIds', input.folder === 'sent' ? 'SENT' : 'INBOX');
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
  const data = await googleRead(url.href, google.accessToken, fetchImpl);
  const rows = data.messages === undefined && data.resultSizeEstimate === 0 ? [] : data.messages;
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE || rows.some(row => !hexId(row?.id) || !hexId(row?.threadId))
    || new Set(rows.map(row => row.id.toLowerCase())).size !== rows.length) throw malformed();
  const next = data.nextPageToken ?? null;
  if (next !== null && (!pageToken(next) || next === input.pageToken) || !rows.length && (next !== null || Number(data.resultSizeEstimate) > 0)) throw malformed();
  const messages = [];
  for (let index = 0; index < rows.length; index += 4) {
    messages.push(...await Promise.all(rows.slice(index, index + 4).map(async row => {
      const result = await googleRead(metadataUrl(row.id), google.accessToken, fetchImpl);
      const normalized = normalizedMessage(result, row.id, row.threadId);
      return { ...normalized.value, snippet: entities(display(result.snippet, 4096)), unread: normalized.unread };
    })));
  }
  return { messages, nextPageToken: next };
}

function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ['a', 'p', 'div', 'span', 'br', 'hr', 'blockquote', 'pre', 'code', 'b', 'strong', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'],
    allowedAttributes: { '*': ['style'], a: ['href', 'title', 'target', 'rel'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'noscript'],
    transformTags: { a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }) },
    allowedStyles: { '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^[a-z]{1,24}$/i], 'background-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]{1,24}$/i],
      'font-weight': [/^(?:normal|bold|[1-9]00)$/], 'font-size': [/^\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)$/],
      'font-family': [/^[a-z0-9\s,'"-]{1,100}$/i], 'text-align': [/^(?:left|right|center|justify)$/],
      'white-space': [/^(?:normal|pre|pre-wrap|pre-line)$/], 'line-height': [/^\d{1,3}(?:\.\d{1,2})?(?:px|em|%)?$/],
      padding: [/^(?:\d{1,3}(?:px|pt|em|%)?\s*){1,4}$/], margin: [/^(?:\d{1,3}(?:px|pt|em|%)?\s*){1,4}$/],
      width: [/^\d{1,4}(?:px|%)$/], 'max-width': [/^\d{1,4}(?:px|%)$/], 'border-collapse': [/^(?:collapse|separate)$/],
    } },
  });
}
function readBodies(payload) {
  const plain = [], html = []; let parts = 0, bytes = 0;
  function walk(part, depth) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) throw malformed();
    if (++parts > 100 || depth > 12) throw tooLarge();
    const headers = headerMap(part.headers);
    const mime = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
    if (part.filename || mime === 'message/rfc822' || /^\s*attachment(?:;|$)/i.test(singleHeader(headers, 'content-disposition') ?? '')) return;
    if (part.parts !== undefined) {
      if (!Array.isArray(part.parts)) throw malformed();
      for (const child of part.parts) walk(child, depth + 1);
    }
    if (!['text/plain', 'text/html'].includes(mime)) return;
    const body = part.body ?? {};
    if (body.attachmentId && body.data === undefined) throw tooLarge();
    if (body.size !== undefined && (!Number.isSafeInteger(body.size) || body.size < 0)) throw malformed();
    if (body.size > MAX_BODY) throw tooLarge();
    if (body.data === undefined) { if (body.size > 0) throw malformed(); return; }
    if (typeof body.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(body.data) || body.data.replace(/=+$/, '').length % 4 === 1) throw malformed();
    if (body.data.length > Math.ceil(MAX_BODY * 4 / 3) + 2) throw tooLarge();
    const decoded = Buffer.from(body.data, 'base64url'); bytes += decoded.length;
    if (bytes > MAX_BODY) throw tooLarge();
    const contentType = singleHeader(headers, 'content-type') ?? '';
    const charset = contentType.match(/charset\s*=\s*(?:"([^"\r\n]{1,40})"|([^;\s\r\n]{1,40}))/i)?.slice(1).find(Boolean) ?? 'utf-8';
    let text;
    try { text = new TextDecoder(charset, { fatal: true }).decode(decoded); }
    catch { throw new GmailMailError('GMAIL_ENCODING_UNSUPPORTED', 'This email uses a text encoding the CRM cannot display safely.', 422); }
    (mime === 'text/html' ? html : plain).push(text);
  }
  walk(payload, 0);
  const sanitized = cleanHtml(html.join('\n'));
  const fallback = entities(sanitizeHtml(sanitized.replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>|<br\s*\/?\s*>/gi, '$&\n'), { allowedTags: [], allowedAttributes: {} })).trim();
  return { text: plain.length ? plain.join('\n\n') : fallback || 'This message has no displayable text. Attachments are not displayed.', html: sanitized };
}

const addressPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
function singleMailbox(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) return null;
  let email = value.trim(), name = '';
  const angled = email.match(/^(.*?)<([^<>]+)>$/);
  if (angled) {
    email = angled[2].trim(); name = angled[1].trim();
    if (name.startsWith('"')) {
      if (!/^"(?:[^"\\]|\\["\\])*"$/.test(name)) return null;
      name = name.slice(1, -1).replace(/\\(["\\])/g, '$1');
    } else if (/[<>"@,;:()]/.test(name)) return null;
  }
  if (email.length > 254 || email.split('@')[0].length > 64 || !addressPattern.test(email)) return null;
  return { email: email.toLowerCase(), name: display(name, 512) };
}
function replyRecipient(headers, ownEmail) {
  const from = singleMailbox(singleHeader(headers, 'from'));
  const reply = headers.has('reply-to') ? singleMailbox(singleHeader(headers, 'reply-to')) : from;
  const recipient = from?.email === ownEmail || reply?.email === ownEmail ? singleMailbox(singleHeader(headers, 'to')) : reply;
  if (!recipient || recipient.email === ownEmail || /^(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer[._-]?daemon)(?:[+._-].*)?$/i.test(recipient.email.split('@')[0])) return null;
  return recipient;
}
const rfcId = value => typeof value === 'string' && value.length <= 254 && /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>$/.test(value);
function threading(headers) {
  const id = singleHeader(headers, 'message-id'), rawReferences = singleHeader(headers, 'references');
  const values = typeof rawReferences === 'string' && rawReferences.length <= 900 && !/[\x00-\x1f\x7f]/.test(rawReferences) ? rawReferences.trim().split(/ +/) : [];
  return { ...(rfcId(id) ? { rfcMessageId: id } : {}), ...(values.length > 0 && values.length <= 20 && values.every(rfcId) ? { references: values.join(' ') } : {}) };
}

/** Resolve the current server-side message again before preparing or sending a reply. */
export async function readReplyTarget(messageId, { user, env = process.env, db, fetchImpl = fetch, access = getGmailAccess }) {
  if (!hexId(messageId)) throw invalid();
  const google = await ownAccess({ user, env, db, fetchImpl, access });
  const data = await googleRead(metadataUrl(messageId), google.accessToken, fetchImpl);
  const normalized = normalizedMessage(data, messageId);
  const target = replyRecipient(normalized.headers, google.email.trim().toLowerCase());
  if (!target) throw replyUnavailable();
  const subject = normalized.value.subject.replace(/^(?:re:\s*)+/i, '').trim();
  return { email: target.email, name: target.name || target.email, firstName: target.name.split(/\s+/)[0] || '', route: 'unknown',
    subject: `Re: ${subject || '(no subject)'}`, threadId: normalized.value.threadId, ...threading(normalized.headers) };
}
async function readMessage(messageId, google, fetchImpl) {
  const data = await googleRead(`${API}/${messageId.toLowerCase()}?format=full`, google.accessToken, fetchImpl);
  const normalized = normalizedMessage(data, messageId);
  return { message: { ...normalized.value, ...readBodies(data.payload), canReply: Boolean(replyRecipient(normalized.headers, google.email.trim().toLowerCase())) } };
}
function safeError(error) {
  if (error instanceof GmailMailError) return error;
  if (['GMAIL_CONNECTION_REQUIRED', 'GMAIL_PERMISSION_REQUIRED', 'GMAIL_READ_PERMISSION_REQUIRED'].includes(error?.code)) {
    return new GmailMailError(error.code, 'Reconnect Google to allow reading your own Gmail mailbox.', error.code === 'GMAIL_CONNECTION_REQUIRED' ? 409 : 403);
  }
  return new GmailMailError('GMAIL_UNAVAILABLE', 'Your Gmail mailbox is unavailable. Check the Google connection and refresh.', 503);
}

export async function handleGmailMail(request, { getUser, env = process.env, getDb = getGmailDb, fetchImpl = fetch, access = getGmailAccess }) {
  const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...privateHeaders, ...extra } });
  if (request.method !== 'POST') return json({ error: 'Use a JSON mailbox request.', code: 'GMAIL_INVALID_REQUEST' }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    requireEmployee(user, env);
    if (!isAllowedOrigin(request, env.BETTER_AUTH_URL)) throw new GmailMailError('GMAIL_ORIGIN_NOT_ALLOWED', 'Open the CRM directly before reading Gmail.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Send a JSON request.', code: 'GMAIL_INVALID_REQUEST' }, 415);
    let bytes;
    try { bytes = await boundedBytes(request, 4096); }
    catch (error) { if (error instanceof GmailMailError && error.code === 'GMAIL_MESSAGE_TOO_LARGE') return json({ error: 'The mailbox request is too large.', code: 'GMAIL_INVALID_REQUEST' }, 413); throw invalid(); }
    let input;
    try { input = validateInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); } catch { throw invalid(); }
    const google = await ownAccess({ user, env, db: await getDb(), fetchImpl, access });
    return json(input.action === 'list' ? await listMessages(input, google, fetchImpl) : await readMessage(input.messageId, google, fetchImpl));
  } catch (error) {
    const safe = safeError(error);
    return json({ error: safe.message, code: safe.code }, safe.status);
  }
}
