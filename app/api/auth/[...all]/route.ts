import { handleAuthRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(request: Request) {
  return handleAuthRequest(request);
}

export const GET = handle;
export const POST = handle;
