import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeInboxCursor } from './hubspot-inbox.mjs';
import { HUBSPOT_TOOL_CONFIG, normalizeToolRecord, providerJson } from './hubspot-tools.mjs';
import { editorAllowed } from './hubspot-write.mjs';
import { isAllowedOrigin, normalizeRecruit, readViewerOwnerIds } from './hubspot.mjs';
import { PIPELINE_ID, PORTAL_ID } from './recruiting-config.mjs';

const SOURCE_IDS = ['recruits', 'contract-agents', 'calls', 'meetings', 'inbox', 'help-desk', 'tickets'];
const API = 'https://api.hubapi.com';
const INBOX = '/conversations/v3/conversations/threads';
const SEARCH_LIMIT = 8;
const INBOX_LIMIT = 20;
const INBOX_FETCH_BUDGET = 5;
const BODY_LIMIT = 4096;
const CURSOR_LIMIT = 2800;
const CURSOR_TTL = 15 * 60 * 1000;
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie, Origin',
};
// HubSpot CRM Search permits five requests per second. Coordinate this route's
// searches within an instance, and honor a provider cooldown across requests.
const providerLimits = new WeakMap();

function reply(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}
function requestError(status, code, message, headers) {
  return reply({ error: { code, message } }, status, headers);
}

async function inputFor(request) {
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const length = request.headers.get('content-length');
  if (type !== 'application/json' || (length !== null && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT))) throw new Error();
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new Error();
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const data = JSON.parse(text + decoder.decode());
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).some(key => key !== 'query' && key !== 'continuation') ||
      typeof data.query !== 'string' || /\p{Cc}/u.test(data.query)) throw new Error();
  const query = data.query.trim();
  const characters = Array.from(query).length;
  if (characters < 2 || characters > 200) throw new Error();
  const { continuation } = data;
  if (continuation !== undefined && (typeof continuation !== 'string' || continuation.length > CURSOR_LIMIT || !continuation)) throw new Error();
  return { query, continuation };
}

function hmac(secret, purpose, value) {
  return createHmac('sha256', secret).update(`legacy-workspace-search/v2/${purpose}\0`).update(value).digest('base64url');
}
function inboxBinding(secret, user, query) {
  return hmac(secret, 'binding', JSON.stringify([PORTAL_ID, user.userId, user.email, query]));
}
function signInboxCursor(state, binding, secret, time) {
  const body = Buffer.from(JSON.stringify({ ...state, until: time + CURSOR_TTL })).toString('base64url');
  const token = `${body}.${hmac(secret, 'cursor', binding + '.' + body)}`;
  if (token.length > CURSOR_LIMIT) throw new Error();
  return token;
}
function openInboxCursor(token, binding, secret, time) {
  const parts = /^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]{43})$/.exec(token);
  if (!parts) throw new Error();
  const [, body, signature] = parts;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(hmac(secret, 'cursor', binding + '.' + body)))) throw new Error();
  const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(state.until) || state.until <= time) throw new Error();
  return state;
}

function providerClient(fetchImpl, signal) {
  let limit = providerLimits.get(fetchImpl);
  if (!limit) {
    limit = { nextSearch: 0, retryAt: 0 };
    providerLimits.set(fetchImpl, limit);
  }
  const retry = () => Math.max(0, Math.ceil((limit.retryAt - Date.now()) / 1000));
  const guardedFetch = async (url, options) => {
    const requestSignal = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
    if (retry()) return new Response(null, { status: 429, headers: { 'Retry-After': String(retry()) } });
    if (options.method === 'POST') {
      const time = Date.now();
      const start = Math.max(time, limit.nextSearch);
      limit.nextSearch = start + 225;
      if (start > time) await delay(start - time, undefined, { signal: requestSignal });
    }
    requestSignal.throwIfAborted();
    if (retry()) return new Response(null, { status: 429, headers: { 'Retry-After': String(retry()) } });
    const response = await fetchImpl(url, { ...options, signal: requestSignal, cache: 'no-store' });
    if (response.status === 429) {
      const value = response.headers.get('Retry-After');
      const seconds = /^\d{1,6}$/.test(value ?? '') ? Number(value)
        : Math.ceil((Date.parse(value ?? '') - Date.now()) / 1000);
      const wait = Number.isFinite(seconds) ? Math.max(1, Math.min(86400, seconds)) : 60;
      limit.retryAt = Math.max(limit.retryAt, Date.now() + wait * 1000);
      void response.body?.cancel().catch(() => {});
      return new Response(null, { status: 429, headers: { 'Retry-After': String(wait) } });
    }
    return response;
  };
  return { guardedFetch, retry };
}

function group(id) {
  const label = id === 'recruits' ? 'Recruits' : HUBSPOT_TOOL_CONFIG[id].label;
  return { id, label, status: 'available', records: [], partial: false };
}
function unavailable(result, notice = 'HubSpot could not complete this area. Try searching again.') {
  return { ...result, status: 'unavailable', partial: true, notice };
}
function recordId(value) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) throw new Error();
  return id;
}
function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').trim().slice(0, 200) : '';
}

function recordHref(objectId, id) {
  return `https://app.hubspot.com/contacts/${PORTAL_ID}/record/${objectId}/${id}`;
}

const RECRUITS = {
  object: 'tickets',
  objectId: '0-5',
  fields: ['hs_pipeline', 'hs_pipeline_stage', 'subject', 'recruit_name'],
  filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }],
};

async function searchCrm(id, query, owners, providerOptions) {
  const result = group(id);
  const config = id === 'recruits' ? RECRUITS : HUBSPOT_TOOL_CONFIG[id];
  let filters = config.filters ?? [];
  if (config.viewerOwned) {
    if (!owners?.ids.length) return unavailable(result, 'Your HubSpot ownership could not be confirmed.');
    filters = [...filters, { propertyName: 'hubspot_owner_id', operator: 'IN', values: owners.ids }];
  }
  try {
    const payload = await providerJson(`${API}/crm/v3/objects/${config.object}/search`, {
      ...providerOptions,
      method: 'POST',
      body: { query, limit: SEARCH_LIMIT, properties: config.fields, ...(filters.length ? { filterGroups: [{ filters }] } : {}) },
    });
    if (!Array.isArray(payload?.results) || payload.results.length > SEARCH_LIMIT ||
        !Number.isSafeInteger(payload.total) || payload.total < payload.results.length) throw new Error();
    const records = new Map();
    for (const raw of payload.results) {
      const key = recordId(raw?.id);
      if (raw.archived) throw new Error();
      if (id === 'recruits') {
        const row = normalizeRecruit(raw);
        records.set(key, { id: key, title: cleanText(row.name) || 'Unnamed recruit', subtitle: cleanText(row.stage) || null, href: recordHref(RECRUITS.objectId, key) });
      } else {
        const row = normalizeToolRecord(id, raw, config);
        if (config.viewerOwned && !owners.ids.includes(row.ownerId)) throw new Error();
        const href = recordHref(config.objectId, key);
        records.set(key, { id: key, title: cleanText(row.title) || 'Untitled record', subtitle: cleanText(row.subtitle) || null, href });
      }
    }
    result.records = Array.from(records.values());
    result.partial = payload.total > records.size || Boolean(payload.paging?.next);
    if (result.partial) result.notice = 'Only the first matching records are shown. Narrow the search to see other matches.';
    if (config.viewerOwned && !owners.complete) {
      result.partial = true;
      result.notice = [result.notice, 'HubSpot could verify only part of the owner directory. Results are limited to verified ownership.'].filter(Boolean).join(' ');
    }
    return result;
  } catch (error) {
    return unavailable(result, error?.status === 429 ? 'HubSpot is limiting requests. Wait before searching again.' : undefined);
  }
}

async function searchCrmGroups(query, viewer, providerOptions, retry) {
  const results = new Map();
  let owners;
  for (const id of SOURCE_IDS) {
    if (id === 'inbox') continue;
    if (retry()) {
      results.set(id, unavailable(group(id), 'HubSpot is limiting requests. Wait before searching again.'));
      continue;
    }
    // Resolve both viewer-owned areas from the same active and archived owners.
    if (id === 'calls') owners = await readViewerOwnerIds(viewer.email, { ...providerOptions, timeoutMs: 2000 });
    results.set(id, await searchCrm(id, query, owners, providerOptions));
  }
  return results;
}

function inboxState() {
  return { archived: false, threadAfter: null, threadHistory: [], threadId: null,
    messageArchived: false, messageAfter: null, messageHistory: [], messageIncomplete: false, incomplete: false };
}
class InboxPaginationError extends Error {}
function nextInboxPage(payload, after, history) {
  const raw = payload.paging?.next?.after;
  if (raw === undefined || raw === null || raw === '') return { after: null, history: [] };
  let cursor;
  try { cursor = decodeInboxCursor(raw); } catch { throw new InboxPaginationError(); }
  // HubSpot can echo the final bookmark on a subsequent empty page.
  if (cursor === after && payload.results.length === 0) return { after: null, history: [] };
  const fingerprint = createHash('sha256').update(cursor).digest('base64url').slice(0, 16);
  if (Buffer.byteLength(cursor) > 780 || history.includes(fingerprint)) throw new InboxPaginationError();
  return { after: cursor, history: [...history, fingerprint].slice(-5) };
}
async function inboxPage(path, archived, after, providerOptions) {
  const url = new URL(API + path);
  url.searchParams.set('archived', String(archived));
  url.searchParams.set('limit', String(INBOX_LIMIT));
  if (path === INBOX) url.searchParams.set('sort', 'id');
  if (after !== null) url.searchParams.set('after', after);
  const payload = await providerJson(url.href, { ...providerOptions, method: 'GET' });
  if (!Array.isArray(payload?.results) || payload.results.length > INBOX_LIMIT) throw new Error();
  return payload;
}
function compareIds(left, right) {
  return left.length - right.length || left.localeCompare(right, 'en');
}

async function searchInbox(query, initial, cursor, providerOptions, retry) {
  const result = group('inbox');
  const state = { ...initial };
  const needle = query.toLowerCase().normalize('NFC');
  const includes = candidate => typeof candidate === 'string' && candidate.toLowerCase().normalize('NFC').includes(needle);
  let page;
  let work = 0;
  let complete = false;
  let resumable = true;
  try {
    while (work < INBOX_FETCH_BUDGET && result.records.length < SEARCH_LIMIT) {
      if (!page) {
        work++;
        const payload = await inboxPage(INBOX, state.archived, state.threadAfter, providerOptions);
        const byId = new Map(payload.results.map(thread => [recordId(thread?.id), thread]));
        const rows = Array.from(byId).sort(([left], [right]) => compareIds(left, right));
        page = { payload, rows };
      }
      const inProgress = state.messageAfter !== null || state.messageArchived;
      const next = page.rows.find(([id]) => state.threadId === null || compareIds(id, state.threadId) > 0);
      // Keep the in-progress thread even if its listing moved between page reads.
      const id = inProgress ? state.threadId : next?.[0];
      if (!id) {
        const threadPage = nextInboxPage(page.payload, state.threadAfter, state.threadHistory);
        if (threadPage.after === null && state.archived) { complete = true; break; }
        if (threadPage.after === null) {
          state.archived = true;
          state.threadId = null;
        }
        state.threadAfter = threadPage.after;
        state.threadHistory = threadPage.history;
        page = undefined;
        continue;
      }
      const metadata = inProgress ? page.rows.find(([key]) => key === id)?.[1] : next[1];
      const title = cleanText(metadata?.subject) || `Conversation ${id}`;
      const subtitle = cleanText(metadata?.status) || (metadata?.inboxId ? cleanText(`Inbox ${metadata.inboxId}`) : '') || null;
      let matched = [title, subtitle, metadata?.subject, metadata?.status, metadata?.inboxId, metadata?.associatedContactId].some(includes);
      if (!matched) {
        if (work >= INBOX_FETCH_BUDGET) break;
        work++;
        const payload = await inboxPage(`${INBOX}/${id}/messages`, state.messageArchived, state.messageAfter, providerOptions);
        if (payload.results.some(message => !message || typeof message.id !== 'string' || !message.id)) throw new Error();
        matched = payload.results.some(message => includes(message.text) || includes(message.subject));
        if (!matched) {
          const messagePage = nextInboxPage(payload, state.messageAfter, state.messageHistory);
          state.messageIncomplete ||= payload.results.some(message => Boolean(message.truncationStatus && message.truncationStatus !== 'NOT_TRUNCATED'));
          if (messagePage.after !== null || !state.messageArchived) {
            state.threadId = id;
            // Message archiving is independent of the thread's listing phase.
            state.messageArchived ||= messagePage.after === null;
            state.messageAfter = messagePage.after;
            state.messageHistory = messagePage.history;
            continue;
          }
          state.incomplete ||= state.messageIncomplete;
        }
      }
      state.threadId = id;
      state.messageArchived = false;
      state.messageAfter = null;
      state.messageHistory = [];
      state.messageIncomplete = false;
      if (matched) result.records.push({ id, title, subtitle, href: `#inbox/thread/${id}` });
    }
  } catch (error) {
    if (error instanceof InboxPaginationError) {
      resumable = false;
      result.notice = 'HubSpot did not provide a usable next page. Inbox coverage is incomplete.';
    } else {
      result.status = 'unavailable';
      result.notice = retry() ? 'HubSpot is limiting requests. Wait, then continue the Inbox search.' : 'HubSpot could not complete the Inbox search. Continue to retry.';
    }
  }
  result.partial = !complete || state.incomplete;
  if (!complete && resumable) {
    try { result.continuation = cursor(state); }
    catch { result.notice = 'HubSpot pagination could not be resumed. Inbox coverage is incomplete.'; }
  }
  if (result.partial && !result.notice) {
    result.notice = complete
      ? 'HubSpot withheld part of some message bodies. Inbox coverage is incomplete.'
      : 'Only part of the Inbox has been searched. Continue to look through more conversations.';
  }
  return result;
}

/**
 * @param {Request} request
 * @param {{getUser: () => Promise<{userId:string,email:string} | null>, editorEmails?:string, allowedOrigin?:string, accessToken?:string, hmacSecret?:string, fetchImpl?:typeof fetch, now?:()=>number}} options
 */
export async function handleWorkspaceSearch(request, { getUser, editorEmails, allowedOrigin, accessToken, hmacSecret, fetchImpl = fetch, now = Date.now }) {
  if (request.method !== 'POST') return requestError(405, 'METHOD_NOT_ALLOWED', 'Use POST for workspace search.', { Allow: 'POST' });
  let user;
  try { user = await getUser(); }
  catch { return requestError(503, 'SIGN_IN_UNAVAILABLE', 'Employee sign-in is temporarily unavailable.'); }
  if (!user) return requestError(401, 'SIGN_IN_REQUIRED', 'Sign in to search the workspace.');
  if (!editorAllowed(user, editorEmails) || !isAllowedOrigin(request, allowedOrigin)) return requestError(403, 'ACCESS_DENIED', 'This workspace search is forbidden.');

  let input, state, binding;
  const stamp = now();
  const secured = typeof hmacSecret === 'string' && hmacSecret.length >= 32;
  try {
    input = await inputFor(request);
    if (secured) binding = inboxBinding(hmacSecret, user, input.query);
    if (input.continuation && !secured) throw new Error();
    state = input.continuation ? openInboxCursor(input.continuation, binding, hmacSecret, stamp) : inboxState();
  } catch {
    return requestError(400, 'INVALID_REQUEST', 'Enter a valid workspace search or restart an expired Inbox search.');
  }

  let groups;
  let retryAfter = 0;
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 4096 || /[\r\n]/.test(accessToken)) {
    groups = (input.continuation ? ['inbox'] : SOURCE_IDS).map(id => unavailable(group(id), 'The HubSpot search connection is unavailable.'));
  } else {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    const { guardedFetch, retry } = providerClient(fetchImpl, signal);
    const providerOptions = { accessToken, fetchImpl: guardedFetch, timeoutMs: 3500 };
    const inbox = secured
      ? searchInbox(input.query, state, next => signInboxCursor(next, binding, hmacSecret, now()), providerOptions, retry)
      : unavailable(group('inbox'), 'The secure Inbox search is unavailable.');
    if (input.continuation) groups = [await inbox];
    else {
      const [inboxResult, crmResults] = await Promise.all([inbox, searchCrmGroups(input.query, user, providerOptions, retry)]);
      groups = SOURCE_IDS.map(id => id === 'inbox' ? inboxResult : crmResults.get(id));
    }
    retryAfter = retry();
  }
  return reply({ query: input.query, groups, fetchedAt: new Date(stamp).toISOString() }, 200, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
}
