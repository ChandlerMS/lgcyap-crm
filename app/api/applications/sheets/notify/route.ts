import { handleApplicationSheetsJob } from '@/lib/application-sheets-handlers.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) { return handleApplicationSheetsJob(request, { notification: true }); }
