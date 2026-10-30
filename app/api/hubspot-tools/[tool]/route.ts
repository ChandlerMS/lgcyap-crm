import { getAppUser } from '@/app/app-auth';
import { createPostgresLedger, editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleHubSpotToolRequest, readHubSpotTool } from '@/lib/hubspot-tools.mjs';
import { checkToolWriteCapability } from '@/lib/hubspot-tool-write.mjs';
import { getPool } from '@/db/pool.mjs';
import { readInboxPage } from '@/lib/hubspot-inbox.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: Request, context: { params: Promise<{ tool: string }> }) {
  const { tool } = await context.params;
  let user: Awaited<ReturnType<typeof getAppUser>> = null;
  return handleHubSpotToolRequest(request, tool, {
    getUser: async () => { user = await getAppUser(); return user; },
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async (selectedTool: string, input: { threadId?: string; query?: string; recordId?: string; archive?: string; continuation?: string }) => {
      if (selectedTool === 'inbox') return readInboxPage(input, { userId: user?.userId ?? '', hmacSecret: process.env.BETTER_AUTH_SECRET, accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
      const result = await readHubSpotTool(selectedTool, input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
      result.capabilities.canEdit = result.status === 'available' && Boolean(input.recordId) && await checkToolWriteCapability(selectedTool, user, {
        accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
        editorEmails: process.env.RECRUITING_EDITOR_EMAILS, writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
        ledger: process.env.DATABASE_URL ? createPostgresLedger(getPool()) : undefined,
        vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV,
      });
      return result;
    },
  });
}

export const POST = handle;
export const GET = handle;
