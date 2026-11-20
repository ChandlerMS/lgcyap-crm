import { getAppUser } from '@/app/app-auth';
import { handleGmailConnection } from '@/lib/gmail-connection.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return handleGmailConnection(request, { getUser: getAppUser }); }
export async function POST(request: Request) { return handleGmailConnection(request, { getUser: getAppUser }); }
