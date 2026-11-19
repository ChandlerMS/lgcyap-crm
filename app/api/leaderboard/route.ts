import { getAppUser } from '@/app/app-auth';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { handleLeaderboardRequest, readLeaderboard } from '@/lib/leaderboard.mjs';
import { leaderboardReadOrigin } from '@/lib/leaderboard-host.mjs';

import { readPolicytekLeaderboard } from '@/lib/policytek.mjs';
import { getPolicytekDb } from '@/db/policytek.mjs';
import { readWhatsappLeaderboard, readPendingWhatsappStandardPreferred } from '@/lib/whatsapp-sales.mjs';
import { getWhatsappDb } from '@/db/whatsapp.mjs';
import { applySvpCalls, readSvpCalls } from '@/lib/svp-calls.mjs';
import { getSvpCallsDb } from '@/db/svp-calls.mjs';
import { readShopperReportsLeaderboard } from '@/lib/shopper-reports.mjs';
import { getShopperReportsDb } from '@/db/shopper-reports.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Standard vs. Preferred uses imported answered calls where the call reports cover the range, otherwise HubSpot call logs. */
async function readStandardPreferred(input: Parameters<typeof readLeaderboard>[0]) {
  const result = await readLeaderboard(input, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  if (result.status !== 'available') return result;
  try { return applySvpCalls(result, await readSvpCalls(await getSvpCallsDb(), result)); } catch { return result; }
}

/** Shopper uses the imported Calls and Applications reports where they cover every day of the range, otherwise the PolicyTek browser sync. */
async function readShopper(input: Parameters<typeof readLeaderboard>[0]) {
  try {
    const imported = await readShopperReportsLeaderboard(input, { db: await getShopperReportsDb() });
    if (imported) return imported;
  } catch { /* An unreadable import never hides the browser-sync snapshot. */ }
  return readPolicytekLeaderboard(input, { db: await getPolicytekDb() });
}

async function handle(request: Request) {
  return handleLeaderboardRequest(request, {
    getUser: getAppUser,
    authorizeUser: user => editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS),
    // The TV page at leaderboard.lgcyap.com reads the same data from its own exact origin.
    allowedOrigin: leaderboardReadOrigin(request, process.env.BETTER_AUTH_URL),
    readData: async input => input.board === 'whatsapp-sp' ? readPendingWhatsappStandardPreferred(input)
      : input.board === 'sp' ? readStandardPreferred(input)
      : input.board === 'whatsapp' ? readWhatsappLeaderboard(input, { db: await getWhatsappDb() })
      : input.board === 'shopper' ? readShopper(input)
      : readPolicytekLeaderboard(input, { db: await getPolicytekDb() }),
  });
}
export const POST = handle;
export const GET = handle;
