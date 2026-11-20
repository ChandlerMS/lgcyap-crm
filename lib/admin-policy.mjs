import { allowedEmails } from './auth-policy.mjs';
export const CRM_AUTHORIZED = Symbol.for('lgcy.crm.server-authorized');
export const ADMIN_EMAILS = Object.freeze(['chandler@lgcyap.com', 'sarah@lgcyap.com']);
export function adminAllowed(user) { return Boolean(user?.userId && ADMIN_EMAILS.includes(user.email?.trim().toLowerCase())); }
export function normalizeAccessEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || allowedEmails(email).length !== 1 || email.includes(',')) throw new Error('Enter one valid email address.');
  return email;
}
export function effectivePolicy(env, overrides) {
  const permitted = new Set(allowedEmails(env.RECRUITING_EDITOR_EMAILS));
  for (const row of overrides) { if (row.allowed) permitted.add(row.email); else permitted.delete(row.email); }
  ADMIN_EMAILS.forEach(email => permitted.add(email));
  const grants = overrides.filter(row => row.allowed).map(row => row.email);
  return { ...env, RECRUITING_EDITOR_EMAILS: [...permitted].join(','),
    GOOGLE_PERSONAL_EMAILS: [...allowedEmails(env.GOOGLE_PERSONAL_EMAILS), ...grants.filter(email => email.endsWith('@gmail.com'))].join(','),
    GOOGLE_EXTERNAL_EMAILS: [...allowedEmails(env.GOOGLE_EXTERNAL_EMAILS), ...grants.filter(email => !email.endsWith('@gmail.com') && email.split('@')[1] !== env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase())].join(',') };
}
