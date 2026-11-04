import { getAppUser } from '@/app/app-auth';
import { getLeadDataDb } from '@/db/lead-data.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { leadDataLoaded, openLeadDataReports, readLeadData, syncLeadData, validateLeadDataInput } from '@/lib/lead-data.mjs';
import { handleLeaderboardRequest } from '@/lib/leaderboard.mjs';
import { createRingCx } from '@/lib/ringcx.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const client = createRingCx({ clientId: process.env.RINGCX_CLIENT_ID, clientSecret: process.env.RINGCX_CLIENT_SECRET, jwt: process.env.RINGCX_JWT });

async function handle(request: Request) {
  return handleLeaderboardRequest(request, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    validateInput: validateLeadDataInput,
    readData: async input => {
      const db = await getLeadDataDb();
      // The first load runs when someone first opens the page, at any hour, so the page isn't blank until the next 9 AM run.
      if (!await leadDataLoaded(db)) {
        const first = await syncLeadData(db, () => openLeadDataReports(client));
        if (first.status === 'failed') console.error(`Lead Data's first read failed: ${first.code}${first.detail ? ` (${first.detail})` : ''}`);
      }
      return readLeadData(input, { db });
    },
  });
}
export const POST = handle;
export const GET = handle;
