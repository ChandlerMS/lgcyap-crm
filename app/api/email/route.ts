import { getAppUser } from '@/app/app-auth';
import { handleEmailInbox } from '@/lib/hubspot-email-inbox.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return handleEmailInbox(request, { getUser: getAppUser }); }
export async function POST(request: Request) { return handleEmailInbox(request, { getUser: getAppUser }); }
