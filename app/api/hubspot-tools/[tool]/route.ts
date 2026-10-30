import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleHubSpotToolRequest, readHubSpotTool } from '@/lib/hubspot-tools.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: Request, context: { params: Promise<{ tool: string }> }) {
  const { tool } = await context.params;
  return handleHubSpotToolRequest(request, tool, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: (selectedTool: string, input: { threadId?: string }) => readHubSpotTool(selectedTool, input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN }),
  });
}

export const POST = handle;
export const GET = handle;
