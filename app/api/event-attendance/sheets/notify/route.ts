import { getSignInSheetsDb } from '@/db/sign-in-sheets.mjs';
import { handleApplicationSheetsJob } from '@/lib/application-sheets-handlers.mjs';
import { syncSignInSheets } from '@/lib/sign-in-sheets-sync.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) { return handleApplicationSheetsJob(request, { notification: true, notificationKey: 'SIGN_IN_SHEETS_NOTIFY_SECRET', getDb: getSignInSheetsDb, sync: syncSignInSheets }); }
