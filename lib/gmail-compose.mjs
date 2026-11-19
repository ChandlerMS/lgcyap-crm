import { createHmac, timingSafeEqual } from 'node:crypto';
import { getGmailDb } from '../db/gmail.mjs';
import { getGmailAccess } from './gmail-connection.mjs';
import { editorAllowed } from './hubspot-write.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
import { offerTemplates, verifiedRecipient, validateEmailInput, renderOffer, emailMime } from './recruit-email.mjs';
const ID = /^[1-9]\d{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hexId = value => typeof value === 'string' && /^[a-f0-9]{1,40}$/i.test(value);
class DraftError extends Error { constructor(code, message, status = 400, uncertain = false) { super(message); this.code = code; this.status = status; this.uncertain = uncertain; } }
const uncertain = () => new DraftError('DRAFT_UNCERTAIN', 'The draft outcome is uncertain. Check Gmail Drafts before creating another draft.', 502, true);
const invalid = () => new DraftError('INVALID_EMAIL', 'Choose a recipient, complete the message, and preview it before continuing.');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function digest(secret, value) {
  if (typeof secret !== 'string' || secret.length < 32) throw new DraftError('GMAIL_UNAVAILABLE', 'Email preview authorization is unavailable.', 503);
  return createHmac('sha256', secret).update('gmail-template-draft:v1\0').update(JSON.stringify(value)).digest('hex');
}
export function draftLinks(email, threadId) {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}`;
  return { gmailUrl: hexId(threadId) ? `${base}#all/${threadId}` : `${base}#drafts`, draftsUrl: `${base}#drafts` };
}
const resolveReply = async (id, options) => (await import('./gmail-mail.mjs')).readReplyTarget(id, options);
const templateMeta = template => ({ id: template.id, name: template.name, route: template.route, subject: template.subject, fields: template.fields ?? [] });
function validateAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const composeKeys = ['action', 'recruitId', 'replyMessageId', 'templateId', 'subject', 'body', 'fields'];
  const keys = { status: ['action'], prepare: ['action', 'recruitId', 'replyMessageId'], preview: composeKeys, draft: ['action', 'recruitId', 'templateId', 'subject', 'body', 'fields', 'previewToken', 'requestId'], send: [...composeKeys, 'previewToken', 'requestId'] };
  if (!Object.hasOwn(keys, input.action) || Object.keys(input).some(key => !keys[input.action].includes(key))) throw invalid();
  if (input.action !== 'status') {
    if (Object.hasOwn(input, 'recruitId') === Object.hasOwn(input, 'replyMessageId')) throw invalid();
    if (Object.hasOwn(input, 'recruitId') ? typeof input.recruitId !== 'string' || !ID.test(input.recruitId) : !hexId(input.replyMessageId)) throw invalid();
  }
  if (['preview', 'draft', 'send'].includes(input.action)) {
    if (typeof (input.templateId ?? '') !== 'string' || (input.templateId ?? '').length > 40) throw invalid();
    const fields = input.fields ?? {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 10 || Object.values(fields).some(value => typeof value !== 'string' || value.length > 120)) throw invalid();
    validateEmailInput({ subject: input.subject, body: input.body ?? '' }, { maxSubjectLength: input.replyMessageId ? 1000 : 200 });
  }
  if (['draft', 'send'].includes(input.action) && (!UUID.test(input.requestId ?? '') || typeof input.previewToken !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(input.previewToken))) throw invalid();
}
async function render(input, { recipient: readRecipient, templates, env, user, db, access, fetchImpl, replyTarget = resolveReply }) {
  const recipient = input.replyMessageId ? await replyTarget(input.replyMessageId, { user, env, db, access, fetchImpl }) : await readRecipient(input.recruitId, { accessToken: env.HUBSPOT_ACCESS_TOKEN });
  const { subject, body } = validateEmailInput({ subject: input.subject, body: input.body ?? '' }, { maxSubjectLength: input.replyMessageId ? 1000 : 200 });
  if (input.replyMessageId && subject !== recipient.subject) throw new DraftError('REPLY_SUBJECT_CHANGED', 'Keep the reply subject to continue this conversation, or start a new email.');
  const fields = input.fields ?? {};
  const template = input.templateId ? templates.find(row => row.id === input.templateId) : null;
  if (input.templateId && !template) throw new DraftError('TEMPLATE_UNAVAILABLE', 'This template is unavailable. Choose another template and preview again.');
  if (Object.keys(fields).some(key => !(template?.fields ?? []).includes(key))) throw invalid();
  let content = { text: body, html: `<div style="white-space:pre-wrap">${escape(body)}</div>` }, assets = [];
  if (template) {
    content = renderOffer(template, recipient, fields); assets = template.assets ?? [];
    if (body) { content.text += `\n\n${body}`; content.html += `<p style="white-space:pre-wrap">${escape(body)}</p>`; }
  } else if (!body) throw new DraftError('EMPTY_MESSAGE', 'Write a message before previewing.');
  return { recipient, subject, ...content, assets };
}
const previewBinding = (value, user) => ({ userId: user.userId, email: user.email.toLowerCase(), value });
async function googleDraftJson(url, init, fetchImpl, mutation = false) {
  let response;
  try { response = await fetchImpl(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw mutation ? uncertain() : new DraftError('GMAIL_UNAVAILABLE', 'Gmail could not confirm the draft. Check Gmail Drafts.', 503); }
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new DraftError('GMAIL_PERMISSION_REQUIRED', 'Google could not authorize email. Enable Gmail API for this Google app and reconnect Gmail; your Workspace administrator may need to approve access.', 403);
    if (response.status === 429) throw new DraftError('GMAIL_RATE_LIMITED', 'Gmail is limiting requests. Wait before preparing another draft.', 429);
    if ([400, 404].includes(response.status)) throw new DraftError('DRAFT_REJECTED', 'Gmail did not accept the draft. Check the connection and preview again.', 502);
    throw mutation ? uncertain() : new DraftError('GMAIL_UNAVAILABLE', 'Gmail could not confirm the draft. Check Gmail Drafts.', 503);
  }
  try {
    const reader = response.body?.getReader(); if (!reader) throw Error();
    const parts = []; let bytes = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2000000) { await reader.cancel(); throw Error(); } parts.push(chunk.value); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { throw mutation ? uncertain() : new DraftError('GMAIL_UNAVAILABLE', 'Gmail returned an incomplete draft confirmation.', 503); }
}
export async function createGmailTemplateDraft(input, { user, env, db, recipient = verifiedRecipient, templates = offerTemplates(env), access = getGmailAccess, fetchImpl = fetch, now = Date.now }) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production') throw new DraftError('GMAIL_DISABLED', 'Create Gmail drafts from the production CRM.', 403);
  validateAction({ ...input, action: 'draft' });
  const content = await render(input, { recipient, templates, env });
  const [stamp, signature] = input.previewToken.split('.'), expires = Number(stamp);
  const expected = digest(env.BETTER_AUTH_SECRET, { ...previewBinding(content, user), expires });
  if (expires <= now() || expires > now() + 600000 || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new DraftError('PREVIEW_CHANGED', 'The message, template, or recruit changed. Preview the email again.', 409);
  // Credentials and Google identity are checked before claiming a draft operation.
  const google = await access({ user, env, db, fetchImpl });
  if (google.email?.toLowerCase() !== user.email.toLowerCase() || !google.accessToken) throw new DraftError('GMAIL_ACCOUNT_MISMATCH', 'Reconnect the Google account matching your CRM sign-in.', 403);
  const raw = emailMime({ from: google.email, to: content.recipient.email, subject: content.subject, text: content.text, html: content.html, assets: content.assets });
  const hash = digest(env.BETTER_AUTH_SECRET, previewBinding(content, user));
  const args = [user.userId, input.requestId.toLowerCase()];
  const claim = await db.query("INSERT INTO gmail_draft_requests (user_id,request_id,payload_hash,status) VALUES ($1,$2,$3,'pending') ON CONFLICT DO NOTHING RETURNING request_id", [...args, hash]);
  if (!claim.rows.length) {
    const previous = (await db.query('SELECT payload_hash,status,draft_id,message_id,thread_id FROM gmail_draft_requests WHERE user_id=$1 AND request_id=$2', args)).rows[0];
    if (!previous || previous.payload_hash !== hash) throw new DraftError('REQUEST_ID_REUSED', 'This draft request has already been used. Start a new email.', 409);
    if (previous.status === 'created') return { created: true, replayed: true, draftId: previous.draft_id, ...draftLinks(google.email, previous.thread_id), notice: 'This draft was already created. Review and send it in Gmail.' };
    throw uncertain();
  }
  let accepted = false;
  try {
    const headers = { Authorization: `Bearer ${google.accessToken}`, 'Content-Type': 'application/json' };
    const draft = await googleDraftJson('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', headers, body: JSON.stringify({ message: { raw } }) }, fetchImpl, true);
    accepted = true;
    if (typeof draft.id !== 'string' || !/^[\w-]{1,200}$/.test(draft.id) || !hexId(draft.message?.id) || !hexId(draft.message?.threadId)) throw uncertain();
    await db.query('UPDATE gmail_draft_requests SET draft_id=$3,message_id=$4,thread_id=$5,updated_at=now() WHERE user_id=$1 AND request_id=$2', [...args, draft.id, draft.message.id, draft.message.threadId]);
    const confirmed = await googleDraftJson(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draft.id)}?format=minimal`, { method: 'GET', headers: { Authorization: headers.Authorization } }, fetchImpl);
    if (confirmed.id !== draft.id || confirmed.message?.id !== draft.message.id || confirmed.message?.threadId !== draft.message.threadId || !confirmed.message?.labelIds?.includes('DRAFT')) throw uncertain();
    const saved = await db.query("UPDATE gmail_draft_requests SET status='created',updated_at=now() WHERE user_id=$1 AND request_id=$2 RETURNING request_id", args);
    if (!saved.rows.length) throw uncertain();
    return { created: true, draftId: draft.id, ...draftLinks(google.email, draft.message.threadId), notice: 'Draft created in Gmail. Review it and click Send there.' };
  } catch (error) {
    // Once a draft POST might have succeeded, every failed confirmation is uncertain.
    const safe = !accepted && error instanceof DraftError && ['GMAIL_PERMISSION_REQUIRED', 'GMAIL_RATE_LIMITED', 'DRAFT_REJECTED'].includes(error.code) ? error : uncertain();
    try { await db.query('UPDATE gmail_draft_requests SET status=$3,updated_at=now() WHERE user_id=$1 AND request_id=$2', [...args, safe.uncertain ? 'uncertain' : 'failed']); } catch { /* A pending claim also blocks replay. */ }
    throw safe;
  }
}
const uncertainSend = requestId => Object.assign(new DraftError('SEND_UNCERTAIN', 'Delivery could not be confirmed. Check Sent in Email before starting another message.', 502, true), { unresolvedRequestId: requestId });
export async function sendGmailTemplateEmail(input, { user, env, db, recipient = verifiedRecipient, templates = offerTemplates(env), access = getGmailAccess, replyTarget = resolveReply, fetchImpl = fetch, now = Date.now }) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production' || !editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) throw new DraftError('GMAIL_DISABLED', 'Send email from the production CRM.', 403);
  validateAction({ ...input, action: 'send' });
  const content = await render(input, { recipient, templates, env, user, db, access, fetchImpl, replyTarget });
  const [stamp, signature] = input.previewToken.split('.'), expires = Number(stamp);
  const expected = digest(env.BETTER_AUTH_SECRET, { ...previewBinding(content, user), expires });
  if (expires <= now() || expires > now() + 600000 || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new DraftError('PREVIEW_CHANGED', 'The message, template, or recipient changed. Preview the email again.', 409);
  const google = await access({ user, env, db, fetchImpl, requireRead: true });
  if (google.email?.toLowerCase() !== user.email.toLowerCase() || !google.accessToken) throw new DraftError('GMAIL_ACCOUNT_MISMATCH', 'Reconnect the Google account matching your CRM sign-in.', 403);
  let raw = emailMime({ from: google.email, to: content.recipient.email, subject: content.subject, text: content.text, html: content.html, assets: content.assets, subjectLimit: input.replyMessageId ? 1000 : 200 });
  if (input.replyMessageId) {
    if (!hexId(content.recipient.threadId)) throw invalid();
    const headers = [];
    const messageId = content.recipient.rfcMessageId, refs = content.recipient.references;
    if (messageId) {
      if (!/^<[^<>\s\x00-\x1f\x7f]{1,250}>$/.test(messageId)) throw invalid();
      headers.push(`In-Reply-To: ${messageId}`);
    }
    if (refs) {
      if (refs.length > 2048 || !/^(?:<[^<>\s\x00-\x1f\x7f]{1,250}>)(?: <[^<>\s\x00-\x1f\x7f]{1,250}>)*$/.test(refs)) throw invalid();
    }
    const referenceIds = [...new Set([...(refs?.split(' ') ?? []), ...(messageId ? [messageId] : [])])];
    if (referenceIds.length) headers.push(`References: ${referenceIds.join('\r\n ')}`);
    if (headers.length) raw = Buffer.from(`${headers.join('\r\n')}\r\n${Buffer.from(raw, 'base64url').toString('utf8')}`).toString('base64url');
  }
  const hash = digest(env.BETTER_AUTH_SECRET, previewBinding(content, user)), args = [user.userId, input.requestId.toLowerCase()];
  const claim = await db.query("INSERT INTO gmail_send_requests (user_id,request_id,payload_hash,status) VALUES ($1,$2,$3,'pending') ON CONFLICT DO NOTHING RETURNING request_id", [...args, hash]);
  if (!claim.rows.length) {
    const previous = (await db.query('SELECT payload_hash,status,message_id,thread_id FROM gmail_send_requests WHERE user_id=$1 AND request_id=$2', args)).rows[0];
    if (!previous) {
      const unresolved = (await db.query("SELECT request_id FROM gmail_send_requests WHERE user_id=$1 AND status IN ('pending','uncertain') LIMIT 1", [user.userId])).rows[0];
      throw uncertainSend(unresolved?.request_id ?? input.requestId);
    }
    if (previous.payload_hash !== hash) throw new DraftError('REQUEST_ID_REUSED', 'This message request has already been used. Start a new email.', 409);
    if (previous.status === 'sent') return { sent: true, replayed: true, messageId: previous.message_id, threadId: previous.thread_id, notice: 'This email was already sent.' };
    throw uncertainSend(input.requestId);
  }
  let accepted = false;
  try {
    const headers = { Authorization: `Bearer ${google.accessToken}`, 'Content-Type': 'application/json' };
    const message = await googleDraftJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers, body: JSON.stringify({ raw, ...(input.replyMessageId ? { threadId: content.recipient.threadId } : {}) }) }, fetchImpl, true);
    accepted = true;
    if (!hexId(message.id) || !hexId(message.threadId) || input.replyMessageId && message.threadId !== content.recipient.threadId) throw uncertainSend(input.requestId);
    await db.query('UPDATE gmail_send_requests SET message_id=$3,thread_id=$4,updated_at=now() WHERE user_id=$1 AND request_id=$2', [...args, message.id, message.threadId]);
    const confirmed = await googleDraftJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=minimal`, { method: 'GET', headers: { Authorization: headers.Authorization } }, fetchImpl);
    if (confirmed.id !== message.id || confirmed.threadId !== message.threadId || !confirmed.labelIds?.includes('SENT')) throw uncertainSend(input.requestId);
    const saved = await db.query("UPDATE gmail_send_requests SET status='sent',updated_at=now() WHERE user_id=$1 AND request_id=$2 RETURNING request_id", args);
    if (!saved.rows.length) throw uncertainSend(input.requestId);
    return { sent: true, messageId: message.id, threadId: message.threadId, notice: 'Email sent successfully.' };
  } catch (error) {
    const safe = !accepted && error instanceof DraftError && ['GMAIL_PERMISSION_REQUIRED', 'GMAIL_RATE_LIMITED', 'DRAFT_REJECTED'].includes(error.code)
      ? new DraftError(error.code === 'DRAFT_REJECTED' ? 'SEND_REJECTED' : error.code, error.code === 'DRAFT_REJECTED' ? 'Gmail did not accept the email. Check the connection and preview again.' : error.message, error.status)
      : uncertainSend(input.requestId);
    try { await db.query('UPDATE gmail_send_requests SET status=$3,updated_at=now() WHERE user_id=$1 AND request_id=$2', [...args, safe.uncertain ? 'uncertain' : 'failed']); } catch { /* A pending intent also blocks a second send. */ }
    throw safe;
  }
}
export async function handleGmailCompose(request, { getUser, env = process.env, getDb = getGmailDb, recipient = verifiedRecipient, templates: configuredTemplates = undefined, access = getGmailAccess, replyTarget = resolveReply, fetchImpl = fetch, now = Date.now }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Sign in to prepare email.' }, 401);
    if (!editorAllowed(user, env.RECRUITING_EDITOR_EMAILS) || !isAllowedOrigin(request, env.BETTER_AUTH_URL)) return json({ error: 'Access denied.' }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Use JSON.' }, 415);
    const reader = request.body?.getReader(), parts = []; let length = 0;
    if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 200000) { await reader.cancel(); return json({ error: 'Email request is too large.' }, 413); } parts.push(chunk.value); }
    let input; try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw invalid(); }
    validateAction(input);
    const templates = configuredTemplates ?? offerTemplates(env);
    const available = env.VERCEL === '1' && env.VERCEL_ENV === 'production';
    if (input.action === 'status') return json({ sender: user.email, available, templates: templates.map(templateMeta) });
    if (input.action === 'prepare') {
      const target = input.replyMessageId ? await replyTarget(input.replyMessageId, { user, env, db: await getDb(), access, fetchImpl }) : await recipient(input.recruitId, { accessToken: env.HUBSPOT_ACCESS_TOKEN });
      return json({ recipient: target, templates: templates.filter(row => row.route === target.route).map(templateMeta), ...(input.replyMessageId ? { subject: target.subject } : {}) });
    }
    if (input.action === 'preview') {
      const content = await render(input, { recipient, templates, env, user, db: input.replyMessageId ? await getDb() : undefined, access, fetchImpl, replyTarget });
      const expires = now() + 600000;
      let html = content.html;
      for (const asset of content.assets) html = html.replaceAll(`cid:${asset.cid}`, `data:image/png;base64,${asset.data}`);
      return json({ recipient: content.recipient, subject: content.subject, html, previewToken: `${expires}.${digest(env.BETTER_AUTH_SECRET, { ...previewBinding(content, user), expires })}` });
    }
    if (!available) return json({ error: 'Email delivery is available on the production CRM only.' }, 403);
    if (input.action === 'send') return json(await sendGmailTemplateEmail(input, { user, env, db: await getDb(), recipient, templates, access, replyTarget, fetchImpl, now }));
    return json(await createGmailTemplateDraft(input, { user, env, db: await getDb(), recipient, templates, access, fetchImpl, now }));
  } catch (error) {
    const known = error instanceof DraftError || error instanceof Error && (typeof error.code === 'string' && /^(?:GMAIL_|HUBSPOT_)[A-Z_]+$/.test(error.code) || !error.code && [400, 404, 409].includes(error.status));
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
    return json({ error: known ? error.message : 'Email is unavailable. If you were sending, check Sent in Email before trying again.', code: known ? error.code ?? 'EMAIL_DETAILS_REQUIRED' : 'GMAIL_UNAVAILABLE', uncertain: error?.uncertain === true, ...(UUID.test(error?.unresolvedRequestId ?? '') ? { unresolvedRequestId: error.unresolvedRequestId } : {}) }, status);
  }
}
