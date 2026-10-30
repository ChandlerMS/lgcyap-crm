import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleRecruitActivity, readRecruitActivity } from '@/lib/recruit-activity.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleRecruitActivity(request, id, {
    getUser: getAppUser,
    authorizeUser: (user: unknown) => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: (recruitId: string, input: object) => readRecruitActivity(recruitId, input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN }),
  });
}
