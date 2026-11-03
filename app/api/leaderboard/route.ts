import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleLeaderboardRequest, readLeaderboard } from '@/lib/leaderboard.mjs';

import { readPolicytekLeaderboard } from '@/lib/policytek.mjs';
import { getPolicytekDb } from '@/db/policytek.mjs';
import { readWhatsappLeaderboard } from '@/lib/whatsapp-sales.mjs';
import { getWhatsappDb } from '@/db/whatsapp.mjs';
import { applySvpCalls, readSvpCalls } from '@/lib/svp-calls.mjs';
import { getSvpCallsDb } from '@/db/svp-calls.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Standard vs. Preferred uses imported answered calls where the call reports cover the range, otherwise HubSpot call logs. */
async function readStandardPreferred(input: Parameters<typeof readLeaderboard>[0]) {
  const result = await readLeaderboard(input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  if (result.status !== 'available') return result;
  try { return applySvpCalls(result, await readSvpCalls(await getSvpCallsDb(), result)); } catch { return result; }
}

async function handle(request: Request) {
  return handleLeaderboardRequest(request, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async input => input.board === 'sp' ? readStandardPreferred(input)
      : input.board === 'whatsapp' ? readWhatsappLeaderboard(input, { db: await getWhatsappDb() })
      : readPolicytekLeaderboard(input, { db: await getPolicytekDb() }),
  });
}
export const POST = handle;
export const GET = handle;
