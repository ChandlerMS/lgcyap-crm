import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createContact, createContactPostgresLedger, handleContactCreateRequest } from '@/lib/hubspot-contact-create.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function handle(request: Request) {
  // No database connection is opened until an authenticated, permitted POST claims.
  const ledger = process.env.DATABASE_URL ? {
    claim: (value: Parameters<ReturnType<typeof createContactPostgresLedger>['claim']>[0]) => createContactPostgresLedger(getPool()).claim(value),
    finish: (value: Parameters<ReturnType<typeof createContactPostgresLedger>['finish']>[0]) => createContactPostgresLedger(getPool()).finish(value),
  } : undefined;
  return handleContactCreateRequest(request, {
    getUser: getAppUser,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
    writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
    contactCreationEnabled: process.env.RECRUITING_CONTACT_CREATION_ENABLED,
    hmacSecret: process.env.BETTER_AUTH_SECRET,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    allowedOrigin: process.env.BETTER_AUTH_URL,
    ledger,
    createData: (input: Parameters<typeof createContact>[0], options: Pick<Parameters<typeof createContact>[1], 'userId' | 'ledger'>) => createContact(input, {
      ...options,
      accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
      hmacSecret: process.env.BETTER_AUTH_SECRET,
    }),
  });
}

export const POST = handle;
export const GET = handle;
