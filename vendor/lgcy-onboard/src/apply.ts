import type { Who } from './auth';
import { addCand, moveTo } from './cands';
import FORM from './form.json';
import { GoogleError } from './google';
import { html, isEmail, json, log, nowIso, randomToken, readJson } from './http';
import { fromTemplate, isTestAddress, mailReady, sendMail } from './mail';
import APPLY_HTML from './pages/apply.html';
import { mutate, nameOf, note, readState, type Cand } from './record';

// The Legacy Agent Application: a public page at /apply (or /apply/<token>, prefilled from the candidate the link
// was sent to). Essentials that fail close the card with the disqualification email, recruiter in copy.
interface Item { id: string; label: string; type: string; req?: boolean; essential?: string; fail?: string; review?: string }
interface Section { id: string; title: string; part2?: boolean; items: Item[] }
const SECTIONS = FORM as Section[];
const ITEMS = SECTIONS.flatMap((s) => s.items);

const forScript = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

async function candFor(env: Env, token: string): Promise<Cand | null> {
  if (!token) return null;
  const t = await env.DB.prepare('SELECT cand_id FROM onboard.apply_tokens WHERE token = ?').bind(token).first<{ cand_id: number }>();
  if (!t) return null;
  const s = await readState(env);
  return s?.cands.find((c) => c.id === t.cand_id) ?? null;
}

export async function applyPage(env: Env, token: string): Promise<Response> {
  const c = await candFor(env, token);
  const prefill: Record<string, string> = {};
  if (c) {
    prefill.legalName = nameOf(c);
    if (isEmail(c.email)) prefill.email = c.email;
    if (c.phone) prefill.phone = String(c.phone);
    if (c.city) prefill.city = String(c.city);
    if (c.zip) prefill.zip = String(c.zip);
    if (c.office === 'Orlando' || c.office === 'Miami') prefill.office = c.office;
  }
  return html(APPLY_HTML.replace('__FORM__', () => forScript(SECTIONS)).replace('__PREFILL__', () => forScript(prefill)).replace('__TOKEN__', () => forScript(token)));
}

// Same rule as the CRM's evaluateApplication.
export function evaluate(a: Record<string, string>): { pass: boolean; failed: string[]; review: string[] } {
  const failed = ITEMS.filter((i) => i.essential && (a[i.id] || '') !== i.essential).map((i) => i.fail || i.label);
  const review = ITEMS.filter((i) => i.review && (a[i.id] || '') === i.review).map((i) => i.label);
  return { pass: !failed.length, failed, review };
}

const licenseOf = (s: string): string => (/florida/i.test(s) ? 'Licensed (FL)' : /another state/i.test(s) ? 'Licensed (other state)' : /studying/i.test(s) ? 'Studying' : 'Unlicensed');

// POST /api/apply {token, answers, website}. `website` is a hidden field only robots fill in.
export async function submitApplication(env: Env, req: Request): Promise<Response> {
  const b = await readJson<{ token?: string; answers?: Record<string, unknown>; website?: string }>(req, 128 * 1024);
  if (!b || typeof b.answers !== 'object' || !b.answers) return json({ ok: false, why: 'Could not read the form' });
  if (b.website) { log('apply_honeypot'); return json({ ok: true, pass: true }); }
  const a: Record<string, string> = {};
  for (const it of ITEMS) { const v = b.answers[it.id]; if (v !== undefined && v !== null && v !== '') a[it.id] = String(v).slice(0, 5000); }
  if (!isEmail(a.email) || !a.legalName) return json({ ok: false, why: 'Name and email are required' });
  const { pass, failed, review } = evaluate(a);
  const token = String(b.token || '');
  const linked = token ? await env.DB.prepare('SELECT cand_id FROM onboard.apply_tokens WHERE token = ?').bind(token).first<{ cand_id: number }>() : null;

  const out = await mutate(env, 'application', (s) => {
    let c = linked ? s.cands.find((x) => x.id === linked.cand_id) : undefined;
    c ||= s.cands.find((x) => isEmail(x.email) && x.email.toLowerCase() === a.email.toLowerCase());
    if (!c) {
      const [first, ...rest] = (a.preferred || a.legalName).trim().split(/\s+/);
      const last = a.preferred ? a.legalName.trim().split(/\s+/).slice(1).join(' ') : rest.join(' ');
      c = addCand(s, { first, last, email: a.email, phone: a.phone, city: a.city, state: a.state, zip: a.zip, office: a.office, source: 'Website', job: `Inbound Life Insurance Sales Executive (${a.office === 'Miami' ? 'Miami' : 'Orlando'})`, license: licenseOf(a.licenseStatus || '') }, 'System', `Applied on the website · Legacy Agent Application`);
    }
    if (!isEmail(c.email)) c.email = a.email;
    if (!c.phone && a.phone) c.phone = a.phone;
    if (!c.zip && a.zip) c.zip = a.zip;
    c.application = { answers: a, pass, failed, review, submittedAt: nowIso(), signature: a.signature || '' };
    note(c, 'System', 'auto', pass
      ? `Legacy application received: passed the essentials${review.length ? `; ${review.length} answer${review.length === 1 ? '' : 's'} to discuss privately` : ''}.`
      : `Legacy application received: did not meet requirements (${failed.join('; ')}).`);
    if (!pass && c.stage !== 'closed') {
      c.closeReason = 'Did not meet requirements'; moveTo(c, 'closed', 'System', ' · Reason: Did not meet requirements');
      s.tasks.forEach((t) => { if (t.cand === c!.id) t.done = true; });
    }
    else if (pass && c.stage === 'application') moveTo(c, 'invited', 'System', ' · Passed the web application');
    const rec = (s.team || []).find((t) => t.name === c!.recruiter);
    return { id: c.id, first: c.first, recruiter: c.recruiter, recruiterEmail: rec?.email || '' };
  });
  if (!out) return json({ ok: false, why: 'Applications are not open yet' });

  if (mailReady(env) && !isTestAddress(a.email)) {
    const first = (a.preferred || a.legalName).trim().split(/\s+/)[0];
    const t = pass ? fromTemplate('received', { first, recruiter: out.recruiter }) : fromTemplate('disqualified', { first, recruiter: out.recruiter, requirement: failed.join('; ') });
    try {
      await sendMail(env, { to: [a.email], replyTo: out.recruiterEmail || undefined, cc: !pass && out.recruiterEmail ? [out.recruiterEmail] : undefined, ...t });
    } catch (e) { log('apply_mail_failed', { cand: out.id, why: e instanceof GoogleError ? e.why : String(e) }); }
  }
  log('application', { cand: out.id, pass });
  return json({ ok: true, pass, failed, recruiter: out.recruiter });
}

// POST /api/apply/send {id}: email the candidate their prefilled application link.
export async function sendApplication(env: Env, req: Request, who: Who): Promise<Response> {
  const b = await readJson<{ id?: number }>(req);
  const s = await readState(env);
  const c = s?.cands.find((x) => x.id === Number(b?.id));
  if (!c) return json({ sent: false, why: 'candidate not found' });
  if (!isEmail(c.email)) return json({ sent: false, why: 'no email on file' });
  if (!mailReady(env)) return json({ sent: false, why: 'not_configured' });
  let token = (await env.DB.prepare('SELECT token FROM onboard.apply_tokens WHERE cand_id = ? LIMIT 1').bind(c.id).first<{ token: string }>())?.token;
  if (!token) { token = randomToken(18); await env.DB.prepare('INSERT INTO onboard.apply_tokens (token, cand_id, created_at) VALUES (?, ?, ?)').bind(token, c.id, Date.now()).run(); }
  const link = new URL(req.url).origin + '/apply/' + token;
  const skipped = isTestAddress(c.email);
  if (!skipped) {
    try { await sendMail(env, { to: [c.email], replyTo: who.email, ...fromTemplate('apply', { first: c.first, recruiter: who.name }, link) }); }
    catch (e) { return json({ sent: false, why: e instanceof GoogleError ? e.why : 'send failed' }); }
  }
  await mutate(env, who.name, (st) => {
    const x = st.cands.find((y) => y.id === c.id); if (!x) return false;
    x.applicationSentAt = nowIso(); x.applicationSentBy = who.name;
    note(x, who.name, 'auto', `Legacy application link emailed to ${x.email}${skipped ? ' (test address, not actually emailed)' : ''}.`);
    return true;
  });
  return json({ sent: true, skipped });
}
