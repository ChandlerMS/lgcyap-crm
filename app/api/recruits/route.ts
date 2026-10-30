import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { handleRecruitRequest, readRecruitingData } from '@/lib/hubspot.mjs';
import { createPostgresLedger, editorAllowed, writeCapability } from '@/lib/hubspot-write.mjs';
import { checkContactCreationCapability, createContactPostgresLedger } from '@/lib/hubspot-contact-create.mjs';
import { checkRecruitIntakeCapability, createRecruitIntakePostgresLedger } from '@/lib/recruit-intake.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getAppUser>>;
  return handleRecruitRequest(request, {
    getUser: async () => { user = await getAppUser(); return user; },
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async () => ({
      ...await readRecruitingData({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN, includeContacts: true }),
      capabilities: {
        canCreateRecruit: await checkRecruitIntakeCapability(user, {
          editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
          writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
          intakeEnabled: process.env.RECRUITING_INTAKE_ENABLED,
          hmacSecret: process.env.BETTER_AUTH_SECRET,
          accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
          ledger: process.env.DATABASE_URL ? createRecruitIntakePostgresLedger(getPool()) : undefined,
          vercel: process.env.VERCEL,
          vercelEnv: process.env.VERCEL_ENV,
        }),
        canCreateContact: await checkContactCreationCapability(user, {
          editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
          writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
          contactCreationEnabled: process.env.RECRUITING_CONTACT_CREATION_ENABLED,
          hmacSecret: process.env.BETTER_AUTH_SECRET,
          accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
          ledger: process.env.DATABASE_URL ? createContactPostgresLedger(getPool()) : undefined,
          vercel: process.env.VERCEL,
          vercelEnv: process.env.VERCEL_ENV,
        }),
        canEdit: writeCapability(user, {
          editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
          writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
          ledger: process.env.DATABASE_URL ? createPostgresLedger(getPool()) : undefined,
          vercel: process.env.VERCEL,
          vercelEnv: process.env.VERCEL_ENV,
        }),
        writeAccessPending: editorAllowed(user, process.env.RECRUITING_EDITOR_EMAILS)
          && process.env.RECRUITING_WRITES_ENABLED !== 'true',
      },
    }),
  });
}

export async function GET(request: Request) {
  return handleRecruitRequest(request, { getUser: getAppUser, readData: () => Promise.reject(), allowedOrigin: process.env.BETTER_AUTH_URL });
}
