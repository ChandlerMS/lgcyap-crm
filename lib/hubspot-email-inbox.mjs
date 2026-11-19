import { createHash } from 'node:crypto';
import { readInboxPage, validateInboxInput, InboxError } from './hubspot-inbox.mjs';
import { PRIVATE_MAILBOX, mailboxOwner, readMailboxAccounts, privateMailboxConnection, scopedConversationsFetch, readConversationThread } from './hubspot-mailbox.mjs';
import { readEmailConnection } from './email-connection.mjs';
import { editorAllowed } from './hubspot-write.mjs';
const ROOT = 'https://api.hubapi.com/conversations/v3/conversations';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const forbidden = () => new InboxError('PRIVATE_MAILBOX', 'Only Chandler can read this mailbox.', 403);
const safeText = (value, length = 300) => typeof value === 'string' ? value.trim().slice(0, length) : '';
export const EMAIL_SETTINGS_URL = 'https://app.hubspot.com/settings/50894788/inbox/inboxes';

export async function readEmailInboxPage(input = {}, { viewerEmail, userId, accessToken, hmacSecret, fetchImpl = fetch, now = Date.now, inboxId = process.env.HUBSPOT_CHANDLER_INBOX_ID } = {}) {
  if (!mailboxOwner(viewerEmail)) throw forbidden();
  const selected = validateInboxInput(input);
  const accounts = await readMailboxAccounts({ accessToken, fetchImpl });
  const connection = privateMailboxConnection(accounts);
  if (connection.status !== 'connected') return { tool: 'inbox', label: 'Email', status: 'connection-required', mailbox: PRIVATE_MAILBOX, archive: selected.archive, records: [], complete: false, partial: true, continuation: null, error: { code: 'EMAIL_CONNECTION_REQUIRED', message: connection.status === 'ambiguous' ? 'HubSpot returned more than one active Chandler email channel. Review the mailbox setup in HubSpot.' : 'Connect or reauthorize chandler@lgcyap.com as an email channel in a HubSpot inbox restricted to Chandler. This CRM does not receive your full mailbox until that connection is active.' }, settingsUrl: EMAIL_SETTINGS_URL };
  // Pin only after an operator verifies Chandler-only Inbox access and no automatic ticket copies.
  if (!/^[1-9]\d{0,19}$/.test(String(inboxId ?? '')) || connection.connectedInboxId !== String(inboxId)) return { tool: 'inbox', status: 'connection-required', archive: selected.archive, records: [], complete: false, continuation: null, error: { code: 'PRIVATE_INBOX_SETUP_REQUIRED', message: 'The Chandler-only HubSpot inbox must be verified and configured before received mail is enabled. Ask the CRM administrator to finish the private mailbox setup.' } };
  const inboxResponse = await fetchImpl(`${ROOT}/inboxes/${inboxId}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  const inbox = inboxResponse.ok ? await inboxResponse.json() : null;
  if (!inbox || String(inbox.id) !== String(inboxId) || inbox.type !== 'INBOX') return { tool: 'inbox', status: 'connection-required', archive: selected.archive, records: [], complete: false, continuation: null, error: { code: 'PRIVATE_INBOX_SETUP_REQUIRED', message: 'Use a dedicated Chandler-only Conversations Inbox, not Help Desk or a shared inbox.' } };
  const ids = new Set(accounts.filter(account => connection.accountIds.includes(String(account.id)) && String(account.inboxId) === String(inboxId)).map(account => String(account.id)));
  const threadAllowed = thread => ids.has(String(thread.originalChannelAccountId)) && String(thread.inboxId) === String(inboxId);
  const scoped = scopedConversationsFetch({ fetchImpl, allowsThread: threadAllowed, allowsMessage: message => !message.channelAccountId || ids.has(String(message.channelAccountId)) });
  const source = async (url, init) => {
    const parsed = new URL(String(url));
    // Subject enrichment is bounded to ten conversations per resumable page.
    if (parsed.pathname === '/conversations/v3/conversations/threads') {
      parsed.searchParams.set('limit', '10');
      parsed.searchParams.set('sort', 'id');
      parsed.searchParams.set('inboxId', String(inboxId));
    }
    const response = await scoped(parsed.href, init);
    if (parsed.pathname !== '/conversations/v3/conversations/threads' || !response.ok) return response;
    const payload = await response.json();
    return Response.json({ ...payload, unfilteredResultCount: payload.unfilteredResultCount ?? payload.results.length, results: payload.results.filter(thread => Number.isFinite(Date.parse(thread.latestMessageReceivedTimestamp ?? ''))) });
  };
  if (selected.threadId) {
    const thread = await readConversationThread(selected.threadId, { fetchImpl, headers: { Authorization: `Bearer ${accessToken}` } });
    if (!thread || String(thread.id) !== selected.threadId || !threadAllowed(thread)) throw new InboxError('PRIVATE_MAILBOX_THREAD', 'This conversation is not in Chandler’s mailbox.', 404);
  }
  const binding = createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16);
  const result = await readInboxPage(selected, { userId: `${userId}:email:${binding}`, accessToken, hmacSecret, fetchImpl: source, now });
  if (result.status === 'available' && !selected.threadId) {
    // A received timestamp distinguishes inbound conversations from outbound-only threads.
    // Filtering is applied on the raw response below before normalization.
    // Small concurrency prevents one screen load from exhausting HubSpot's read quota.
    for (let index = 0; index < result.records.length; index += 2) await Promise.all(result.records.slice(index, index + 2).map(async row => {
      const response = await source(`${ROOT}/threads/${row.id}/messages?limit=100&archived=false&sort=-createdAt`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new InboxError('EMAIL_PREVIEW_UNAVAILABLE', 'HubSpot could not load email subjects. Refresh to try again.', 502);
      const payload = await response.json();
      if (!Array.isArray(payload.results)) throw new InboxError('EMAIL_PREVIEW_UNAVAILABLE', 'HubSpot returned an invalid email preview.', 502);
      const message = payload.results.find(message => message.type === 'MESSAGE' && message.direction === 'INCOMING' && String(message.channelId) === '1002');
      const sender = message?.senders?.map(person => safeText(person.name) || safeText(person.deliveryIdentifier?.value)).filter(Boolean).join(', ');
      row.title = safeText(message?.subject) || 'Email conversation';
      row.subtitle = sender || PRIVATE_MAILBOX;
    }));
  }
  return { ...result, label: 'Email', mailbox: PRIVATE_MAILBOX, notice: 'Email conversations received by Chandler’s connected HubSpot channel. Includes active and archived conversations; mail received before channel connection is not imported by HubSpot.' };
}

export async function handleEmailInbox(request, { getUser, env = process.env, read = readEmailInboxPage, readConnection = readEmailConnection }) {
  const json = (body, status = 200) => Response.json(body, { status, headers });
  try {
    const user = await getUser();
    if (!user) return json({ error: { message: 'Sign in to read Email.' } }, 401);
    if (!mailboxOwner(user.email) || !editorAllowed(user, env.RECRUITING_EDITOR_EMAILS)) return request.method === 'GET' ? json({ canRead: false }) : json({ error: { message: 'Only Chandler can read this mailbox.' } }, 403);
    const origin = new URL(env.BETTER_AUTH_URL).origin;
    if (new URL(request.url).origin !== origin || request.method === 'POST' && request.headers.get('origin') !== origin) return json({ error: { message: 'Open the CRM directly.' } }, 403);
    if (request.method === 'GET') return json(new URL(request.url).searchParams.get('connection') === '1' ? await readConnection({ viewerEmail: user.email, accessToken: env.HUBSPOT_ACCESS_TOKEN, inboxId: env.HUBSPOT_CHANDLER_INBOX_ID }) : { canRead: true, mailbox: PRIVATE_MAILBOX });
    if (request.method !== 'POST') return json({ error: { message: 'Method not allowed.' } }, 405);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: { message: 'Send JSON.' } }, 415);
    const body = await request.text();
    if (body.length > 8192) return json({ error: { message: 'Request too large.' } }, 413);
    let input; try { input = validateInboxInput(JSON.parse(body)); } catch { return json({ error: { message: 'Choose a valid email view.' } }, 400); }
    return json(await read(input, { viewerEmail: user.email, userId: user.userId, accessToken: env.HUBSPOT_ACCESS_TOKEN, hmacSecret: env.BETTER_AUTH_SECRET, inboxId: env.HUBSPOT_CHANDLER_INBOX_ID }));
  } catch (error) {
    return json({ error: { message: error instanceof InboxError ? error.message : 'HubSpot email is unavailable. Check the mailbox connection and refresh.' } }, error instanceof InboxError ? error.status : 503);
  }
}
