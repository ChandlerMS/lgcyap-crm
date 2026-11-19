import { getAppUser } from '@/app/app-auth';
import { photoResponse, readNotePhoto } from '@/lib/photo-id.mjs';
import { handleRecruitRequest } from '@/lib/hubspot.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One photo ID from an application or hiring-event sign-in note; ?file=1 is the back of a license. Same editors, origin
// check and empty-body POST as the applications read, so the private file never has a URL that can be opened or shared.
export async function POST(request: Request, context: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await context.params;
  const file = new URL(request.url).searchParams.get('file') ?? '0';
  return handleRecruitRequest(request, {
    getUser: getAppUser,
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async () => photoResponse(await readNotePhoto(noteId, /^\d$/.test(file) ? Number(file) : -1, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN })),
  });
}
