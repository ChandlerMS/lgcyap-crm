import { getAppUser, type AppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleDispositionRequest } from '@/lib/svp-dispositions.mjs';
import { readDispositionSnapshot } from '@/lib/svp-dispositions-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleDispositionRequest(request, {
    getUser: getAppUser,
    authorize: (user: AppUser) => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readSnapshot: readDispositionSnapshot,
  });
}
