import { privateMailboxFetch } from '@/lib/hubspot-mailbox.mjs';
import { getAppUser } from '@/app/app-auth';
import { handleWorkspaceSearch } from '@/lib/workspace-search.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

function handle(request: Request) {
  let user: Awaited<ReturnType<typeof getAppUser>> = null;
  let guarded: typeof fetch | undefined;
  const guardedFetch: typeof fetch = (input, init) => {
    guarded ??= privateMailboxFetch({ viewerEmail: user?.email, accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
    return guarded(input, init);
  };
  return handleWorkspaceSearch(request, {
    getUser: async () => { user = await getAppUser(); return user; }, fetchImpl: guardedFetch,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS,
    allowedOrigin: process.env.BETTER_AUTH_URL,
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    hmacSecret: process.env.BETTER_AUTH_SECRET,
  });
}

export {
  handle as POST,
  handle as GET,
  handle as HEAD,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
