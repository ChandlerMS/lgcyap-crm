import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleLeaderboardRequest, readLeaderboard } from '@/lib/leaderboard.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: Request) {
  return handleLeaderboardRequest(request, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: input => readLeaderboard(input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN }),
  });
}
export const POST = handle;
export const GET = handle;
