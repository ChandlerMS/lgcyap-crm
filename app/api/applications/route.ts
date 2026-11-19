import { getAppUser } from '@/app/app-auth';
import { readApplications } from '@/lib/applications.mjs';
import { handleRecruitRequest } from '@/lib/hubspot.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Online applications, with every answer. Same audience, origin check and empty-body POST read as the recruiting
// workspace, whose recruit activity already shows these notes to the same editors.
export async function POST(request: Request) {
  return handleRecruitRequest(request, {
    getUser: getAppUser,
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: () => readApplications({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN }),
  });
}
