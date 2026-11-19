import { getSignInSheetsDb } from '@/db/sign-in-sheets.mjs';
import { handleApplicationSheetsJob } from '@/lib/application-sheets-handlers.mjs';
import { syncSignInSheets } from '@/lib/sign-in-sheets-sync.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return handleApplicationSheetsJob(request, { getDb: getSignInSheetsDb, sync: syncSignInSheets }); }
