import { PRIVATE_MAILBOX, mailboxOwner, readMailboxAccounts, privateMailboxConnection } from './hubspot-mailbox.mjs';
const ROOT = 'https://api.hubapi.com';
/** Verify identity and mailbox metadata only. Never fetch email contents or change account settings. */
export async function readEmailConnection({ viewerEmail, accessToken, inboxId, fetchImpl = fetch }) {
  if (!mailboxOwner(viewerEmail)) throw Error('Mailbox owner required.');
  const result = { canRead: true, mailbox: PRIVATE_MAILBOX, webAppEmail: viewerEmail.toLowerCase(), hubspotIdentity: 'unavailable', connection: 'unavailable' };
  const request = async (path, body) => {
    const response = await fetchImpl(ROOT + path, { method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('Connection unavailable.');
    return response.json();
  };
  try {
    if (!accessToken || /[\r\n]/.test(accessToken)) return result;
    const info = await request('/oauth/v2/private-apps/get/access-token-info', { tokenKey: accessToken });
    if (String(info.hubId) !== '50894788' || String(info.appId) !== '59264745') return result;
    const checks = await Promise.allSettled([
      request(`/crm/v3/owners/?email=${encodeURIComponent(PRIVATE_MAILBOX)}&archived=false&limit=100`),
      readMailboxAccounts({ accessToken, fetchImpl }),
    ]);
    if (checks[0].status === 'fulfilled') {
      const page = checks[0].value;
      const matches = page.results?.filter(owner => owner.archived !== true && mailboxOwner(owner.email) && /^[1-9]\d{0,19}$/.test(String(owner.userId ?? '')));
      if (Array.isArray(matches) && !page.paging?.next) result.hubspotIdentity = matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'missing';
    }
    if (checks[1].status === 'fulfilled') {
      const connection = privateMailboxConnection(checks[1].value);
      result.connection = connection.status;
      if (connection.status === 'connected') {
        result.connection = 'private-inbox-required';
        if (/^[1-9]\d{0,19}$/.test(String(inboxId ?? '')) && connection.connectedInboxId === String(inboxId)) {
          const inbox = await request(`/conversations/v3/conversations/inboxes/${inboxId}`);
          if (String(inbox.id) === String(inboxId) && inbox.type === 'INBOX') result.connection = 'connected';
        }
      }
    }
  } catch { result.connection = 'unavailable'; /* Unknown never implies a verified connection. */ }
  return result;
}
