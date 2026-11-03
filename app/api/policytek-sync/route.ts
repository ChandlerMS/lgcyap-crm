import { getPolicytekDb } from '@/db/policytek.mjs';
import { handlePolicytekSync } from '@/lib/policytek-sync-handler.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const handle = (request: Request) => handlePolicytekSync(request, { secret: process.env.POLICYTEK_SYNC_SECRET, getDb: getPolicytekDb });
export const GET = handle;
export const POST = handle;
