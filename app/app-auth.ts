import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionCookie } from "better-auth/cookies";
import { getAuth } from "@/lib/auth";
import { safeReturnPath, sessionUser } from "@/lib/auth-policy.mjs";

export type AppUser = { userId: string; email: string; displayName: string; fullName: string | null };

export class AuthUnavailableError extends Error {
  constructor() { super("Employee sign-in is temporarily unavailable."); this.name = "AuthUnavailableError"; }
}

export async function getAppUser(): Promise<AppUser | null> {
  const requestHeaders = await headers();
  // This is only an optimization; Better Auth verifies the actual session below.
  if (!getSessionCookie(requestHeaders)) return null;
  const auth = getAuth();
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    return sessionUser(session, process.env.RECRUITING_EDITOR_EMAILS, Date.now(), process.env.GOOGLE_PERSONAL_EMAILS);
  } catch { throw new AuthUnavailableError(); }
}

export async function requireAppUser(returnTo = "/"): Promise<AppUser> {
  let user: AppUser | null;
  try { user = await getAppUser(); }
  catch { redirect("/sign-in?error=unavailable"); }
  if (user) return user;
  redirect(`/sign-in?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
}
