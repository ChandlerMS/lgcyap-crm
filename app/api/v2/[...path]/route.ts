import { onboardRequest } from "@/lib/onboard-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const handle = (request: Request) => onboardRequest(request, new URL(request.url).pathname === "/api/v2/apply");
export const GET = handle;
export const POST = handle;
export const PUT = handle;
