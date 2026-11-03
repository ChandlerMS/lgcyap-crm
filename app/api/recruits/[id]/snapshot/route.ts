import { getAppUser } from '@/app/app-auth';
import { handleRecruitRequest, RecruitingError } from '@/lib/hubspot.mjs';
import { editorAllowed, readRecruitStageSnapshot, WriteError } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleRecruitRequest(request, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async () => {
      try { return { recruit: await readRecruitStageSnapshot(id, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN }) }; }
      catch (error) {
        if (error instanceof WriteError) throw new RecruitingError(error.code, error.message, error.status, error.retryAfterSeconds);
        throw error;
      }
    },
  });
}

export const GET = POST;
