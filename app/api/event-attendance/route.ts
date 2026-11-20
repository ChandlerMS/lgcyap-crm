import { getAppUser } from '@/app/app-auth';
import { readEventAttendance } from '@/lib/event-attendance.mjs';
import { handleRecruitRequest } from '@/lib/hubspot.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { toolWriteCapability } from '@/lib/hubspot-tool-write.mjs';
import { recruitIntakeCapability } from '@/lib/recruit-intake.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same audience, origin check and empty-body POST read as the recruiting workspace.
export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getAppUser>>;
  return handleRecruitRequest(request, {
    getUser: async () => { user = await getAppUser(); return user; },
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async () => ({
      ...await readEventAttendance({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN, includeReviews: true, reviewSecrets: [process.env.EVENT_REVIEW_HMAC_SECRET, process.env.BETTER_AUTH_SECRET, ...(process.env.EVENT_REVIEW_PREVIOUS_SECRETS ?? '').split(',')].filter((value): value is string => Boolean(value)) }),
      canReview: toolWriteCapability('tasks', user, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET, editorEmails: process.env.RECRUITING_EDITOR_EMAILS, writesEnabled: process.env.RECRUITING_WRITES_ENABLED, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV, ledger: process.env.DATABASE_URL ? { claim() {}, finish() {} } : undefined }),
      // Shows Import attendees; the import route repeats every check before writing.
      canImport: recruitIntakeCapability(user, {
        editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
        writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
        intakeEnabled: process.env.RECRUITING_INTAKE_ENABLED,
        hmacSecret: process.env.BETTER_AUTH_SECRET,
        vercel: process.env.VERCEL,
        vercelEnv: process.env.VERCEL_ENV,
        ledger: process.env.DATABASE_URL ? { claim() {}, finish() {} } : undefined,
      }),
    }),
  });
}
