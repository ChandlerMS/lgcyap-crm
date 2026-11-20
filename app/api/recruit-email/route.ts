import { getAppUser } from '@/app/app-auth';
import { handleGmailCompose } from '@/lib/gmail-compose.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) { return handleGmailCompose(request, { getUser: getAppUser }); }
