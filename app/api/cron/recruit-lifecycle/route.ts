import { getPool } from '@/db/pool.mjs';
import { cronAuthorized, lifecycleEnabled, runLifecycleJob } from '@/lib/recruit-lifecycle-sync.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!cronAuthorized(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!lifecycleEnabled()) return Response.json({ status: 'disabled' }, { status: 503, headers });
  try {
    const summary = await runLifecycleJob({ pool: getPool(), accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
    return Response.json(summary, { headers });
  } catch {
    return Response.json({ error: 'Lifecycle sync unavailable; no unconfirmed success is reported.' }, { status: 503, headers });
  }
}
