import { getAppUser } from '@/app/app-auth';
import { createRingCx, ringCxResponse } from '@/lib/ringcx.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const client = createRingCx({ clientId: process.env.RINGCX_CLIENT_ID, clientSecret: process.env.RINGCX_CLIENT_SECRET, jwt: process.env.RINGCX_JWT });
export async function GET() { return ringCxResponse({ getUser: getAppUser, client }); }
