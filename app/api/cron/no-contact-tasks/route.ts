import { cronAuthorized } from '@/lib/recruit-lifecycle-sync.mjs';
import { noContactEnabled, runNoContactJob } from '@/lib/no-contact-job.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
 const headers = { 'Cache-Control': 'private, no-store' };
 if (!cronAuthorized(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
 if (!noContactEnabled()) return Response.json({ status: 'disabled' }, { status: 503, headers });
 try { const summary = await runNoContactJob({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN }); console.info('no-contact-tasks', summary); return Response.json(summary, { headers }); }
 catch (error) { const failure = error as { followUpStage?: string; code?: string; status?: number }; console.error('no-contact-tasks unavailable', { stage: failure.followUpStage ?? 'database', code: /^[A-Z0-9_]{1,64}$/.test(failure.code ?? '') ? failure.code : undefined, status: failure.status }); return Response.json({ error: 'Automatic follow-up check unavailable. No unconfirmed success is reported.' }, { status: 503, headers }); }
}
