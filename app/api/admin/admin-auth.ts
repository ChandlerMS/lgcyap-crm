import { getAppUser } from '@/app/app-auth';
import { adminAllowed } from '@/lib/admin-policy.mjs';
import { isAllowedOrigin } from '@/lib/hubspot.mjs';
export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: privateHeaders }); }
export async function adminRequest(request: Request, write = false) {
  const user = await getAppUser();
  if (!user) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  if (!adminAllowed(user)) throw Object.assign(new Error('Only Chandler and Sarah can manage access.'), { status: 403 });
  if (write && !isAllowedOrigin(request, process.env.BETTER_AUTH_URL)) throw Object.assign(new Error('Open the CRM directly before changing permissions.'), { status: 403 });
  return user;
}
export async function inputJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(new Error('Send JSON.'), { status: 400 });
  const text = await request.text();
  if (text.length > 4096) throw Object.assign(new Error('The request is too large.'), { status: 413 });
  try { const input = JSON.parse(text); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); return input; } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
}
export function adminError(error: unknown) {
  const known = error as { status?: number; message?: string };
  return json({ error: known.status && known.message ? known.message : 'Administration is temporarily unavailable. Refresh to try again.' }, known.status || 503);
}
