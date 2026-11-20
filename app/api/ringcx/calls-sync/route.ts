import { getAppUser } from '@/app/app-auth';
import { getSvpCallsDb } from '@/db/svp-calls.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { readSvpRingcxStatus } from '@/lib/svp-ringcx-calls.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
  const user = await getAppUser();
  if (!user) return Response.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401, headers });
  if (!editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS)) return Response.json({ error: 'ACCESS_DENIED' }, { status: 403, headers });
  try {
    return Response.json(await readSvpRingcxStatus(await getSvpCallsDb()), { headers });
  } catch {
    return Response.json({ error: 'STATUS_UNAVAILABLE' }, { status: 503, headers });
  }
}
