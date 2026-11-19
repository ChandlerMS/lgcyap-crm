import { getAppUser } from '@/app/app-auth';
import { getPool } from '@/db/pool.mjs';
import { createPostgresLedger } from '@/lib/hubspot-write.mjs';
import { createQuickAction, handleQuickActionRequest } from '@/lib/recruit-quick-actions.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Quick note, Add task and Follow-up from a recruit's row on the dashboard.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ledger = process.env.DATABASE_URL ? createPostgresLedger({ query: (query: string, values: unknown[]) => getPool().query(query, values) }) : undefined;
  return handleQuickActionRequest(request, id, {
    getUser: getAppUser, ledger, allowedOrigin: process.env.BETTER_AUTH_URL,
    editorEmails: process.env.RECRUITING_EDITOR_EMAILS, writesEnabled: process.env.RECRUITING_WRITES_ENABLED,
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
    vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV,
    saveData: (recruitId: string, input: unknown, options: { user: { userId: string; email: string; displayName?: string }; ledger: ReturnType<typeof createPostgresLedger> }) => createQuickAction(recruitId, input, {
      ...options, accessToken: process.env.HUBSPOT_ACCESS_TOKEN, hmacSecret: process.env.BETTER_AUTH_SECRET,
    }),
  });
}
