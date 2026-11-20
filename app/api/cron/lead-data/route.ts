import { getLeadDataDb } from '@/db/lead-data.mjs';
import { openLeadDataReports, syncLeadData } from '@/lib/lead-data.mjs';
import { policytekRefreshActive } from '@/lib/policytek-schedule.mjs';
import { cronAuthorized } from '@/lib/recruit-lifecycle-sync.mjs';
import { createRingCx } from '@/lib/ringcx.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const client = createRingCx({ clientId: process.env.RINGCX_CLIENT_ID, clientSecret: process.env.RINGCX_CLIENT_SECRET, jwt: process.env.RINGCX_JWT });

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!cronAuthorized(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  // Checked here because vercel.json's UTC schedule cannot follow daylight saving.
  if (!policytekRefreshActive()) return Response.json({ status: 'skipped', reason: 'outside sync hours' }, { headers });
  try {
    const summary = await syncLeadData(await getLeadDataDb(), () => openLeadDataReports(client));
    if (summary.status === 'failed') console.error(`Lead Data sync failed: ${summary.code}${summary.detail ? ` (${summary.detail})` : ''}`);
    return Response.json(summary, { status: summary.status === 'failed' ? 503 : 200, headers });
  } catch {
    return Response.json({ error: 'Lead Data sync unavailable; no unconfirmed success is reported.' }, { status: 503, headers });
  }
}
