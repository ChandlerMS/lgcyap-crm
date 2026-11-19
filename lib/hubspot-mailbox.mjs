export const PRIVATE_MAILBOX = 'chandler@lgcyap.com';
const ROOT = 'https://api.hubapi.com/conversations/v3/conversations';
const id = value => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : null;
export const mailboxOwner = email => typeof email === 'string' && email.trim().toLowerCase() === PRIVATE_MAILBOX;
const address = account => account.deliveryIdentifier?.type === 'HS_EMAIL_ADDRESS' ? String(account.deliveryIdentifier.value ?? '').trim().toLowerCase() : '';
const unavailable = () => new Error('HubSpot mailbox configuration could not be verified.');

/** Include disconnected and archived accounts so old private threads remain protected. */
export async function readMailboxAccounts({ accessToken, fetchImpl = fetch, signal } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken)) throw unavailable();
  const accounts = new Map();
  for (const archived of [false, true]) {
    let after; const seen = new Set();
    for (let page = 0; ; page++) {
      if (page >= 100) throw unavailable();
      const url = new URL(`${ROOT}/channel-accounts`);
      url.search = new URLSearchParams({ archived: String(archived), limit: '100', ...(after ? { after } : {}) }).toString();
      const response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: signal ?? AbortSignal.timeout(10000) });
      if (!response.ok) throw unavailable();
      const data = await response.json();
      if (!Array.isArray(data.results) || data.results.length > 100 || data.errors?.length) throw unavailable();
      for (const account of data.results) {
        if (!id(account.id) || !id(account.channelId) || !id(account.inboxId)) throw unavailable();
        const previous = accounts.get(String(account.id));
        // A duplicate archived page must not replace a currently active record.
        if (!previous || previous.archived === true && account.archived !== true) accounts.set(String(account.id), account);
      }
      const next = data.paging?.next?.after;
      if (next === undefined || next === null || next === '') break;
      after = String(next);
      if (!after || after.length > 4096 || /[\u0000-\u001f\u007f]/.test(after) || seen.has(after) || !data.results.length) throw unavailable();
      seen.add(after);
    }
  }
  return [...accounts.values()];
}
export function privateMailboxConnection(accounts) {
  const matching = accounts.filter(account => String(account.channelId) === '1002' && address(account) === PRIVATE_MAILBOX);
  const current = matching.filter(account => account.archived !== true && account.active === true);
  const usable = current.filter(account => account.authorized === true);
  const status = usable.length === 1 ? 'connected' : usable.length > 1 ? 'ambiguous' : current.length ? 'authorization-required' : 'connection-required';
  return { status, accountIds: matching.map(account => String(account.id)), inboxIds: [...new Set(matching.map(account => String(account.inboxId)))] };
}
const denied = () => Response.json({ status: 'error', message: 'This conversation is unavailable for this account.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
const replace = (response, body) => {
  const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
  headers.set('Cache-Control', 'private, no-store');
  return Response.json(body, { status: response.status, headers });
};


/** HubSpot's v3 single-thread endpoint selects archived records explicitly. */
export async function readConversationThread(threadId, { fetchImpl = fetch, headers, signal } = {}) {
  for (const archived of [false, true]) {
    const response = await fetchImpl(`${ROOT}/threads/${threadId}?archived=${archived}`, { method: 'GET', cache: 'no-store', redirect: 'error', headers, signal: signal ?? AbortSignal.timeout(10000) });
    if (response.status === 404 && !archived) continue;
    if (!response.ok) return null;
    const thread = await response.json();
    return String(thread.id) === threadId ? thread : null;
  }
  return null;
}

/** Gate message reads/writes before reading bodies; preserve provider cursors after filtering lists. */
export function scopedConversationsFetch({ fetchImpl = fetch, allowsThread, allowsMessage }) {
  const threads = new Map();
  const readThread = (threadId, init) => {
    if (!threads.has(threadId)) threads.set(threadId, readConversationThread(threadId, { fetchImpl, headers: init?.headers, signal: init?.signal }));
    return threads.get(threadId);
  };
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.hubapi.com') return fetchImpl(input, init);
    const match = url.pathname.match(/^\/conversations\/v3\/conversations\/threads(?:\/([1-9]\d{0,19})(?:\/(.*))?)?$/);
    if (!match) return fetchImpl(input, init);
    const threadId = match[1];
    try {
      if (threadId) {
        const thread = await readThread(threadId, init);
        if (!thread || !await allowsThread(thread)) return denied();
        if (!match[2]) return replace(Response.json({}), thread);
      }
      const response = await fetchImpl(input, init);
      if (!response.ok || init.method && init.method !== 'GET') return response;
      const data = await response.json();
      if (!Array.isArray(data.results)) return denied();
      const keep = threadId ? allowsMessage : allowsThread;
      const flags = await Promise.all(data.results.map(row => keep(row)));
      if (!threadId) data.results.forEach((row, index) => { if (flags[index] && id(row.id)) threads.set(String(row.id), Promise.resolve(row)); });
      return replace(response, { ...data, unfilteredResultCount: data.results.length, results: data.results.filter((_, index) => flags[index]) });
    } catch { return denied(); }
  };
}

/** Request-local policy: never cache one employee's authorization for another. */
export function privateMailboxFetch({ viewerEmail, accessToken, fetchImpl = fetch }) {
  if (mailboxOwner(viewerEmail)) return fetchImpl;
  let accounts;
  const policy = () => accounts ??= readMailboxAccounts({ accessToken, fetchImpl });
  const publicAccount = async (accountId, inboxId) => {
    const all = await policy(), connection = privateMailboxConnection(all);
    const account = all.find(account => String(account.id) === String(accountId));
    if (!account || connection.inboxIds.includes(String(inboxId ?? account.inboxId)) || connection.accountIds.includes(String(accountId))) return false;
    // Email identities must be explicit; a display name is not an address.
    return String(account.channelId) !== '1002' || Boolean(address(account)) && address(account) !== PRIVATE_MAILBOX;
  };
  return scopedConversationsFetch({ fetchImpl,
    allowsThread: thread => publicAccount(thread.originalChannelAccountId, thread.inboxId),
    allowsMessage: async message => {
      if ((message.recipients ?? []).some(recipient => recipient.deliveryIdentifier?.type === 'HS_EMAIL_ADDRESS' && mailboxOwner(recipient.deliveryIdentifier.value))) return false;
      if (!message.channelAccountId && ['COMMENT', 'THREAD_STATUS_CHANGE', 'ASSIGNMENT', 'THREAD_INBOX_CHANGE'].includes(message.type)) return true;
      return publicAccount(message.channelAccountId);
    },
  });
}

/** A separate engagement may duplicate an incoming email outside Conversations. */
export function publicEmailEngagement(properties) {
  let headers;
  try { headers = typeof properties.hs_email_headers === 'string' ? JSON.parse(properties.hs_email_headers) : properties.hs_email_headers; } catch { return false; }
  if (!headers || typeof headers !== 'object') return false;
  const recipients = [...(Array.isArray(headers.to) ? headers.to : []), ...(Array.isArray(headers.cc) ? headers.cc : []), ...(Array.isArray(headers.bcc) ? headers.bcc : [])];
  if (!recipients.length || recipients.some(recipient => typeof recipient.email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.email))) return false;
  return recipients.every(recipient => !mailboxOwner(recipient.email));
}
