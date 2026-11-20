import { currentAccessPolicy } from "@/lib/admin-access.mjs";
import { getAuth } from '@/lib/auth';
import { sessionUser } from '@/lib/auth-policy.mjs';
import { leaderboardAccessResponse } from '@/lib/leaderboard-host.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same approved-employee rule as the CRM and Queue.
export async function GET(request: Request) {
  let policy;
  try { policy = await currentAccessPolicy(); } catch { return new Response("Access verification unavailable.", { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
  return leaderboardAccessResponse(request, {
    baseURL: process.env.BETTER_AUTH_URL,
    getSession: async (headers: Headers) => {
      const auth = getAuth();
      if (!auth) throw new Error('Authentication is not configured');
      return auth.api.getSession({ headers });
    },
    authorize: (session: Parameters<typeof sessionUser>[0]) => Boolean(sessionUser(session, policy.RECRUITING_EDITOR_EMAILS, Date.now(), policy.GOOGLE_PERSONAL_EMAILS, policy.GOOGLE_EXTERNAL_EMAILS, policy.GOOGLE_WORKSPACE_DOMAIN)),
  });
}
