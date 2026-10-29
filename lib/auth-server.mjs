import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { getPool } from '../db/pool.mjs';
import { approvedIdentity, authSetupIssues } from './auth-policy.mjs';

let instance;

export function getAuthSetupIssues() { return authSetupIssues(process.env); }

/** Exported for synthetic integration tests and explicit schema tooling. */
export function authOptions(env, database) {
  const baseURL = new URL(env.BETTER_AUTH_URL).origin;
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
        // Better Auth enforces this against Google's verified hd claim as well as
        // sending the hint. '*' requires a Workspace account; an exact domain
        // can tighten it further. This never replaces the explicit email list.
        hd: env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() || '*',
      },
    },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
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
            if (!approvedIdentity(user, env.RECRUITING_EDITOR_EMAILS)) throw new APIError('FORBIDDEN', { message: 'This account does not have access.' });
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const user = await context?.context.internalAdapter.findUserById(session.userId);
            if (!approvedIdentity(user, env.RECRUITING_EDITOR_EMAILS)) throw new APIError('FORBIDDEN', { message: 'This account does not have access.' });
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
  instance ??= betterAuth(authOptions(process.env, getPool()));
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
