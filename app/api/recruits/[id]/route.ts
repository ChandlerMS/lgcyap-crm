import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { handleRecruitWriteRequest, saveRecruit } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';

type Runtime = { HUBSPOT_ACCESS_TOKEN?: string; RECRUITING_EDITOR_EMAILS?: string; RECRUITING_WRITES_ENABLED?: string; DB?: D1Database };

async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const config = env as Runtime;
  return handleRecruitWriteRequest(request, id, {
    getUser: getChatGPTUser, editorEmails: config.RECRUITING_EDITOR_EMAILS,
    writesEnabled: config.RECRUITING_WRITES_ENABLED, db: config.DB,
    saveData: (input: Parameters<typeof saveRecruit>[0], options: { userId: string; ledger: ReturnType<typeof import('@/lib/hubspot-write.mjs')['createD1Ledger']> }) =>
      saveRecruit(input, { ...options, accessToken: config.HUBSPOT_ACCESS_TOKEN }),
  });
}

export const POST = handle;
export const GET = handle;
