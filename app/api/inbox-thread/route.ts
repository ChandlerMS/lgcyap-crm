import { privateMailboxFetch } from '@/lib/hubspot-mailbox.mjs';
import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger } from '@/lib/hubspot-write.mjs';
import { handleInboxThreadRequest } from '@/lib/inbox-thread.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getAppUser>> = null;
  let guarded: typeof fetch | undefined;
  const guardedFetch: typeof fetch = (input, init) => {
    guarded ??= privateMailboxFetch({ viewerEmail: user?.email, accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
    return guarded(input, init);
  };
  return handleInboxThreadRequest(request, {
    getUser: async () => { user = await getAppUser(); return user; }, fetchImpl: guardedFetch, getLedger: () => createPostgresLedger(getPool()),
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS, allowedOrigin: process.env.BETTER_AUTH_URL,
    writesEnabled: process.env.RECRUITING_WRITES_ENABLED, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV,
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
  });
}
