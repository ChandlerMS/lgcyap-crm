import "server-only";
import { currentAccessPolicy } from "@/lib/admin-access.mjs";
import { CRM_AUTHORIZED } from "@/lib/admin-policy.mjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionCookie } from "better-auth/cookies";
import { queueSessionHeaders } from "@/lib/queue-host.mjs";
import { leaderboardSessionHeaders } from "@/lib/leaderboard-host.mjs";
import { getAuth } from "@/lib/auth";
import { safeReturnPath, sessionUser } from "@/lib/auth-policy.mjs";

export type AppUser = { userId: string; email: string; displayName: string; fullName: string | null };

export class AuthUnavailableError extends Error {
  constructor() { super("Employee sign-in is temporarily unavailable."); this.name = "AuthUnavailableError"; }
}

export async function getAppUser(): Promise<AppUser | null> {
  // Each adapter acts only on its own host (queue. or leaderboard.lgcyap.com); elsewhere headers pass through unchanged.
  const requestHeaders = leaderboardSessionHeaders(queueSessionHeaders(await headers(), process.env.BETTER_AUTH_URL), process.env.BETTER_AUTH_URL);
  // This is only an optimization; Better Auth verifies the actual session below.
  if (!getSessionCookie(requestHeaders)) return null;
  const auth = getAuth();
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    const policy = await currentAccessPolicy();
    const user = sessionUser(session, policy.RECRUITING_EDITOR_EMAILS, Date.now(), policy.GOOGLE_PERSONAL_EMAILS, policy.GOOGLE_EXTERNAL_EMAILS, policy.GOOGLE_WORKSPACE_DOMAIN);
    return user ? Object.assign(user, { [CRM_AUTHORIZED]: true }) : null;
  } catch { throw new AuthUnavailableError(); }
}

export async function requireAppUser(returnTo = "/"): Promise<AppUser> {
  let user: AppUser | null;
  try { user = await getAppUser(); }
  catch { redirect("/sign-in?error=unavailable"); }
  if (user) return user;
  redirect(`/sign-in?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
}
