import { getAppUser } from '@/app/app-auth';
import { handleGmailMail } from '@/lib/gmail-mail.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) { return handleGmailMail(request, { getUser: getAppUser }); }
