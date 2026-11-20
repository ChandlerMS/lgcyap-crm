import { adminAllowed } from './admin-policy.mjs';
import { currentAccessPolicy } from './admin-access.mjs';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { getPool } from '../db/pool.mjs';
import { allowedExternalEmails, allowedPersonalEmails, approvedGoogleProfile, approvedIdentity, authSetupIssues } from './auth-policy.mjs';

let instance;

export function getAuthSetupIssues() { return authSetupIssues(process.env); }

/** Exported for synthetic integration tests and explicit schema tooling. */
export function authOptions(env, database, loadPolicy) {
  const policyFor = () => loadPolicy ? loadPolicy() : env;
  const baseURL = new URL(env.BETTER_AUTH_URL).origin;
  const personalAccounts = allowedPersonalEmails(env.RECRUITING_EDITOR_EMAILS, env.GOOGLE_PERSONAL_EMAILS);
  const externalAccounts = allowedExternalEmails(env.RECRUITING_EDITOR_EMAILS, env.GOOGLE_EXTERNAL_EMAILS, env.GOOGLE_WORKSPACE_DOMAIN);
  return {
    appName: 'Legacy Recruiting',
    baseURL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database,
    trustedOrigins: [baseURL],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        accessType: 'online',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
        includeGrantedScopes: false,
        // A global hd restriction would exclude explicitly approved outside-domain
        // exceptions. In mixed mode, enforce Workspace claims per profile below.
        ...(loadPolicy || personalAccounts.length || externalAccounts.length ? {} : { hd: env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() || '*' }),
        mapProfileToUser: (profile) => {
          const check = (policy) => {
            if (!approvedGoogleProfile(profile, { editorEmails: policy.RECRUITING_EDITOR_EMAILS, personalEmails: policy.GOOGLE_PERSONAL_EMAILS, externalEmails: policy.GOOGLE_EXTERNAL_EMAILS, workspaceDomain: policy.GOOGLE_WORKSPACE_DOMAIN })) throw new APIError('FORBIDDEN', { message: 'This account does not have access.' });
            return {};
          };
          return loadPolicy ? Promise.resolve(policyFor()).then(check) : check(env);
        },
      },
    },
    account: { accountLinking: loadPolicy ? { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false, updateUserInfoOnLink: false } : { enabled: false }, encryptOAuthTokens: true },
    ...(loadPolicy ? { user: { validateUserInfo: async ({ user, source }) => {
      if (source.action !== 'link-account') return;
      const profile = source.oauth?.profile;
      if (source.oauth?.providerId !== 'google' || !adminAllowed({ userId: user.id, email: user.email }) || user.emailVerified !== true || profile?.email_verified !== true || typeof profile.sub !== 'string') return { error: 'linking_not_allowed' };
      const bound = await database.query('SELECT id FROM "account" WHERE "userId"=$1 AND "providerId"=$2 AND "accountId"=$3', [user.id, 'google', profile.sub]);
      if (bound.rows.length !== 1) return { error: 'linking_not_allowed' };
    } } } : {}),
    session: {
      expiresIn: 8 * 60 * 60,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const policy = await policyFor();
            if (!approvedIdentity(user, policy.RECRUITING_EDITOR_EMAILS, policy.GOOGLE_PERSONAL_EMAILS, policy.GOOGLE_EXTERNAL_EMAILS, policy.GOOGLE_WORKSPACE_DOMAIN)) throw new APIError('FORBIDDEN', { message: 'This account does not have access.' });
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const user = await context?.context.internalAdapter.findUserById(session.userId);
            const policy = await policyFor();
            if (!approvedIdentity(user, policy.RECRUITING_EDITOR_EMAILS, policy.GOOGLE_PERSONAL_EMAILS, policy.GOOGLE_EXTERNAL_EMAILS, policy.GOOGLE_WORKSPACE_DOMAIN)) throw new APIError('FORBIDDEN', { message: 'This account does not have access.' });
          },
        },
      },
    },
    advanced: { useSecureCookies: baseURL.startsWith('https:') },
    logger: { disabled: true },
    plugins: [nextCookies()],
  };
}

/** No placeholder identity, credentials, or database is used during builds. */
export function getAuth() {
  if (getAuthSetupIssues().length) return null;
  instance ??= betterAuth(authOptions(process.env, getPool(), currentAccessPolicy));
  return instance;
}

/** Same-origin auth boundary; OAuth callbacks are GETs protected by library state/PKCE. */
export async function handleAuthRequest(request, { resolveAuth = getAuth, baseURL = process.env.BETTER_AUTH_URL } = {}) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  const json = (code, message, status) => Response.json({ error: { code, message } }, { status, headers });
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
  try {
    const auth = resolveAuth();
    if (!auth) return json('AUTH_NOT_CONFIGURED', 'Employee sign-in is being set up.', 503);
    const origin = new URL(baseURL).origin;
    if (new URL(request.url).origin !== origin || (request.method === 'POST' && request.headers.get('Origin') !== origin)) {
      return json('ORIGIN_NOT_ALLOWED', 'Open this app directly before signing in or out.', 403);
    }
    const response = await auth.handler(request);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Cache-Control', headers['Cache-Control']);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch { return json('AUTH_UNAVAILABLE', 'Employee sign-in is temporarily unavailable.', 503); }
}
