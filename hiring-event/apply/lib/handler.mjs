import { evaluateApplication } from '../public/rules.js';
import { LIMITS } from './config.mjs';
import { ApplyError, createHubSpotClient, recordApplication, verifyAccess } from './hubspot.mjs';
import { validateApplication } from './validate.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };

export function reply(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function log(event, fields) {
  // Outcome codes and HubSpot IDs only. Never names, contact details, answers or images.
  console.log(JSON.stringify({ event, ...fields }));
}

/**
 * How this deployment handles a valid application:
 * dry-run (local or Preview testing only), not-configured, closed (kill switch off) or live.
 */
export function applyMode(env = process.env) {
  if (env.APPLY_DRY_RUN === '1' && env.VERCEL_ENV !== 'production') return 'dry-run';
  if (!env.HUBSPOT_ACCESS_TOKEN) return 'not-configured';
  if (env.APPLY_WRITES_ENABLED !== 'true') return 'closed';
  return 'live';
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

/** What the applicant sees after a valid submission, from the same rules Onboard uses. */
function outcomeBody(evaluation, extra = {}) {
  return { ok: true, pass: evaluation.pass, failed: evaluation.pass ? [] : evaluation.failed, ...extra };
}

export async function handleSubmit(request, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const started = now();
  if (!sameOrigin(request)) return reply(403, { ok: false, code: 'FORBIDDEN' });
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) return reply(415, { ok: false, code: 'UNSUPPORTED' });
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > LIMITS.maxRequestBytes) return reply(413, { ok: false, code: 'TOO_LARGE' });

  let form;
  try { form = await request.formData(); } catch { return reply(400, { ok: false, code: 'BAD_REQUEST' }); }

  const checked = await validateApplication(form);
  if (checked.bot) {
    log('apply_ignored', { reason: 'bot_check' });
    // Look like success so automated posts learn nothing; nothing is written.
    return reply(200, { ok: true, pass: true, failed: [] });
  }
  if (!checked.ok) return reply(422, { ok: false, code: 'INVALID', fields: checked.errors });

  const evaluation = evaluateApplication(checked.answers);
  const mode = applyMode(env);
  if (mode === 'dry-run') {
    log('apply_dry_run', { pass: evaluation.pass, review: evaluation.review.length, ms: now() - started });
    return reply(200, outcomeBody(evaluation, { dryRun: true }));
  }
  if (mode === 'not-configured') return reply(503, { ok: false, code: 'NOT_CONFIGURED' });
  if (mode === 'closed') return reply(503, { ok: false, code: 'CLOSED' });

  try {
    const client = createHubSpotClient({ accessToken: env.HUBSPOT_ACCESS_TOKEN, fetchImpl, now });
    const result = await recordApplication(client, checked, evaluation, { now });
    log('apply_recorded', { ...result, pass: evaluation.pass, ms: now() - started });
    return reply(200, outcomeBody(evaluation));
  } catch (error) {
    if (error instanceof ApplyError) {
      log('apply_failed', { code: error.code, phase: error.phase, upstreamStatus: error.upstreamStatus, ms: now() - started });
      return reply(error.status, { ok: false, code: error.code });
    }
    log('apply_failed', { code: 'INTERNAL', ms: now() - started });
    return reply(500, { ok: false, code: 'INTERNAL' });
  }
}

/** Setup check for staff: mode plus whether HubSpot accepts the token. Never returns secrets. */
export async function handleHealth({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const mode = applyMode(env);
  let hubspot = 'not_checked';
  if (mode === 'live' || mode === 'closed') {
    try {
      await verifyAccess(createHubSpotClient({ accessToken: env.HUBSPOT_ACCESS_TOKEN, fetchImpl, now, budgetMs: 8000 }), { now, cache: false });
      hubspot = 'ok';
    } catch (error) {
      hubspot = error instanceof ApplyError && error.code === 'HUBSPOT_ACCESS' ? 'access_problem' : 'unreachable';
    }
  }
  return reply(200, { ok: mode === 'live' && hubspot === 'ok', mode, hubspot });
}
