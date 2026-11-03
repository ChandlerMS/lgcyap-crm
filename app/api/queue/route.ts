import { getAppUser } from '@/app/app-auth';
import { createPhoneHud, handleQueueRequest } from '@/lib/phone-hud.mjs';
import { editorAllowed } from '@/lib/hubspot-write.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One PolicyTek reader per function instance, shared by every screen showing the queue.
let reader: ReturnType<typeof createPhoneHud> | undefined;
const queue = () => reader ??= createPhoneHud({
  refreshToken: process.env.POLICYTEK_REFRESH_TOKEN,
  workspaceId: process.env.POLICYTEK_WORKSPACE_ID,
});

export async function POST(request: Request) {
  return handleQueueRequest(request, {
    getUser: getAppUser,
    authorizeUser: visitor => editorAllowed(visitor, process.env.RECRUITING_EDITOR_EMAILS),
    allowedOrigin: process.env.BETTER_AUTH_URL,
    readBoard: () => queue().board(),
  });
}

export async function GET(request: Request) {
  return handleQueueRequest(request, { getUser: getAppUser, readBoard: () => Promise.reject(), allowedOrigin: process.env.BETTER_AUTH_URL });
}
