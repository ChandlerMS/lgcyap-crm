import { getAuth } from '@/lib/auth';
import { sessionUser } from '@/lib/auth-policy.mjs';
import { leaderboardAccessResponse } from '@/lib/leaderboard-host.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same approved-employee rule as the CRM and Queue.
export async function GET(request: Request) {
  return leaderboardAccessResponse(request, {
    baseURL: process.env.BETTER_AUTH_URL,
    getSession: async (headers: Headers) => {
      const auth = getAuth();
      if (!auth) throw new Error('Authentication is not configured');
      return auth.api.getSession({ headers });
    },
    authorize: (session: Parameters<typeof sessionUser>[0]) => Boolean(sessionUser(session, process.env.RECRUITING_EDITOR_EMAILS, Date.now(), process.env.GOOGLE_PERSONAL_EMAILS, process.env.GOOGLE_EXTERNAL_EMAILS, process.env.GOOGLE_WORKSPACE_DOMAIN)),
  });
}
