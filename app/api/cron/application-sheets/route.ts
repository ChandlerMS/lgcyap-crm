import { handleApplicationSheetsJob } from '@/lib/application-sheets-handlers.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return handleApplicationSheetsJob(request); }
