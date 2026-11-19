import { accessOverrides, adminDb, setCrmAccess } from '@/db/admin-access.mjs';
import { ADMIN_EMAILS, effectivePolicy, normalizeAccessEmail } from '@/lib/admin-policy.mjs';
import { allowedEmails } from '@/lib/auth-policy.mjs';
import { adminRequest, adminError, inputJson, json } from '../admin-auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const viewer = await adminRequest(request);
    const overrides = await accessOverrides();
    const permitted = new Set(allowedEmails(effectivePolicy(process.env, overrides).RECRUITING_EDITOR_EMAILS));
    const db = await adminDb();
    const knownUsers = (await db.query('SELECT id, name, email, "createdAt", "updatedAt" FROM "user" ORDER BY email')).rows;
    const known = new Map(knownUsers.map((user: { email: string }) => [user.email.toLowerCase(), user]));
    const emails = new Set([...permitted, ...overrides.map((row: { email: string }) => row.email), ...known.keys()]);
    const users = [...emails].sort().map(email => ({ email, allowed: permitted.has(email), administrator: ADMIN_EMAILS.includes(email), user: known.get(email) || null }));
    const audit = (await db.query('SELECT id, actor, action, target, created_at FROM crm_admin_audit ORDER BY id DESC LIMIT 100')).rows;
    return json({ viewer: viewer.email, users, audit });
  } catch (error) { return adminError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await adminRequest(request, true);
    const input = await inputJson(request);
    let email;
    try { email = normalizeAccessEmail(input.email); } catch { return json({ error: 'Enter one valid email address.' }, 400); }
    if (typeof input.allowed !== 'boolean') return json({ error: 'Choose grant or revoke.' }, 400);
    if (!input.allowed && ADMIN_EMAILS.includes(email)) return json({ error: 'The two CRM administrators cannot be removed from this dashboard.' }, 400);
    await setCrmAccess(email, input.allowed, actor.email);
    return json({ status: 'saved' });
  } catch (error) { return adminError(error); }
}
