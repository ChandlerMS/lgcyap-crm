import "server-only";
import { waitUntil } from "@vercel/functions";
import { getAppUser } from "@/app/app-auth";
import { onboardEnvironment, serveOnboard } from "./onboard-host.mjs";

let env: ReturnType<typeof onboardEnvironment> | undefined;

export async function onboardRequest(request: Request, publicApplication = false) {
  try {
    const user = publicApplication ? null : await getAppUser();
    if (!publicApplication && !user) return Response.json({ error: "sign_in" }, { status: 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    env ??= onboardEnvironment(process.env);
    return await serveOnboard(request, { user, env, waitUntil, publicApplication });
  } catch {
    return Response.json({ error: "server", message: "Version 2 is temporarily unavailable. Try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
