import { onboardRequest } from "@/lib/onboard-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (request: Request) => onboardRequest(request, true);
