import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleLeaderboardRequest, readLeaderboard } from '@/lib/leaderboard.mjs';
import { leaderboardReadOrigin } from '@/lib/leaderboard-host.mjs';
import { readAllLeaderboard } from '@/lib/leaderboard-all.mjs';

import { readPolicytekLeaderboard } from '@/lib/policytek.mjs';
import { getPolicytekDb } from '@/db/policytek.mjs';
import { readWhatsappLeaderboard, readPendingWhatsappStandardPreferred } from '@/lib/whatsapp-sales.mjs';
import { getWhatsappDb } from '@/db/whatsapp.mjs';
import { applySvpCalls, readSvpCalls } from '@/lib/svp-calls.mjs';
import { getSvpCallsDb } from '@/db/svp-calls.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Standard vs. Preferred uses imported answered calls where the call reports cover the range, otherwise HubSpot call logs. */
async function readStandardPreferred(input: Parameters<typeof readLeaderboard>[0], { now }: { now?: number } = {}) {
  const clockStarted = Date.now();
  let initialRead = true;
  // Freeze the range's initial read while preserving the provider's elapsed-time budget.
  const providerNow = now === undefined ? Date.now : () => {
    if (initialRead) { initialRead = false; return now; }
    return now + Date.now() - clockStarted;
  };
  const result = await readLeaderboard(input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN, now: providerNow });
  if (result.status !== 'available') return result;
  try { return applySvpCalls(result, await readSvpCalls(await getSvpCallsDb(), result, now)); } catch { return result; }
}

async function handle(request: Request) {
  return handleLeaderboardRequest(request, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    // The TV page at leaderboard.lgcyap.com reads the same data from its own exact origin.
    allowedOrigin: leaderboardReadOrigin(request, process.env.BETTER_AUTH_URL),
    readData: async input => input.board === 'all' ? readAllLeaderboard(input, {
      readShopper: async (selected, options) => readPolicytekLeaderboard(selected, { db: await getPolicytekDb(), ...options }),
      readStandardPreferred,
    })
      : input.board === 'whatsapp-sp' ? readPendingWhatsappStandardPreferred(input)
      : input.board === 'sp' ? readStandardPreferred(input)
      : input.board === 'whatsapp' ? readWhatsappLeaderboard(input, { db: await getWhatsappDb() })
      : readPolicytekLeaderboard(input, { db: await getPolicytekDb() }),
  });
}
export const POST = handle;
export const GET = handle;
