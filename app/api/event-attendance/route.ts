import { getAppUser } from '@/app/app-auth';
import { readEventAttendance } from '@/lib/event-attendance.mjs';
import { handleRecruitRequest } from '@/lib/hubspot.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same audience, origin check and empty-body POST read as the recruiting workspace.
export async function POST(request: Request) {
  return handleRecruitRequest(request, {
    getUser: getAppUser,
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: () => readEventAttendance({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN }),
  });
}
