import { getAppUser } from '@/app/app-auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Email now opens the employee's Gmail account. Keep stale clients from reading
// the former HubSpot mailbox endpoint after the migration.
async function retired() {
  const user = await getAppUser();
  return Response.json({ error: user ? 'Email has moved to Gmail. Refresh the CRM and open Email.' : 'Sign in to use email.' }, {
    status: user ? 410 : 401,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  });
}
export const GET = retired;
export const POST = retired;
