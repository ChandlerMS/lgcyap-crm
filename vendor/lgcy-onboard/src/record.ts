import { TEAM } from './shared.generated';
import { json, log, nowIso } from './http';

// The CRM page stores dates as { $d: ISO string } so they come back as Date objects (see its ser/rev).
export type Dated = { $d: string };
export const dated = (d: Date = new Date()): Dated => ({ $d: d.toISOString() });
export const fromDated = (v: unknown): Date | null => {
  const s = v && typeof v === 'object' && typeof (v as Dated).$d === 'string' ? (v as Dated).$d : typeof v === 'string' ? v : null;
  const d = s ? new Date(s) : null;
  return d && !isNaN(+d) ? d : null;
};

export interface Note { at: Dated; by: string; kind: string; text: string }
export interface Cand {
  id: number; first: string; last: string; email: string; phone: string; stage: string; recruiter: string;
  office?: string; city?: string; zip?: string; notes: Note[]; flags?: string[];
  prescreen?: { when?: Dated; [k: string]: unknown } | null;
  gcal?: { eventId: string; calendar: string; meet: string | null; link: string; start: string; sentAt?: string; by: string; linkedAt?: string } | null;
  grInvite?: { sessionId: number; eventId: string; link: string; sentAt: string; by: string } | null;
  application?: unknown; applicationSentAt?: string; applicationSentBy?: string;
  indeedId?: string; [k: string]: unknown;
}
export interface Member {
  name: string; email?: string; status?: string; roles: string[]; access: string[]; super?: boolean; outside?: boolean;
  role?: string; ini?: string; color?: string; invitedAt?: string; invitedBy?: string; firstSignIn?: string; lastSignIn?: string;
  [k: string]: unknown;
}
export interface Session { id: number; when: Dated; office: string; lead?: string; leads?: string[]; roster: number[]; cap?: number; gcal?: { eventId: string; calendar: string; link: string }; [k: string]: unknown }
export interface Task { id: number; cand: number; who: string; what: string; due: Dated; done: boolean; kind: string }
export interface CrmState {
  v: 1; savedAt?: Dated; nextId?: number; cands: Cand[]; tasks: Task[]; sessions?: Session[]; classes?: unknown[];
  team?: Member[]; rules?: unknown; [k: string]: unknown;
}
interface Row { version: number; updated_at: string | null; updated_by: string | null; state: string | null }

// Vercel refuses request bodies over 4.5 MB before they reach the app; stopping at 4 MB gives the page a clear error.
export const RECORD_MAX = 4 * 1024 * 1024;

const readRow = (env: Env) => env.DB.prepare('SELECT version, updated_at, updated_by, state FROM onboard.record WHERE id = 1').first<Row>();

// GET /api/state: the record as stored, without parsing it.
export async function getState(env: Env): Promise<Response> {
  const r = await readRow(env);
  const head = JSON.stringify({ version: r?.version ?? 0, updated_at: r?.updated_at ?? null, updated_by: r?.updated_by ?? null });
  return new Response(head.slice(0, -1) + ',"state":' + (r?.state || 'null') + '}', { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function getVersion(env: Env): Promise<Response> {
  const r = await env.DB.prepare('SELECT version, updated_at, updated_by FROM onboard.record WHERE id = 1').first<Omit<Row, 'state'>>();
  return json({ version: r?.version ?? 0, updated_at: r?.updated_at ?? null, updated_by: r?.updated_by ?? null });
}

const valid = (s: unknown): s is CrmState => !!s && typeof s === 'object' && (s as CrmState).v === 1 && Array.isArray((s as CrmState).cands) && Array.isArray((s as CrmState).tasks);

// Write a new version only if nobody saved since `from`. Returns the new version, or null on a conflict.
async function write(env: Env, from: number, text: string, by: string, team: Member[] | undefined): Promise<number | null> {
  const r = await env.DB.prepare('UPDATE onboard.record SET version = version + 1, state = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ?')
    .bind(text, nowIso(), by, from).run();
  if (!r.meta.changes) return null;
  if (team) await syncMembers(env, team);
  return from + 1;
}

// PUT /api/state from the CRM page, with If-Match: <version it started from>.
export async function putState(env: Env, req: Request, by: string): Promise<Response> {
  const tag = req.headers.get('if-match'); const from = Number(tag);
  if (!tag || !Number.isInteger(from) || from < 0) return json({ error: 'if_match' }, 428);
  const text = await req.text();
  if (text.length > RECORD_MAX) return json({ error: 'too_large' }, 413);
  let s: unknown;
  try { s = JSON.parse(text); } catch { return json({ error: 'bad_json' }, 400); }
  if (!valid(s)) return json({ error: 'not_a_record' }, 400);
  const version = await write(env, from, text, by, s.team);
  if (version === null) {
    const cur = await readRow(env);
    return json({ error: 'conflict', version: cur?.version ?? 0, updated_by: cur?.updated_by ?? null }, 409);
  }
  return json({ ok: true, version });
}

// Server-side edits (sign-ins, invites sent, applications, calendar links): read, change, write, retry if someone
// saved in between. `fn` returns false to skip writing. Returns undefined when there is no record yet.
export async function mutate<T>(env: Env, by: string, fn: (s: CrmState) => T | false | Promise<T | false>): Promise<T | false | undefined> {
  for (let i = 0; i < 6; i++) {
    const r = await readRow(env);
    if (!r || !r.state) return undefined;
    const s = JSON.parse(r.state) as CrmState;
    const out = await fn(s);
    if (out === false) return false;
    if (await write(env, r.version, JSON.stringify(s), by, s.team) !== null) return out;
    await new Promise((res) => setTimeout(res, 40 * (i + 1)));
  }
  log('mutate_gave_up', { by });
  throw new Error('busy');
}

export async function readState(env: Env): Promise<CrmState | null> {
  const r = await readRow(env);
  return r && r.state ? (JSON.parse(r.state) as CrmState) : null;
}

// Who may sign in comes from the record's Users list; before the first save, the CRM's built-in team.
async function syncMembers(env: Env, team: Member[]): Promise<void> {
  const rows = team.filter((m) => m.email).map((m) => env.DB.prepare('INSERT INTO onboard.members (email, name, status, data) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, data = EXCLUDED.data')
    .bind(String(m.email).toLowerCase(), m.name, m.status || null, JSON.stringify(m)));
  await env.DB.batch([env.DB.prepare('DELETE FROM onboard.members'), ...rows]);
}

export async function findMember(env: Env, email: string): Promise<Member | null> {
  const any = await env.DB.prepare('SELECT COUNT(*) AS n FROM onboard.members').first<{ n: number }>();
  if (any && any.n > 0) {
    const r = await env.DB.prepare('SELECT data FROM onboard.members WHERE email = ?').bind(email).first<{ data: string }>();
    return r ? (JSON.parse(r.data) as Member) : null;
  }
  return (TEAM as Member[]).find((m) => String(m.email || '').toLowerCase() === email) ?? null;
}

export const note = (c: Cand, by: string, kind: string, text: string, at = new Date()): void => {
  (c.notes ||= []).push({ at: dated(at), by, kind, text });
};

export const nameOf = (c: Pick<Cand, 'first' | 'last'>): string => `${c.first || ''} ${c.last || ''}`.trim();
