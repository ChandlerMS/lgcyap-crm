import { getAuth } from '@/lib/auth';
import { auditAction } from '@/db/admin-access.mjs';
import { GOOGLE_ADMIN_SCOPES, directoryClient, readGoogleDirectory, changeGoogleRole } from '@/lib/google-admin.mjs';
import { adminRequest, adminError, inputJson, json } from '../admin-auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
async function googleToken(request: Request) {
  const auth = getAuth();
  if (!auth) throw Object.assign(new Error('Google authorization is unavailable.'), { status: 503 });
  const accounts = await auth.api.listUserAccounts({ headers: request.headers });
  const account = accounts.find((item: { providerId: string; id: string; scopes: string[] }) => item.providerId === 'google');
  if (!account || !GOOGLE_ADMIN_SCOPES.every(scope => account.scopes.includes(scope))) throw Object.assign(new Error('Connect Google Workspace to allow directory and administrator role management.'), { status: 403 });
  const tokens = await auth.api.getAccessToken({ headers: request.headers, body: { accountId: account.id } });
  if (!tokens.accessToken || (tokens.accessTokenExpiresAt && tokens.accessTokenExpiresAt.getTime() <= Date.now())) throw Object.assign(new Error('Reconnect Google Workspace to renew access.'), { status: 403 });
  return tokens.accessToken;
}
export async function GET(request: Request) {
  try {
    await adminRequest(request);
    return json(await readGoogleDirectory(directoryClient(await googleToken(request))));
  } catch (error) { return adminError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await adminRequest(request, true);
    const input = await inputJson(request);
    const read = directoryClient(await googleToken(request));
    // Keep a durable record before a remote write, including when Google cannot confirm its outcome.
    await auditAction(actor.email, 'google.role.requested', JSON.stringify({ action: input.action, userId: input.userId, roleId: input.roleId, assignmentId: input.assignmentId }).slice(0, 400));
    const result = await changeGoogleRole(read, input);
    try { await auditAction(actor.email, `google.role.${input.action}`, result.target); }
    catch { return json({ error: 'Google completed the change, but its audit confirmation could not be saved. Refresh permissions before taking another action.' }, 502); }
    return json({ status: 'saved' });
  } catch (error) { return adminError(error); }
}
