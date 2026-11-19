import { waitUntil } from '@vercel/functions';
import { SHEETS_STATE_PREFIX } from '@/lib/application-sheets-oauth.mjs';
import { handleApplicationSheetsCallback } from '@/lib/application-sheets-handlers.mjs';
import { handleAuthRequest } from '@/lib/auth';
import { getAppUser } from '@/app/app-auth';
import { readApplications } from '@/lib/applications.mjs';
import { EXPORT_STATE_PREFIX, finishApplicationExport } from '@/lib/applications-export-oauth.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function handle(request: Request) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.endsWith('/callback/google') && url.searchParams.get('state')?.startsWith(SHEETS_STATE_PREFIX)) {
    return handleApplicationSheetsCallback(request, { getUser: getAppUser, defer: waitUntil });
  }
  if (request.method === 'GET' && url.pathname.endsWith('/callback/google') && url.searchParams.get('state')?.startsWith(EXPORT_STATE_PREFIX)) {
    let user = null;
    try { user = await getAppUser(); } catch { /* The export callback returns a private sign-in error. */ }
    return finishApplicationExport(request, { user, env: process.env, readData: () => readApplications({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN, includeReviews: true, reviewSecrets: [process.env.EVENT_REVIEW_HMAC_SECRET, process.env.BETTER_AUTH_SECRET, ...(process.env.EVENT_REVIEW_PREVIOUS_SECRETS ?? '').split(',')].filter((value): value is string => Boolean(value)) }) });
  }
  return handleAuthRequest(request);
}

export const GET = handle;
export const POST = handle;
