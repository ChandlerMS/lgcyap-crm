import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger } from '@/lib/hubspot-write.mjs';
import { createContractAgent, handleContractAgentCreate } from '@/lib/contract-agent-create.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function handle(request: Request) {
  const ledger = process.env.DATABASE_URL ? {
    claim: (value: Parameters<ReturnType<typeof createPostgresLedger>['claim']>[0]) => createPostgresLedger(getPool()).claim(value),
    finish: (value: Parameters<ReturnType<typeof createPostgresLedger>['finish']>[0]) => createPostgresLedger(getPool()).finish(value),
  } : undefined;
  return handleContractAgentCreate(request, {
    getUser: getAppUser, ledger, allowedOrigin: process.env.BETTER_AUTH_URL,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS, writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
    vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV,
    createData: (input, options) => createContractAgent(input, { ...options, accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET }),
  });
}

export const POST = handle;
export const GET = handle;
