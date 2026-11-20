import { createHmac, timingSafeEqual } from 'node:crypto';
import { inboxProvider, verifyInboxAccess } from './inbox-reply.mjs';
import { editorAllowed, writeCapability, WriteError } from './hubspot-write.mjs';
import { isAllowedOrigin } from './hubspot.mjs';
const THREADS = '/conversations/v3/conversations/threads';
const id = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (code, message, status = 400, extras = {}) => new WriteError(code, message, status, extras);
const unavailable = () => fail('THREAD_UNAVAILABLE', 'Conversation controls are temporarily unavailable.', 503);
const uncertain = () => fail('THREAD_UNCERTAIN', 'The update outcome is uncertain. Refresh the conversation to check its status before making another change.', 502, { uncertain: true });
const hash = (secret, value) => createHmac('sha256', secret).update('inbox-thread:v1\0').update(JSON.stringify(value)).digest('hex');
const binding = (thread, options, expires) => ({ thread, userId: options.user.userId, email: options.user.email.toLowerCase(), credential: hash(options.hmacSecret, options.accessToken), expires });
async function readThread(threadId, options) {
  let thread;
  try { thread = await inboxProvider(`${THREADS}/${threadId}`, options); }
  catch (error) { if (error.code !== 'CONVERSATION_NOT_FOUND') throw error; thread = await inboxProvider(`${THREADS}/${threadId}?archived=true`, options); }
  if (String(thread.id) !== threadId || !['OPEN', 'CLOSED'].includes(thread.status) || typeof thread.archived !== 'boolean') throw unavailable();
  return { threadId, status: thread.status, archived: thread.archived, assignedTo: thread.assignedTo ?? null, latestMessageTimestamp: thread.latestMessageTimestamp ?? null };
}
export async function prepareInboxThread(threadId, options) {
  if (!id(threadId)) throw unavailable();
  await verifyInboxAccess(options);
  const thread = await readThread(threadId, options), expires = (options.now ?? Date.now)() + 600000;
  return { ...thread, contextToken: `${expires}.${hash(options.hmacSecret, binding(thread, options, expires))}` };
}
export async function updateInboxThread(input, options) {
  if (!id(input.threadId) || !uuid(input.requestId) || !['close', 'reopen', 'restore'].includes(input.operation) || typeof input.contextToken !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(input.contextToken)) throw fail('INVALID_THREAD_UPDATE', 'Refresh the conversation before changing its status.');
  await verifyInboxAccess(options);
  const now = options.now ?? Date.now;
  const identity = { userId: options.user.userId, requestId: input.requestId, ticketId: `inbox-thread:${input.threadId}`, hash: hash(options.hmacSecret, input) };
  let claim;
  try { claim = await options.ledger.claim({ ...identity, now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.hash !== identity.hash) throw fail('REQUEST_ID_REUSED', 'This request was already used for another update.', 409);
    if (claim.status === 'saved') return { status: 'saved', replayed: true };
    throw uncertain();
  }
  try {
    const thread = await readThread(input.threadId, options);
    const [stamp, signature] = input.contextToken.split('.'), expires = Number(stamp);
    const expected = hash(options.hmacSecret, binding(thread, options, expires));
    if (expires <= now() || expires > now() + 600000 || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw fail('THREAD_CHANGED', 'The conversation changed. Refresh its details before updating.', 409);
    if ((input.operation === 'restore') !== thread.archived) throw fail('THREAD_CHANGED', 'Refresh the conversation before making this change.', 409);
    const patch = input.operation === 'restore' ? { archived: false } : { status: input.operation === 'close' ? 'CLOSED' : 'OPEN' };
    let saved;
    try { saved = await inboxProvider(`${THREADS}/${input.threadId}${thread.archived ? '?archived=true' : ''}`, options, { method: 'PATCH', body: patch, sending: true }); }
    catch (error) { if (error.uncertain) throw uncertain(); throw error; }
    if (String(saved.id) !== input.threadId || Object.entries(patch).some(([key, value]) => saved[key] !== value)) throw uncertain();
    if (!await options.ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
    return { status: 'saved', threadId: input.threadId, notice: 'Conversation updated in HubSpot.' };
  } catch (error) {
    const safe = error instanceof WriteError ? error : uncertain();
    try { await options.ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* An unresolved claim blocks duplicate writes. */ }
    throw safe;
  }
}
export async function handleInboxThreadRequest(request, options) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  if (request.method !== 'POST') return json({ error: { message: 'Use POST.' } }, 405);
  try {
    const user = await options.getUser();
    if (!user) return json({ error: { message: 'Sign in to manage conversations.' } }, 401);
    if (!editorAllowed(user, options.editorEmails) || !isAllowedOrigin(request, options.allowedOrigin)) throw fail('ACCESS_DENIED', 'Access denied.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw fail('INVALID_REQUEST', 'Use JSON.', 415);
    const reader = request.body?.getReader(), parts = []; let size = 0;
    if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 4000) { await reader.cancel(); throw fail('INVALID_REQUEST', 'Request too large.', 413); } parts.push(chunk.value); }
    let input; try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw fail('INVALID_REQUEST', 'Use valid JSON.'); }
    if (!input || Array.isArray(input) || !['prepare', 'update'].includes(input.action) || !id(input.threadId) || Object.keys(input).some(key => !(input.action === 'prepare' ? ['action', 'threadId'] : ['action', 'threadId', 'requestId', 'operation', 'contextToken']).includes(key))) throw fail('INVALID_REQUEST', 'Choose a conversation and a supported status change.');
    const ledger = options.getLedger();
    if (!writeCapability(user, { ...options, ledger })) throw fail('THREAD_EDITS_DISABLED', 'Conversation updates are disabled for this account or environment.', 403);
    const deps = { ...options, user, ledger };
    return json(input.action === 'prepare' ? await prepareInboxThread(input.threadId, deps) : await updateInboxThread(input, deps));
  } catch (error) { const safe = error instanceof WriteError ? error : unavailable(); return json({ error: { code: safe.code, message: safe.message, uncertain: safe.uncertain === true } }, safe.status); }
}
