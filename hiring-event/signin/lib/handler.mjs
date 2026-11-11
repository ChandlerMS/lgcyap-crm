import { LIMITS } from './config.mjs';
import { SignInError, createHubSpotClient, recordSignIn, verifyAccess } from './hubspot.mjs';
import { validateSignIn } from './validate.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
const PROPERTY_NAME = /^[a-z][a-z0-9_]{0,99}$/;

function reply(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function log(event, fields) {
  // Outcome codes and HubSpot IDs only. Never names, emails, phones or images.
  console.log(JSON.stringify({ event, ...fields }));
}

/** Resolves how this deployment may handle a valid sign-in. */
export function signInMode(env = process.env) {
  const production = env.VERCEL_ENV === 'production';
  if (env.SIGNIN_DRY_RUN === '1' && !production) return 'dry-run';
  if (!env.HUBSPOT_ACCESS_TOKEN) return 'not-configured';
  if (env.SIGNIN_WRITES_ENABLED !== 'true') return 'closed';
  return 'live';
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function handleSubmit(request, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const started = now();
  if (!sameOrigin(request)) return reply(403, { ok: false, code: 'FORBIDDEN' });
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) return reply(415, { ok: false, code: 'UNSUPPORTED' });
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > LIMITS.maxRequestBytes) return reply(413, { ok: false, code: 'TOO_LARGE' });

  let form;
  try { form = await request.formData(); } catch { return reply(400, { ok: false, code: 'BAD_REQUEST' }); }

  const checked = await validateSignIn(form);
  if (checked.bot) {
    log('signin_ignored', { reason: 'bot_check' });
    // Look like success so automated posts learn nothing; nothing is written.
    return reply(200, { ok: true });
  }
  if (!checked.ok) return reply(422, { ok: false, code: 'INVALID', fields: checked.errors });

  const mode = signInMode(env);
  if (mode === 'dry-run') {
    log('signin_dry_run', { files: 1, ms: now() - started });
    return reply(200, { ok: true, dryRun: true });
  }
  if (mode === 'not-configured') return reply(503, { ok: false, code: 'NOT_CONFIGURED' });
  if (mode === 'closed') return reply(503, { ok: false, code: 'CLOSED' });

  const heardAboutProperty = PROPERTY_NAME.test(env.HUBSPOT_HEARD_ABOUT_PROPERTY ?? '') ? env.HUBSPOT_HEARD_ABOUT_PROPERTY : null;
  try {
    const client = createHubSpotClient({ accessToken: env.HUBSPOT_ACCESS_TOKEN, fetchImpl, now });
    const result = await recordSignIn(client, checked.value, { now, heardAboutProperty });
    log('signin_recorded', { ...result, ms: now() - started });
    return reply(200, { ok: true });
  } catch (error) {
    if (error instanceof SignInError) {
      log('signin_failed', { code: error.code, phase: error.phase, upstreamStatus: error.upstreamStatus, ms: now() - started });
      return reply(error.status, { ok: false, code: error.code });
    }
    log('signin_failed', { code: 'INTERNAL', ms: now() - started });
    return reply(500, { ok: false, code: 'INTERNAL' });
  }
}

/**
 * Pre-event check: reports the mode and whether the HubSpot token is accepted for
 * the Legacy portal with every scope sign-in needs. It never returns secrets.
 */
export async function handleHealth({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const mode = signInMode(env);
  let hubspot = 'unchecked';
  let via;
  if (env.HUBSPOT_ACCESS_TOKEN && mode !== 'dry-run') {
    try {
      const client = createHubSpotClient({ accessToken: env.HUBSPOT_ACCESS_TOKEN, fetchImpl, now, budgetMs: 8000 });
      via = await verifyAccess(client, { now });
      hubspot = 'verified';
    } catch (error) {
      hubspot = error instanceof SignInError && error.code === 'HUBSPOT_ACCESS' ? 'access-needed' : 'unreachable';
    }
  }
  // `via` says how the token was confirmed: 'token_info' (portal and scopes) or
  // 'account_info' (portal only, for tokens the scope lookup does not recognize).
  return reply(200, { ok: mode === 'live' && hubspot === 'verified', mode, hubspot, ...(via ? { via } : {}) });
}

export function methodNotAllowed(allow) {
  return reply(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: allow });
}
