import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger } from '@/lib/hubspot-write.mjs';
import { handleHubSpotToolWriteRequest, saveHubSpotToolRecord } from '@/lib/hubspot-tool-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: Request, context: { params: Promise<{ tool: string; id: string }> }) {
  const { tool, id } = await context.params;
  const ledger = process.env.DATABASE_URL ? createPostgresLedger(getPool()) : undefined;
  return handleHubSpotToolWriteRequest(request, tool, id, {
    getUser: getAppUser, ledger, allowedOrigin: process.env.BETTER_AUTH_URL,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS, writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
    vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV,
    saveData: (input, options) => saveHubSpotToolRecord(input, { ...options, accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET }),
  });
}

export const POST = handle;
export const GET = handle;
