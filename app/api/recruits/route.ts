import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { handleRecruitRequest, readRecruitingData } from '@/lib/hubspot.mjs';
import { editorAllowed, writeCapability } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const bindings = env as Cloudflare.Env;
  const user = await getChatGPTUser();
  return handleRecruitRequest(request, {
    getUser: async () => user,
    authorizeUser: (visitor: { email?: string }) => editorAllowed(visitor, bindings.RECRUITING_EDITOR_EMAILS),
    readData: async () => ({
      ...await readRecruitingData({ accessToken: bindings.HUBSPOT_ACCESS_TOKEN }),
      capabilities: {
        canEdit: writeCapability(user, { editorEmails: bindings.RECRUITING_EDITOR_EMAILS, writesEnabled: bindings.RECRUITING_WRITES_ENABLED, db: bindings.DB }),
        writeAccessPending: editorAllowed(user, bindings.RECRUITING_EDITOR_EMAILS) && bindings.RECRUITING_WRITES_ENABLED !== 'true',
      },
    }),
  });
}

export async function GET(request: Request) {
  return handleRecruitRequest(request, { getUser: getChatGPTUser, readData: () => Promise.reject() });
}
