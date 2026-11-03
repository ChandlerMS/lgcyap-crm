import { createHmac } from 'node:crypto';
import { WriteError, writeCapability } from './hubspot-write.mjs';
import { verifyToolWriteAccess } from './hubspot-tool-write.mjs';
import { validateContractAgent } from './contract-agent-input.mjs';
import { isAllowedOrigin } from './hubspot.mjs';

const BASE = 'https://api.hubapi.com';
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const validId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const unavailable = () => new WriteError('CREATE_UNAVAILABLE', 'Contract agent creation is unavailable. Try again later.', 503);
const uncertain = () => new WriteError('CREATE_UNCERTAIN', 'The agent may have been created. Check Contract Agents or HubSpot before starting another agent.', 502, { uncertain: true });

async function boundedJson(source, limit) {
  const reader = source.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new RangeError('Body too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function provider(path, { accessToken, fetchImpl, timeoutMs }, body, search = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${BASE}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status !== (body && !search ? 201 : 200)) {
      if (body && !search && !(response.status >= 400 && response.status < 500)) throw uncertain();
      if (response.status === 429) throw new WriteError('HUBSPOT_RATE_LIMITED', 'HubSpot is limiting requests. Wait before trying again.', 429, { retryAfterSeconds: 60 });
      if ([401, 403].includes(response.status)) throw new WriteError('HUBSPOT_ACCESS_REQUIRED', 'The app needs HubSpot custom object access before it can create contract agents.', 403);
      if (body && [400, 409, 422].includes(response.status)) throw new WriteError('AGENT_REJECTED', 'HubSpot rejected this agent. Review the fields before trying again.', 400);
      throw unavailable();
    }
    return await boundedJson(response, 512 * 1024);
  } catch (error) { if (error instanceof WriteError) throw error; throw body && !search ? uncertain() : unavailable(); }
  finally { clearTimeout(timer); }
}

/** One provider POST per durable request. The existing ledger stores metadata only. */
export async function createContractAgent(raw, { userId, accessToken, hmacSecret, ledger, fetchImpl = fetch, timeoutMs = 10000, now = Date.now }) {
  const input = validateContractAgent(raw);
  if (!userId || typeof hmacSecret !== 'string' || hmacSecret.length < 32 || !ledger?.claim || !ledger?.finish) throw unavailable();
  await verifyToolWriteAccess('contract-agents', { accessToken, fetchImpl, timeoutMs: Math.min(timeoutMs, 5000), now });
  const hash = createHmac('sha256', hmacSecret).update(JSON.stringify(['contract-agent-create-v1', input])).digest('hex');
  const identity = { userId, requestId: input.requestId, ticketId: `agent-create:${userId}:${input.requestId}`, hash };
  let claim; try { claim = await ledger.claim({ ...identity, now: now() }); } catch { throw unavailable(); }
  if (!claim.acquired) {
    if (claim.hash && claim.hash !== hash) throw new WriteError('REQUEST_ID_REUSED', 'This submission ID was already used for another request. Start a new agent.', 409);
    if (claim.status === 'saved') return { status: 'created', requestId: input.requestId, replayed: true };
    throw new WriteError('CREATE_ALREADY_PROCESSED', 'This submission is already in progress or was processed. Check Contract Agents before starting another agent.', 409, { uncertain: true });
  }
  let attempted = false;
  try {
    const options = { accessToken, fetchImpl, timeoutMs };
    const properties = input.properties;
    const filterGroups = ['email', 'npn'].filter(key => properties[key]).map(key => ({ filters: [{ propertyName: key, operator: 'EQ', value: properties[key] }] }));
    if (filterGroups.length) {
      const existing = await provider('/crm/v3/objects/2-64481801/search', options, { filterGroups, properties: ['full_name'], limit: 1 }, true);
      if (!Number.isInteger(existing?.total) || existing.total < 0 || !Array.isArray(existing.results)) throw unavailable();
      if (existing.total || existing.results.length) throw new WriteError('AGENT_EXISTS', 'An agent with this email or NPN already exists. Search Contract Agents before creating another.', 409);
    }
    attempted = true;
    const ack = await provider('/crm/v3/objects/2-64481801', options, { properties });
    if (!validId(ack?.id) || ack.archived) throw uncertain();
    let confirmed;
    try { confirmed = await provider(`/crm/v3/objects/2-64481801/${ack.id}?properties=${Object.keys(properties).join(',')}`, options); } catch { throw uncertain(); }
    if (confirmed?.id !== ack.id || confirmed.archived || Object.entries(properties).some(([key, value]) => (confirmed.properties?.[key] ?? '') !== value)) throw uncertain();
    if (!await ledger.finish({ ...identity, status: 'saved', now: now() })) throw uncertain();
    return { status: 'created', requestId: input.requestId, agent: { id: ack.id, title: properties.full_name, hubspotUrl: `https://app.hubspot.com/contacts/50894788/record/2-64481801/${ack.id}` } };
  } catch (error) {
    const safe = error instanceof WriteError ? error : attempted ? uncertain() : unavailable();
    try { await ledger.finish({ ...identity, status: safe.uncertain ? 'uncertain' : 'failed', now: now() }); } catch { /* The pending claim still prevents another POST. */ }
    throw safe;
  }
}

/** @param {Request} request @param {{getUser:()=>any,createData:(input:any,options:any)=>Promise<any>,editorEmails?:string,writesEnabled?:string,ledger?:any,vercel?:string,vercelEnv?:string,allowedOrigin?:string}} options */
export async function handleContractAgentCreate(request, { getUser, createData, ...options }) {
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use Add Contract Agent to create an agent.' } }, 405, { Allow: 'POST' });
  try {
    const user = await getUser();
    if (!user) return json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in before creating contract agents.' } }, 401);
    if (!writeCapability(user, options)) throw new WriteError('CREATION_DISABLED', 'Contract agent creation is disabled for this account or environment.', 403);
    if (!isAllowedOrigin(request, options.allowedOrigin)) throw new WriteError('ORIGIN_NOT_ALLOWED', 'Open this app directly before saving.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new WriteError('INVALID_REQUEST', 'Send a JSON agent request.', 415);
    let input;
    try { input = validateContractAgent(await boundedJson(request, 32768)); }
    catch (error) { if (error instanceof WriteError) throw error; if (error?.code === 'INVALID_AGENT') throw new WriteError(error.code, error.message, 400); throw new WriteError('INVALID_REQUEST', error instanceof RangeError ? 'The agent request is too large.' : 'Send a valid agent request.', error instanceof RangeError ? 413 : 400); }
    const result = await createData(input, { userId: user.userId, ledger: options.ledger });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) {
    const safe = error instanceof WriteError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message }, uncertain: safe.uncertain, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status, safe.retryAfterSeconds ? { 'Retry-After': String(safe.retryAfterSeconds) } : {});
  }
}
