import { Buffer } from 'node:buffer';
import { addCand } from './cands';
import { GoogleError, gapi, inboxReady, inboxToken } from './google';
import { json, log, nowIso } from './http';
import { mutate, nameOf, note, type CrmState } from './record';

// The recruiting inbox (INDEED_INBOX) gets Indeed's email notices. Every 10 minutes each new "new candidate"
// notice becomes a New applicant card tagged "From inbox", and candidate messages land on that candidate's timeline.
// Indeed's email wording changes now and then: when a notice cannot be read it is counted as skipped, not guessed.
interface GPart { mimeType?: string; body?: { data?: string }; parts?: GPart[] }
interface GMessage { id: string; snippet?: string; payload?: GPart & { headers?: { name: string; value: string }[] } }

interface Notice { kind: 'applicant'; first: string; last: string; job: string; office: string; city: string; indeedId: string; indeedUrl: string }
interface Message { kind: 'message'; name: string; text: string }

export async function status(env: Env): Promise<Response> {
  if (!inboxReady(env)) return json({ configured: false, lastAt: null, handled: 0 });
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(handled_at) AS last FROM onboard.indeed_seen WHERE result != 'skipped'").first<{ n: number; last: string | null }>();
  return json({ configured: true, lastAt: r?.last ?? null, handled: r?.n ?? 0 });
}

const textOf = (p: GPart | undefined, type: string): string => {
  if (!p) return '';
  if (p.mimeType === type && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
  for (const q of p.parts || []) { const t = textOf(q, type); if (t) return t; }
  return '';
};
const plain = (h: string): string => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<(br|\/p|\/div|\/tr|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ');

export function parse(subject: string, body: string): Notice | Message | null {
  const link = body.match(/https:\/\/employers\.indeed\.com\/[^\s"'<>]*?(?:[?&](?:id|candidateId)=)([A-Za-z0-9_-]+)[^\s"'<>]*/);
  const msg = subject.match(/^(?:new message from|message from)\s+(.+?)$/i) || subject.match(/^(.+?)\s+(?:sent you a message|replied|responded)/i);
  if (msg) {
    const text = (body.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 20 && !/indeed|unsubscribe|view message|reply/i.test(l))[0] || '').slice(0, 600);
    return { kind: 'message', name: msg[1].trim(), text };
  }
  const app = subject.match(/^(?:new (?:application|applicant|candidate)s?(?: for)?:?\s*)(.+?)\s+[-–|]\s+(.+)$/i)
    || subject.match(/^(.+?)\s+applied (?:to|for)\s+(?:your job\s+)?(.+)$/i);
  if (!app) return null;
  // The two subject shapes put name and job in either order; the job is the part that names the role.
  const [a, b] = [app[1].trim(), app[2].trim().replace(/^["“]|["”]$/g, '')];
  const roleFirst = /insurance|sales|agent|executive|representative|associate/i.test(a);
  const name = roleFirst ? b : a; const job = roleFirst ? a : b;
  const [first, ...rest] = name.split(/\s+/);
  if (!first || /indeed/i.test(name)) return null;
  const office = /miami/i.test(job + ' ' + body) && !/orlando/i.test(job) ? 'Miami' : 'Orlando';
  const city = (body.match(/(?:Location|Lives in)\s*[:·]?\s*([A-Za-z .'-]+?),\s*[A-Z]{2}\b/) || [])[1] || '';
  return { kind: 'applicant', first, last: rest.join(' '), job, office, city: city.trim(), indeedId: link?.[1] || '', indeedUrl: link?.[0] || '' };
}

// Read new notices. Used by POST /api/indeed/pull and the cron.
export async function pull(env: Env): Promise<{ ok: true; seen: number; created: number; notes: number; skipped: number } | { ok: false; why: string }> {
  if (!inboxReady(env)) return { ok: false, why: 'not_configured' };
  let token: string;
  try { token = await inboxToken(env); } catch (e) { return { ok: false, why: e instanceof GoogleError ? e.why : String(e) }; }
  const listed = await gapi<{ messages?: { id: string }[] }>(token, 'GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages?' + new URLSearchParams({ q: 'from:indeed.com newer_than:14d', maxResults: '50' }));
  const ids = (listed.messages || []).map((m) => m.id);
  const done = new Set(ids.length ? (await env.DB.prepare(`SELECT message_id FROM onboard.indeed_seen WHERE message_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ message_id: string }>()).results.map((r) => r.message_id) : []);
  const fresh = ids.filter((id) => !done.has(id));
  const parsed: { id: string; n: Notice | Message | null }[] = [];
  for (const id of fresh) {
    const m = await gapi<GMessage>(token, 'GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    const subject = m.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value || '';
    const body = textOf(m.payload, 'text/plain') || plain(textOf(m.payload, 'text/html')) || m.snippet || '';
    parsed.push({ id, n: parse(subject, body) });
  }
  const result: Record<string, string> = {}; let created = 0; let notes = 0;
  if (parsed.some((p) => p.n)) {
    await mutate(env, 'Indeed inbox', (s: CrmState) => {
      created = 0; notes = 0;
      for (const { id, n } of parsed) {
        result[id] = 'skipped';
        if (!n) continue;
        if (n.kind === 'message') {
          const c = s.cands.find((x) => nameOf(x).toLowerCase() === n.name.toLowerCase());
          if (c) { note(c, 'Indeed', 'note', `Message on Indeed: ${n.text || '(open it on Indeed)'}`); result[id] = 'note'; notes++; }
          continue;
        }
        const dup = s.cands.find((x) => (n.indeedId && x.indeedId === n.indeedId) || (nameOf(x).toLowerCase() === `${n.first} ${n.last}`.trim().toLowerCase() && x.job === n.job));
        if (dup) continue;
        const c = addCand(s, { first: n.first, last: n.last, city: n.city, office: n.office, source: 'Indeed', job: n.job, extra: n.indeedId ? { indeedId: n.indeedId, indeedUrl: n.indeedUrl } : {} }, 'System', `Applied via Indeed · ${n.job}`);
        c.flags = ['From inbox']; result[id] = 'created'; created++;
      }
      return created + notes > 0;
    });
  }
  const at = nowIso();
  if (fresh.length) await env.DB.batch(fresh.map((id) => env.DB.prepare('INSERT INTO onboard.indeed_seen (message_id, handled_at, result) VALUES (?, ?, ?) ON CONFLICT (message_id) DO UPDATE SET handled_at = EXCLUDED.handled_at, result = EXCLUDED.result').bind(id, at, result[id] || 'skipped')));
  log('indeed_pull', { seen: fresh.length, created, notes });
  return { ok: true, seen: fresh.length, created, notes, skipped: fresh.length - created - notes };
}

export async function pullNow(env: Env): Promise<Response> {
  try { return json(await pull(env)); } catch (e) { return json({ ok: false, why: e instanceof GoogleError ? e.why : String(e) }); }
}
