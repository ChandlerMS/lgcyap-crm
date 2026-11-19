import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger } from '@/lib/hubspot-write.mjs';
import { handleInboxThreadRequest } from '@/lib/inbox-thread.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleInboxThreadRequest(request, {
    getUser: getAppUser, getLedger: () => createPostgresLedger(getPool()),
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS, allowedOrigin: process.env.BETTER_AUTH_URL,
    writesEnabled: process.env.RECRUITING_WRITES_ENABLED, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV,
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
  });
}
