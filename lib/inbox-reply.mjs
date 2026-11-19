import { createHmac, timingSafeEqual } from 'node:crypto';
import { isAllowedOrigin } from './hubspot.mjs';
import { editorAllowed, writeCapability, WriteError } from './hubspot-write.mjs';

const API = 'https://api.hubapi.com';
const THREADS = '/conversations/v3/conversations/threads';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = value => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : null;
const fail = (code, message, status = 400, extras = {}) => new WriteError(code, message, status, extras);
const invalid = () => fail('INVALID_REPLY', 'Choose a conversation and enter a reply of 1–10,000 characters.');
const unavailable = () => fail('REPLY_UNAVAILABLE', 'Conversation replies are temporarily unavailable.', 503);
const uncertain = () => fail('REPLY_UNCERTAIN', 'The send outcome is uncertain. Check the conversation in HubSpot before sending again.', 502, { uncertain: true });
const hmac = (secret, value) => createHmac('sha256', secret).update('inbox-reply:v1\0').update(JSON.stringify(value)).digest('hex');
const validKey = options => typeof options.hmacSecret === 'string' && options.hmacSecret.length >= 32 && typeof options.accessToken === 'string' && options.accessToken && options.accessToken.length <= 4096 && !/[\r\n]/.test(options.accessToken);

async function provider(path, options, { method = 'GET', body, sending = false } = {}) {
  let response;
  try {
    response = await (options.fetchImpl ?? fetch)(API + path, { method, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${options.accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw sending ? uncertain() : unavailable(); }
  if (!response.ok) {
    await response.body?.cancel();
    if (sending && ![400, 401, 403, 404, 429].includes(response.status)) throw uncertain();
    if (response.status === 429) throw fail('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before trying again.', 429);
    if ([401, 403].includes(response.status)) throw fail('HUBSPOT_REPLY_ACCESS_REQUIRED', 'The connected HubSpot app needs conversations.read, conversations.write and owner-read permission to send replies.', 403);
    if (response.status === 404) throw fail('CONVERSATION_NOT_FOUND', 'This conversation is unavailable. Refresh the Inbox.', 404);
    throw fail('HUBSPOT_REPLY_REJECTED', 'HubSpot did not accept this reply. Refresh the conversation before trying again.', 502);
  }
  try {
    const reader = response.body?.getReader(), parts = []; let size = 0;
    if (!reader) throw Error();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw Error(); } parts.push(chunk.value); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { throw sending ? uncertain() : unavailable(); }
}

async function verifyAccess(options) {
  if (!validKey(options)) throw unavailable();
  const info = await provider('/oauth/v2/private-apps/get/access-token-info', options, { method: 'POST', body: { tokenKey: options.accessToken } });
  if (String(info.hubId) !== '50894788' || String(info.appId) !== '59264745' || !['conversations.read', 'conversations.write', 'crm.objects.owners.read'].every(scope => info.scopes?.includes(scope))) throw fail('HUBSPOT_REPLY_ACCESS_REQUIRED', 'The connected HubSpot app must have conversations.read, conversations.write and crm.objects.owners.read access in the approved account.', 403);
}

function recipient(raw, email, incoming) {
  if (!raw || raw.actorId?.startsWith('A-') || raw.actorId?.startsWith('I-') || raw.actorId?.startsWith('S-')) return null;
  if (!incoming && raw.recipientField && !['TO', 'CC'].includes(raw.recipientField)) return null;
  const delivery = raw.deliveryIdentifier ?? (raw.deliveryIdentifiers?.length === 1 ? raw.deliveryIdentifiers[0] : null);
  if (email && (!delivery || delivery.type !== 'HS_EMAIL_ADDRESS' || typeof delivery.value !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(delivery.value) || delivery.value.length > 254)) return null;
  if (!email && (typeof raw.actorId !== 'string' || !/^V-[\w-]{1,180}$/.test(raw.actorId))) return null;
  return { ...(raw.actorId && /^V-[\w-]{1,180}$/.test(raw.actorId) ? { actorId: raw.actorId } : {}), ...(email ? { deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: delivery.value } } : { actorId: raw.actorId }), recipientField: incoming ? 'TO' : raw.recipientField || 'TO' };
}

async function loadContext(threadId, options) {
  if (!id(threadId) || typeof options.user?.email !== 'string') throw invalid();
  const [thread, page, owners] = await Promise.all([
    provider(`${THREADS}/${threadId}`, options),
    provider(`${THREADS}/${threadId}/messages?limit=100&archived=false&sort=-createdAt`, options),
    provider(`/crm/v3/owners/?email=${encodeURIComponent(options.user.email)}&archived=false&limit=100`, options),
  ]);
  if (String(thread.id) !== threadId || thread.archived === true) throw fail('CONVERSATION_ARCHIVED', 'This conversation is unavailable or archived. Open it in HubSpot to reply.', 409);
  const matches = owners.results?.filter(owner => owner.archived !== true && owner.email?.toLowerCase() === options.user.email.toLowerCase() && id(owner.userId));
  if (matches?.length !== 1 || owners.paging?.next) throw fail('HUBSPOT_SENDER_REQUIRED', 'Your sign-in email must match one active HubSpot user before you can reply here.', 403);
  if (!Array.isArray(page.results)) throw unavailable();
  const message = page.results.filter(value => value.type === 'MESSAGE' && value.archived !== true).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!message || typeof message.id !== 'string' || !message.id || !Number.isFinite(Date.parse(message.createdAt)) || !['INCOMING', 'OUTGOING'].includes(message.direction) || !['1000', '1001', '1002'].includes(String(message.channelId)) || !id(message.channelAccountId)) throw fail('CHANNEL_UNSUPPORTED', 'Reply to this conversation in HubSpot; its channel cannot send from this window.', 409);
  if (message.conversationsThreadId !== undefined && String(message.conversationsThreadId) !== threadId) throw unavailable();
  const incoming = message.direction === 'INCOMING', email = String(message.channelId) === '1002';
  const raw = incoming ? message.senders : message.recipients;
  if (!Array.isArray(raw) || !raw.length || raw.length > 25) throw fail('RECIPIENT_UNAVAILABLE', 'HubSpot did not provide a verified reply recipient. Open this conversation in HubSpot.', 409);
  const recipients = raw.map(value => recipient(value, email, incoming)).filter(Boolean);
  if (!recipients.length || incoming && recipients.length !== raw.length) throw fail('RECIPIENT_UNAVAILABLE', 'HubSpot did not provide a verified reply recipient. Open this conversation in HubSpot.', 409);
  return { threadId, latestMessageId: message.id, senderActorId: `A-${matches[0].userId}`, channelId: String(message.channelId), channelAccountId: String(message.channelAccountId), recipients, ...(email && typeof message.subject === 'string' ? { subject: message.subject.slice(0, 998) } : {}) };
}
const binding = (context, options, expires) => ({ context, userId: options.user.userId, email: options.user.email.toLowerCase(), credential: hmac(options.hmacSecret, options.accessToken), expires });

export async function prepareInboxReply(threadId, options) {
  await verifyAccess(options);
  const context = await loadContext(threadId, options), expires = (options.now ?? Date.now)() + 600000;
  return { contextToken: `${expires}.${hmac(options.hmacSecret, binding(context, options, expires))}`, threadId, senderLabel: options.user.email, channelLabel: ({ 1000: 'Live chat', 1001: 'Messenger', 1002: 'Email' })[context.channelId], recipientLabel: context.recipients.map(value => value.deliveryIdentifier?.value ?? value.actorId).join(', ') };
}
function validateSend(input) {
  if (!input || !id(input.threadId) || !UUID.test(input.requestId ?? '') || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) throw invalid();
  if (typeof input.contextToken !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(input.contextToken)) throw fail('REPLY_CONTEXT_CHANGED', 'Refresh reply details and review the recipient before sending.', 409);
  return { threadId: input.threadId, requestId: input.requestId, text: input.text.trim(), contextToken: input.contextToken };
}
export async function sendInboxReply(input, options) {
  input = validateSend(input);
  await verifyAccess(options);
  const now = options.now ?? Date.now;
  const identity = { userId: options.user.userId, requestId: input.requestId, ticketId: `inbox:${input.threadId}`, hash: hmac(options.hmacSecret, input) };
  let claim;
  try { claim = await options.ledger.claim({ ...identity, now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.hash && claim.hash !== identity.hash) throw fail('REQUEST_ID_REUSED', 'This reply request was already used. Refresh before composing another reply.', 409);
    if (claim.status === 'saved') return { status: 'sent', replayed: true, requestId: input.requestId };
    if (claim.status === 'uncertain') throw uncertain();
    throw fail('REPLY_ALREADY_PROCESSED', 'This reply is already sending or was processed. Refresh the conversation before sending again.', 409);
  }
  try {
    const context = await loadContext(input.threadId, options);
    const [stamp, signature] = input.contextToken.split('.'), expires = Number(stamp);
    const expected = hmac(options.hmacSecret, binding(context, options, expires));
    if (expires <= now() || expires > now() + 600000 || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw fail('REPLY_CONTEXT_CHANGED', 'The conversation changed or reply details expired. Refresh reply details and review the recipient before sending.', 409);
    const address = { senderActorId: context.senderActorId, channelId: context.channelId, channelAccountId: context.channelAccountId, recipients: context.recipients.map(value => ({ ...value, deliveryIdentifiers: value.deliveryIdentifier ? [value.deliveryIdentifier] : [] })), ...(context.subject ? { subject: context.subject } : {}) };
    const message = await provider(`${THREADS}/${input.threadId}/messages`, options, { method: 'POST', sending: true, body: { ...address, type: 'MESSAGE', text: input.text, attachments: [] } });
    if (!message || typeof message.id !== 'string' || !message.id || message.type !== 'MESSAGE' || message.direction !== 'OUTGOING' || String(message.conversationsThreadId) !== input.threadId || message.text !== input.text || message.status?.statusType === 'FAILED') throw uncertain();
    if (!await options.ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
    return { status: 'sent', requestId: input.requestId, messageId: message.id, notice: 'Reply accepted by HubSpot.' };
  } catch (error) {
    const safe = error instanceof WriteError ? error : uncertain();
    try { await options.ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* A pending claim also blocks duplicate sends. */ }
    throw safe;
  }
}

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
/** All recipients, channel and actor IDs are obtained server-side, never accepted from the browser. */
export async function handleInboxReplyRequest(request, options) {
  const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS });
  if (request.method !== 'POST') return json({ error: { message: 'Use POST.' } }, 405);
  try {
    const user = await options.getUser();
    if (!user) return json({ error: { message: 'Sign in to reply.' } }, 401);
    if (!editorAllowed(user, options.editorEmails) || !isAllowedOrigin(request, options.allowedOrigin)) throw fail('ACCESS_DENIED', 'Access denied.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: { message: 'Use JSON.' } }, 415);
    const reader = request.body?.getReader(), chunks = []; let size = 0;
    if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 50000) { await reader.cancel(); return json({ error: { message: 'Reply too large.' } }, 413); } chunks.push(chunk.value); }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
    if (!input || Array.isArray(input) || !['prepare', 'send'].includes(input.action) || typeof input.threadId !== 'string' || !id(input.threadId) || Object.keys(input).some(key => !(input.action === 'prepare' ? ['action', 'threadId'] : ['action', 'threadId', 'requestId', 'text', 'contextToken']).includes(key))) throw invalid();
    if (input.action === 'send') validateSend(input);
    const ledger = options.getLedger();
    if (!writeCapability(user, { ...options, ledger })) throw fail('REPLIES_DISABLED', 'Replies are disabled in this environment. Open the conversation in HubSpot to reply.', 403);
    const deps = { ...options, user, ledger };
    return json(input.action === 'prepare' ? await (options.prepare ?? prepareInboxReply)(input.threadId, deps) : await sendInboxReply(input, deps));
  } catch (error) {
    const safe = error instanceof WriteError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message, uncertain: safe.uncertain === true } }, safe.status);
  }
}
