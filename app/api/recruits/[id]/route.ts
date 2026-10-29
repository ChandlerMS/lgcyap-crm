import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger, handleRecruitWriteRequest, saveRecruit } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // This wrapper makes no connection until an authorized, validated request
  // actually acquires its persistent ledger claim.
  const ledger = process.env.DATABASE_URL
    ? createPostgresLedger({ query: (query: string, values: unknown[]) => getPool().query(query, values) })
    : undefined;
  return handleRecruitWriteRequest(request, id, {
    getUser: getAppUser,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
    writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
    ledger,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    allowedOrigin: process.env.BETTER_AUTH_URL,
    saveData: (input: Parameters<typeof saveRecruit>[0], options: { userId: string; ledger: ReturnType<typeof createPostgresLedger> }) =>
      saveRecruit(input, { ...options, accessToken: process.env.HUBSPOT_ACCESS_TOKEN }),
  });
}

export const POST = handle;
export const GET = handle;
