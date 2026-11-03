import { GoogleError } from './google';
import { esc, isEmail, json, list, log, nowIso, randomToken, readCookie, readJson, sameSecret, sha256 } from './http';
import { button, mailReady, sendMail } from './mail';
import { findMember, mutate, type Member } from './record';

// Sign-in is by email code: the page asks for a work email, the Worker emails a 6-digit code good for 10 minutes,
// and a correct code sets a session cookie. Who may sign in is the CRM's Users list (minus anyone marked Inactive),
// plus OWNER_EMAILS.
const COOKIE = 'lgcy_session';
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const RESEND_MS = 30_000;
const CODES_PER_HOUR = 5;

export interface Who { email: string; name: string; member: Member | null; owner: boolean; admin: boolean }

async function allowed(env: Env, email: string): Promise<Who | null> {
  const m = await findMember(env, email);
  const listed = list(env.OWNER_EMAILS).includes(email);
  if (!m && !listed) return null;
  if (m && m.status === 'inactive' && !listed) return null;
  const owner = listed || !!m?.super;
  return { email, member: m, owner, admin: owner || !!m?.access?.includes('admin'), name: m?.name || nameFromEmail(email) };
}

const nameFromEmail = (e: string): string => e.split('@')[0].split(/[._-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export async function signedIn(env: Env, req: Request): Promise<Who | null> {
  const tok = readCookie(req, COOKIE);
  if (!tok) return null;
  const row = await env.DB.prepare('SELECT email, expires_at FROM onboard.sessions WHERE id = ?').bind(await sha256(tok)).first<{ email: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return allowed(env, row.email);
}

function sixDigits(): string {
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= 4_294_000_000); // drop the uneven tail so every code is equally likely
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

export async function loginStart(env: Env, req: Request): Promise<Response> {
  const b = await readJson<{ email?: string }>(req);
  const email = String(b?.email || '').trim().toLowerCase();
  if (!isEmail(email)) return json({ ok: false, why: 'email' });
  const dev = env.DEV_LOGIN_CODES === '1';
  if (!mailReady(env) && !dev) return json({ ok: false, why: 'mail_not_configured' });
  // The answer is the same whether or not the email is on the team, so the page never reveals who is.
  if (!(await allowed(env, email))) { log('login_not_on_team', { email }); return json({ ok: true }); }

  const now = Date.now();
  const prev = await env.DB.prepare('SELECT sent_at, window_start, window_count FROM onboard.login_codes WHERE email = ?').bind(email).first<{ sent_at: number; window_start: number; window_count: number }>();
  const inWindow = !!prev && now - prev.window_start < 3_600_000;
  if (prev && (now - prev.sent_at < RESEND_MS || (inWindow && prev.window_count >= CODES_PER_HOUR))) return json({ ok: false, why: 'slow' });

  const code = sixDigits(); const salt = randomToken(16);
  await env.DB.prepare('INSERT INTO onboard.login_codes (email, code_hash, salt, expires_at, tries, sent_at, window_start, window_count) VALUES (?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, salt = EXCLUDED.salt, expires_at = EXCLUDED.expires_at, tries = EXCLUDED.tries, sent_at = EXCLUDED.sent_at, window_start = EXCLUDED.window_start, window_count = EXCLUDED.window_count')
    .bind(email, await sha256(salt + code), salt, now + CODE_MINUTES * 60_000, now, inWindow ? prev!.window_start : now, inWindow ? prev!.window_count + 1 : 1).run();

  if (!mailReady(env)) { log('dev_login_code', { email, code }); return json({ ok: true }); }
  try {
    await sendMail(env, {
      to: [email], subject: `${code} is your LGCY Onboard code`,
      html: `<h2 style="margin:0 0 12px;font:600 20px/1.3 Arial,sans-serif;color:#1d1503">Your sign-in code</h2><p style="font:700 30px/1 Arial,sans-serif;letter-spacing:.3em;margin:18px 0;color:#1d1503">${code}</p><p>Enter it on the LGCY Onboard sign-in page. It works for ${CODE_MINUTES} minutes.</p><p style="color:#8a8577;font-size:13px">If you did not ask to sign in, you can ignore this email.</p>`,
    });
  } catch (e) {
    log('login_mail_failed', { email, why: e instanceof GoogleError ? e.why : String(e) });
    await env.DB.prepare('DELETE FROM onboard.login_codes WHERE email = ?').bind(email).run();
    return json({ ok: false, why: e instanceof GoogleError && (e.why === 'not_configured' || e.why === 'reauthorize') ? 'mail_not_configured' : 'send' });
  }
  return json({ ok: true });
}

export async function loginVerify(env: Env, req: Request): Promise<Response> {
  const b = await readJson<{ email?: string; code?: string }>(req);
  const email = String(b?.email || '').trim().toLowerCase(); const code = String(b?.code || '').replace(/\D/g, '');
  const row = await env.DB.prepare('SELECT code_hash, salt, expires_at, tries FROM onboard.login_codes WHERE email = ?').bind(email).first<{ code_hash: string; salt: string; expires_at: number; tries: number }>();
  if (!row || row.expires_at < Date.now()) return json({ ok: false, why: 'expired' });
  if (row.tries >= MAX_TRIES) return json({ ok: false, why: 'tries' });
  if (code.length !== 6 || !(await sameSecret(await sha256(row.salt + code), row.code_hash))) {
    await env.DB.prepare('UPDATE onboard.login_codes SET tries = tries + 1 WHERE email = ?').bind(email).run();
    return json({ ok: false, why: row.tries + 1 >= MAX_TRIES ? 'tries' : 'wrong' });
  }
  await env.DB.prepare('DELETE FROM onboard.login_codes WHERE email = ?').bind(email).run();
  if (!(await allowed(env, email))) return json({ ok: false, why: 'expired' });

  const token = randomToken(32); const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM onboard.sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO onboard.sessions (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), email, now, now + SESSION_DAYS * 86_400_000),
  ]);
  // The Users list shows who has signed in: first and last sign-in, and Invited becomes Active.
  try {
    await mutate(env, 'system', (s) => {
      const m = (s.team || []).find((t) => String(t.email || '').toLowerCase() === email);
      if (!m) return false;
      const at = nowIso(); m.firstSignIn ||= at; m.lastSignIn = at; if (!m.status || m.status === 'invited') m.status = 'active';
      return true;
    });
  } catch (e) { log('sign_in_not_recorded', { email, error: String(e) }); }
  log('signed_in', { email });
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}` });
}

export async function logout(env: Env, req: Request): Promise<Response> {
  const tok = readCookie(req, COOKIE);
  if (tok) await env.DB.prepare('DELETE FROM onboard.sessions WHERE id = ?').bind(await sha256(tok)).run();
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
}

export async function me(env: Env, who: Who): Promise<Response> {
  const v = await env.DB.prepare('SELECT version FROM onboard.record WHERE id = 1').first<{ version: number }>();
  const user: Record<string, unknown> = who.member ? { ...who.member, email: who.email } : { name: who.name, email: who.email };
  if (who.owner) user.owner = true;
  return json({ email: who.email, user, version: v?.version ?? 0, sender: env.MAIL_FROM });
}

// POST /api/invite {email}: emails a person on the Users list the link and how to sign in, from the agency sender
// with the inviter on Reply-To. The page adds the person and saves a moment later, so wait for that save.
export async function invite(env: Env, req: Request, who: Who): Promise<Response> {
  if (!who.admin) return json({ sent: false, why: 'admins only' }, 403);
  const b = await readJson<{ email?: string }>(req);
  const email = String(b?.email || '').trim().toLowerCase();
  if (!isEmail(email)) return json({ sent: false, why: 'that is not an email address' });
  if (!mailReady(env)) return json({ sent: false, why: 'not_configured' });
  let m: Member | null = null;
  for (let i = 0; i < 20 && !(m = await findMember(env, email)); i++) await new Promise((r) => setTimeout(r, 250));
  if (!m) return json({ sent: false, why: 'they are not on the Users list yet' });
  const origin = new URL(req.url).origin; const first = m.name.split(' ')[0];
  try {
    await sendMail(env, {
      to: [email], replyTo: who.email, subject: `${who.name} invited you to LGCY Onboard`,
      html: `<h2 style="margin:0 0 12px;font:600 20px/1.3 Arial,sans-serif;color:#1d1503">Welcome to LGCY Onboard, ${esc(first)}.</h2><p>${esc(who.name)} added you to LGCY Onboard, Legacy Agency Partners' recruiting CRM.</p>${button(origin + '/', 'Open LGCY Onboard')}<p>Sign in with this email address, <b>${esc(email)}</b>. Each time, we email you a 6-digit code; there is no password.</p><p style="color:#8a8577;font-size:13px">Questions? Reply to this email and it reaches ${esc(who.name)}.</p>`,
    });
  } catch (e) {
    log('invite_failed', { email, why: e instanceof GoogleError ? e.why : String(e) });
    return json({ sent: false, why: e instanceof GoogleError ? e.why : 'send failed' });
  }
  await mutate(env, who.name, (s) => {
    const t = (s.team || []).find((x) => String(x.email || '').toLowerCase() === email);
    if (!t) return false;
    t.invitedAt = nowIso(); t.invitedBy = who.name; if (!t.firstSignIn && t.status !== 'inactive') t.status = 'invited';
    return true;
  });
  return json({ sent: true, from: env.MAIL_FROM });
}
