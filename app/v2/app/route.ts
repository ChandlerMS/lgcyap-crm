import { requireAppUser } from "@/app/app-auth";
import { onboardDocument } from "@/lib/onboard-host.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await requireAppUser("/v2");
  return onboardDocument();
}
