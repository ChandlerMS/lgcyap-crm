import { getAppUser } from '@/app/app-auth';
import { photoResponse, readApplicationPhoto } from '@/lib/application-photo.mjs';
import { handleRecruitRequest } from '@/lib/hubspot.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One applicant's photo ID, for the Applications page. Same editors, origin check and empty-body POST as the
// applications read, so the private file never has a URL that can be opened or shared on its own.
export async function POST(request: Request, context: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await context.params;
  return handleRecruitRequest(request, {
    getUser: getAppUser,
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async () => photoResponse(await readApplicationPhoto(noteId, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN })),
  });
}
