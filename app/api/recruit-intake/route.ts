import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createRecruitIntake, createRecruitIntakePostgresLedger, handleRecruitIntakeRequest } from '@/lib/recruit-intake.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function handle(request: Request) {
  const ledger = process.env.DATABASE_URL ? {
    claim: (value: Parameters<ReturnType<typeof createRecruitIntakePostgresLedger>['claim']>[0]) => createRecruitIntakePostgresLedger(getPool()).claim(value),
    finish: (value: Parameters<ReturnType<typeof createRecruitIntakePostgresLedger>['finish']>[0]) => createRecruitIntakePostgresLedger(getPool()).finish(value),
  } : undefined;
  return handleRecruitIntakeRequest(request, {
    getUser: getAppUser,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
    writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
    intakeEnabled: process.env.RECRUITING_INTAKE_ENABLED,
    hmacSecret: process.env.BETTER_AUTH_SECRET,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    allowedOrigin: process.env.BETTER_AUTH_URL,
    ledger,
    createData: (input: Parameters<typeof createRecruitIntake>[0], options: Pick<Parameters<typeof createRecruitIntake>[1], 'userId' | 'ledger'>) => createRecruitIntake(input, {
      ...options, accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
    }),
  });
}

export const POST = handle;
export const GET = handle;
