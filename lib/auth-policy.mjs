/** Shared server-side authorization rules. No request identity headers are trusted. */
export function allowedEmails(value) {
  return typeof value === 'string' ? [...new Set(value.split(',').map(email => email.trim().toLowerCase())
    .filter(email => !email.includes('*') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))] : [];
}

export function approvedIdentity(user, emails) {
  return Boolean(user && typeof user.email === 'string' && user.emailVerified === true
    && allowedEmails(emails).includes(user.email.trim().toLowerCase()));
}

export function sessionUser(session, emails, now = Date.now()) {
  const user = session?.user;
  const expiry = new Date(session?.session?.expiresAt ?? 0).getTime();
  if (!approvedIdentity(user, emails) || typeof user.id !== 'string' || !user.id
    || !Number.isFinite(expiry) || expiry <= now) return null;
  const email = user.email.trim().toLowerCase();
  const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null;
  return { userId: user.id, email, displayName: name ?? email, fullName: name };
}

export function authSetupIssues(env) {
  const issues = [];
  const domain = env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase();
  if (domain && domain !== '*' && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)) issues.push('GOOGLE_WORKSPACE_DOMAIN');
  if (typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.trim().length < 32) issues.push('BETTER_AUTH_SECRET');
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) issues.push(key);
  }
  if (!allowedEmails(env.RECRUITING_EDITOR_EMAILS).length) issues.push('RECRUITING_EDITOR_EMAILS');
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
  } catch { issues.push('DATABASE_URL'); }
  try {
    const url = new URL(env.BETTER_AUTH_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !env.VERCEL;
    if (url.origin !== env.BETTER_AUTH_URL || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch { issues.push('BETTER_AUTH_URL'); }
  return issues;
}

export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const url = new URL(value, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid' || ['/sign-in', '/sign-out'].includes(url.pathname)
      || url.pathname.startsWith('/api/auth')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}
