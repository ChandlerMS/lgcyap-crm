import { getPool } from '@/db/pool.mjs';
import { cronAuthorized } from '@/lib/recruit-lifecycle-sync.mjs';
import { customRecruitSyncEnabled, runCustomRecruitJob } from '@/lib/custom-recruit-job.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!cronAuthorized(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!customRecruitSyncEnabled()) return Response.json({ status: 'disabled' }, { status: 503, headers });
  try {
    const summary = await runCustomRecruitJob({ pool: getPool(), accessToken: process.env.HUBSPOT_ACCESS_TOKEN, secret: process.env.BETTER_AUTH_SECRET });
    console.info('custom_recruit_sync', summary);
    return Response.json(summary, { headers });
  } catch {
    console.info('custom_recruit_sync', { status: 'unavailable' });
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}
