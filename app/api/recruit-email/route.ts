import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { isAllowedOrigin } from '@/lib/hubspot.mjs';
import { getAuth } from '@/lib/auth';
import { getPool } from '@/db/pool.mjs';
import { GMAIL_SEND_SCOPE, offerTemplates, verifiedRecipient, renderOffer, validateEmailInput, emailMime, sendGmail, mailHash, mailError, logSentEmail } from '@/lib/recruit-email.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
  try {
    const user = await getAppUser();
    if (!user) return json({ error: 'Sign in to use email.' }, 401);
    if (!editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS) || !isAllowedOrigin(request, process.env.BETTER_AUTH_URL)) return json({ error: 'Access denied.' }, 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'Use JSON.' }, 415);
    const reader = request.body?.getReader(); let size = 0; const parts: Uint8Array[] = [];
    if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 100000) { await reader.cancel(); return json({ error: 'Message too large.' }, 413); } parts.push(part.value); }
    let input; try { input = JSON.parse(Buffer.concat(parts).toString()); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (!input || Array.isArray(input) || typeof input !== 'object') throw mailError('Invalid request.');
    const pool = getPool();
    const accounts = await pool.query('SELECT id, scope FROM account WHERE "userId" = $1 AND "providerId" = $2', [user.userId, 'google']);
    const account = accounts.rows.length === 1 ? accounts.rows[0] : null;
    const connected = Boolean(account?.scope?.split(/[ ,]+/).includes(GMAIL_SEND_SCOPE));
    const templates = offerTemplates();
    if (input.action === 'status') {
      const recent = await pool.query("SELECT ticket_id, status, updated_at FROM recruit_write_requests WHERE user_id=$1 AND ticket_id LIKE 'email:%' ORDER BY updated_at DESC LIMIT 6", [user.userId]);
      return json({ sender: user.email, connected, templates: templates.map(t => ({ id: t.id, name: t.name, route: t.route, subject: t.subject, fields: t.fields })), recent: recent.rows.map((r: { ticket_id: string; status: string; updated_at: string }) => ({ recruitId: r.ticket_id.slice(6), status: r.status, at: Number(r.updated_at) })) });
    }
    if (!['prepare', 'preview', 'send'].includes(input.action)) throw mailError('Invalid email action.');
    const recipient = await verifiedRecipient(input.recruitId);
    if (input.action === 'prepare') return json({ recipient });
    const { subject, body } = validateEmailInput(input);
    const template = input.templateId ? templates.find(t => t.id === input.templateId) : null;
    if (input.templateId && !template) throw mailError('This template is unavailable.');
    let rendered = { html: '', text: body }; let assets: { cid: string; data: string }[] = [];
    if (template) { rendered = renderOffer(template, recipient, input.fields); assets = template.assets || []; }
    else if (!body) throw mailError('Write a message before sending.');
    if (template && body) { rendered.text += `\n\n${body}`; rendered.html += `<p>${body.replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!).replace(/\n/g, '<br>')}</p>`; }
    const hash = mailHash({ recipient, subject, ...rendered, assets });
    if (input.action === 'preview') {
      let html = rendered.html || `<div style="white-space:pre-wrap">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
      for (const asset of assets) html = html.replaceAll(`cid:${asset.cid}`, `data:image/png;base64,${asset.data}`);
      return json({ recipient, subject, html, previewHash: hash });
    }
    if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') throw mailError('Email sending is available on the production CRM only.', 403);
    if (!connected || !account) throw mailError('Connect your Google email before sending.', 403);
    if (input.previewHash !== hash) throw mailError('The message or recruit changed. Preview the message again before sending.', 409);
    if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw mailError('Start a new email before sending.');
    // Token selection is bound to this authenticated employee, never to a client-supplied account.
    const auth = getAuth();
    if (!auth) throw mailError('Email authorization is unavailable.', 503);
    let token;
    try { token = await auth.api.getAccessToken({ headers: request.headers, body: { accountId: account.id } }); } catch { throw mailError('Connect your Google email again to renew sending access.', 403); }
    if (!token?.accessToken || !token.scopes?.includes(GMAIL_SEND_SCOPE) || token.accessTokenExpiresAt && new Date(token.accessTokenExpiresAt).getTime() <= Date.now()) throw mailError('Connect your Google email again to renew sending access.', 403);
    const raw = emailMime({ from: user.email, to: recipient.email, subject, ...rendered, assets });
    const rate = await pool.query("SELECT count(*)::int AS count FROM recruit_write_requests WHERE user_id=$1 AND ticket_id LIKE 'email:%' AND created_at>$2", [user.userId, Date.now() - 3600000]);
    if (rate.rows[0].count >= 30) throw mailError('Email limit reached. Try again in an hour.', 429);
    const now = Date.now();
    // A terminated function must not leave the recruit locked forever. Keep the
    // original request uncertain so repeating its request ID can never resend.
    await pool.query("UPDATE recruit_write_requests SET status='uncertain',updated_at=$1 WHERE ticket_id LIKE 'email:%' AND status='pending' AND updated_at<$2", [now, now - 120000]);
    const claimed = await pool.query("INSERT INTO recruit_write_requests(user_id,request_id,ticket_id,payload_hash,status,created_at,updated_at) VALUES($1,$2,$3,$4,'pending',$5,$5) ON CONFLICT DO NOTHING RETURNING request_id", [user.userId, input.requestId, `email:${input.recruitId}`, hash, now]);
    if (!claimed.rowCount) {
      const previous = await pool.query('SELECT payload_hash,status FROM recruit_write_requests WHERE user_id=$1 AND request_id=$2', [user.userId, input.requestId]);
      if (previous.rows[0]?.payload_hash === hash && previous.rows[0].status === 'saved') return json({ sent: true, notice: 'This message was already sent. No second email was sent.' });
      throw mailError('This email has already been attempted or another email is in progress. Check your Gmail Sent folder before composing another message.', 409);
    }
    try { await sendGmail(token.accessToken, raw); }
    catch (error) { await pool.query("UPDATE recruit_write_requests SET status='uncertain',updated_at=$3 WHERE user_id=$1 AND request_id=$2", [user.userId, input.requestId, Date.now()]); throw error; }
    // Record provider acceptance before optional HubSpot logging. Never resend when logging fails.
    await pool.query("UPDATE recruit_write_requests SET status='saved',updated_at=$3 WHERE user_id=$1 AND request_id=$2", [user.userId, input.requestId, Date.now()]);
    let notice = 'Email sent through Google and logged in HubSpot.';
    try { await logSentEmail({ recruitId: input.recruitId, recipient, sender: user.email, subject, text: rendered.text }); }
    catch { notice = 'Email sent through Google. HubSpot history could not be updated; do not resend.'; }
    return json({ sent: true, notice });
  } catch (error) {
    const known = error instanceof Error && 'status' in error;
    return json({ error: known ? error.message : 'Email is temporarily unavailable. If you clicked Send, check Gmail Sent before trying another message.' }, known ? Number(error.status) || 500 : 503);
  }
}
