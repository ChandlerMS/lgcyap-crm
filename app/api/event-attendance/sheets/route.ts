import { getAppUser } from '@/app/app-auth';
import { getSignInSheetsDb } from '@/db/sign-in-sheets.mjs';
import { handleApplicationSheets } from '@/lib/application-sheets-handlers.mjs';
import { signInSheetsStatus, syncSignInSheets } from '@/lib/sign-in-sheets-sync.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
async function handle(request: Request) { return handleApplicationSheets(request, { getUser: getAppUser, getDb: getSignInSheetsDb, sync: syncSignInSheets, status: signInSheetsStatus, report: 'sign-ins' }); }
export const GET = handle;
export const POST = handle;
