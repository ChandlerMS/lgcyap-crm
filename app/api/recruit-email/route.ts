import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { isAllowedOrigin } from '@/lib/hubspot.mjs';
import { verifiedRecipient, mailError } from '@/lib/recruit-email.mjs';
import { hubspotEmailHandoff } from '@/lib/hubspot-email.mjs';

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
    // Retired clients cannot send directly or initiate Google authorization here.
    if (input.action !== 'prepare') return json({ error: 'Compose and send emails in HubSpot. Reload the CRM to continue.' }, 410);
    const recipient = await verifiedRecipient(input.recruitId);
    return json({ recipient, ...hubspotEmailHandoff(recipient) });
  } catch (error) {
    const known = error instanceof Error && 'status' in error;
    return json({ error: known ? error.message : 'Email is temporarily unavailable. Try again shortly.' }, known ? Number(error.status) || 500 : 503);
  }
}
