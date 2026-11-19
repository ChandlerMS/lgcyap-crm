import { getAppUser } from '@/app/app-auth';
import { handleApplicationSheets } from '@/lib/application-sheets-handlers.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return handleApplicationSheets(request, { getUser: getAppUser }); }
export async function POST(request: Request) { return handleApplicationSheets(request, { getUser: getAppUser }); }
