import { getSvpCallsDb } from '@/db/svp-calls.mjs';
import { cronAuthorized } from '@/lib/recruit-lifecycle-sync.mjs';
import { createRingCx } from '@/lib/ringcx.mjs';
import { openSvpReport, syncSvpRingcxCalls } from '@/lib/svp-ringcx-calls.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const client = createRingCx({ clientId: process.env.RINGCX_CLIENT_ID, clientSecret: process.env.RINGCX_CLIENT_SECRET, jwt: process.env.RINGCX_JWT });

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!cronAuthorized(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const summary = await syncSvpRingcxCalls(await getSvpCallsDb(), () => openSvpReport(client));
    if (summary.status === 'failed') console.error(`RingCX call sync failed: ${summary.code}${summary.detail ? ` (${summary.detail})` : ''}`);
    return Response.json(summary, { status: summary.status === 'failed' ? 503 : 200, headers });
  } catch {
    return Response.json({ error: 'RingCX call sync unavailable; no unconfirmed success is reported.' }, { status: 503, headers });
  }
}
