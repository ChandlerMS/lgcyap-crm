import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger, handleRecruitWriteRequest, saveRecruit, WriteError } from '@/lib/hubspot-write.mjs';
import { createLifecycleProvider, createLifecycleStore, lifecycleEnabled, reconcileLifecycle, withLifecycleLock } from '@/lib/recruit-lifecycle-sync.mjs';
import { verifyRecruitIntakeAccess } from '@/lib/recruit-intake.mjs';

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
    saveData: async (input: Parameters<typeof saveRecruit>[0], options: { userId: string; ledger: ReturnType<typeof createPostgresLedger> }) => {
      const save = () => saveRecruit(input, { ...options, accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
      if (!lifecycleEnabled()) return save();
      // Serialize against the background job. A confirmed ticket save remains a
      // success even if the separately reported Contact sync needs attention.
      return withLifecycleLock(getPool(), async () => {
        const result = await save();
        let sync = { status: 'pending' };
        try {
          const deadline = Date.now() + 12000;
          await verifyRecruitIntakeAccess({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN, deadline });
          sync = await reconcileLifecycle(id, {
            provider: createLifecycleProvider({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN, deadline }),
            store: createLifecycleStore(getPool()),
          });
        } catch { /* Background sync will check again; do not retry the ticket save. */ }
        return { ...result, recruit: { ...result.recruit, lifecycleSync: { ...sync, checkedAt: new Date().toISOString() } } };
      }).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'syncStatus' in error && error.syncStatus === 'busy') {
          throw new WriteError('SYNC_BUSY', 'A stage sync is running. Refresh before saving again.', 409);
        }
        throw error;
      });
    },
  });
}

export const POST = handle;
export const GET = handle;
