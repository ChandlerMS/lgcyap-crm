import { getAppUser } from '@/app/app-auth';
import { readApplications } from '@/lib/applications.mjs';
import { handleRecruitRequest } from '@/lib/hubspot.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';
import { toolWriteCapability } from '@/lib/hubspot-tool-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Online applications, with every answer. Same audience, origin check and empty-body POST read as the recruiting
// workspace, whose recruit activity already shows these notes to the same editors. Approved and Denied decisions
// and canReview match Event Attendance, whose review buttons the Applications page shares.
export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getAppUser>>;
  return handleRecruitRequest(request, {
    getUser: async () => { user = await getAppUser(); return user; },
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readData: async () => ({
      ...await readApplications({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN, includeReviews: true, reviewSecrets: [process.env.EVENT_REVIEW_HMAC_SECRET, process.env.BETTER_AUTH_SECRET, ...(process.env.EVENT_REVIEW_PREVIOUS_SECRETS ?? '').split(',')].filter((value): value is string => Boolean(value)) }),
      canReview: toolWriteCapability('tasks', user, { accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET, editorEmails: process.env.RECRUITING_EDITOR_EMAILS, writesEnabled: process.env.RECRUITING_WRITES_ENABLED, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV, ledger: process.env.DATABASE_URL ? { claim() {}, finish() {} } : undefined }),
    }),
  });
}
