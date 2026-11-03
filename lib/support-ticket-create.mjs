import { createHmac } from 'node:crypto';
import { WriteError, writeCapability } from './hubspot-write.mjs';
import { verifyToolWriteAccess } from './hubspot-tool-write.mjs';
import { isAllowedOrigin } from './hubspot.mjs';

const BASE = 'https://api.hubapi.com';
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const validId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const unavailable = () => new WriteError('CREATE_UNAVAILABLE', 'Support ticket creation is unavailable. Try again later.', 503);
const uncertain = () => new WriteError('CREATE_UNCERTAIN', 'The ticket may have been created. Check Help Desk or HubSpot before starting another ticket.', 502, { uncertain: true });

export function validateSupportTicket(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'title', 'description', 'priority'].includes(key))
    || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw new WriteError('INVALID_TICKET', 'Start a new support ticket before saving.', 400);
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(input.title)) throw new WriteError('INVALID_TICKET', 'Enter a ticket title of up to 200 characters.', 400);
  if (typeof input.description !== 'string' || input.description.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.description)) throw new WriteError('INVALID_TICKET', 'Enter a description of up to 4,000 characters.', 400);
  if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(input.priority)) throw new WriteError('INVALID_TICKET', 'Choose a valid priority.', 400);
  return { requestId: input.requestId.toLowerCase(), title: input.title.trim(), description: input.description.trim().replace(/\r\n?/g, '\n'), priority: input.priority };
}

async function boundedJson(source, limit) {
  const reader = source.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new RangeError('Body too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function provider(path, { accessToken, fetchImpl, timeoutMs }, body) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${BASE}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status !== (body ? 201 : 200)) {
      if (body && !(response.status >= 400 && response.status < 500)) throw uncertain();
      if (response.status === 429) throw new WriteError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before trying again.', 429, { retryAfterSeconds: 60 });
      if ([401, 403].includes(response.status)) throw new WriteError('HUBSPOT_ACCESS_REQUIRED', 'The app needs HubSpot ticket access before it can create support tickets.', 403);
      if (body && [400, 409, 422].includes(response.status)) throw new WriteError('TICKET_REJECTED', 'HubSpot rejected this ticket. Review the fields before trying again.', 400);
      throw unavailable();
    }
    return await boundedJson(response, 512 * 1024);
  } catch (error) { if (error instanceof WriteError) throw error; throw body ? uncertain() : unavailable(); }
  finally { clearTimeout(timer); }
}

/** One provider POST per durable request. The existing ledger stores metadata only. */
export async function createSupportTicket(raw, { userId, accessToken, hmacSecret, ledger, fetchImpl = fetch, timeoutMs = 10000, now = Date.now }) {
  const input = validateSupportTicket(raw);
  if (!userId || typeof hmacSecret !== 'string' || hmacSecret.length < 32 || !ledger?.claim || !ledger?.finish) throw unavailable();
  await verifyToolWriteAccess('tickets', { accessToken, fetchImpl, timeoutMs: Math.min(timeoutMs, 5000), now });
  const hash = createHmac('sha256', hmacSecret).update(JSON.stringify(['support-ticket-create-v1', input])).digest('hex');
  const identity = { userId, requestId: input.requestId, ticketId: `support-create:${userId}:${input.requestId}`, hash };
  let claim; try { claim = await ledger.claim({ ...identity, now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.hash && claim.hash !== hash) throw new WriteError('REQUEST_ID_REUSED', 'This submission ID was already used for another request. Start a new ticket.', 409);
    if (claim.status === 'saved') return { status: 'created', requestId: input.requestId, replayed: true };
    throw new WriteError('CREATE_ALREADY_PROCESSED', 'This submission is already in progress or was processed. Check Help Desk before starting another ticket.', 409, { uncertain: true });
  }
  let attempted = false;
  try {
    const options = { accessToken, fetchImpl, timeoutMs };
    const pipeline = await provider('/crm/v3/pipelines/tickets/0', options);
    if (String(pipeline?.id) !== '0' || pipeline.archived || !Array.isArray(pipeline.stages)) throw unavailable();
    const stage = pipeline.stages.filter(stage => !stage.archived && validId(stage.id) && stage.metadata?.ticketState === 'OPEN' && Number.isFinite(stage.displayOrder)).sort((a, b) => a.displayOrder - b.displayOrder)[0];
    if (!stage) throw new WriteError('SUPPORT_PIPELINE_UNAVAILABLE', 'The Support Pipeline needs an open ticket stage before tickets can be created.', 503);
    const properties = { subject: input.title, content: input.description, hs_ticket_priority: input.priority, hs_pipeline: '0', hs_pipeline_stage: stage.id };
    attempted = true;
    const ack = await provider('/crm/v3/objects/tickets', options, { properties });
    if (!validId(ack?.id) || ack.archived) throw uncertain();
    let confirmed;
    try { confirmed = await provider(`/crm/v3/objects/tickets/${ack.id}?properties=${Object.keys(properties).join(',')}`, options); } catch { throw uncertain(); }
    if (confirmed?.id !== ack.id || confirmed.archived || Object.entries(properties).some(([key, value]) => (confirmed.properties?.[key] ?? '') !== value)) throw uncertain();
    if (!await ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
    return { status: 'created', requestId: input.requestId, ticket: { id: ack.id, title: input.title, hubspotUrl: `https://app.hubspot.com/contacts/50894788/record/0-5/${ack.id}` } };
  } catch (error) {
    const safe = error instanceof WriteError ? error : attempted ? uncertain() : unavailable();
    try { await ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* The pending claim still prevents another POST. */ }
    throw safe;
  }
}

/** @param {Request} request @param {{getUser:()=>any,createData:(input:any,options:any)=>Promise<any>,editorEmails?:string,writesEnabled?:string,ledger?:any,vercel?:string,vercelEnv?:string,allowedOrigin?:string}} options */
export async function handleSupportTicketCreate(request, { getUser, createData, ...options }) {
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use New Support Ticket to create a ticket.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before creating support tickets.' } }, 401);
    if (!writeCapability(user, options)) throw new WriteError('CREATION_DISABLED', 'Support ticket creation is disabled for this account or environment.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new WriteError('ORIGIN_NOT_ALLOWED', 'Open this app directly before saving.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new WriteError('INVALID_REQUEST', 'Send a JSON ticket request.', 415);
    let input;
    try { input = validateSupportTicket(await boundedJson(request, 32768)); }
    catch (error) { if (error instanceof WriteError) throw error; throw new WriteError('INVALID_REQUEST', error instanceof RangeError ? 'The ticket request is too large.' : 'Send a valid ticket request.', error instanceof RangeError ? 413 : 400); }
    const result = await createData(input, { userId: user.userId, ledger: options.ledger });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) {
    const safe = error instanceof WriteError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message }, uncertain: safe.uncertain, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
