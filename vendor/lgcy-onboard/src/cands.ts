import { CITIES, STAGES } from './shared.generated';
import { dated, note, type Cand, type CrmState } from './record';

export const STAGE_NAME: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.name]));

// Same rule as the CRM page: the next id is above every candidate and task id.
export function takeId(s: CrmState): number {
  const id = Math.max(s.nextId || 1, ...s.cands.map((c) => c.id + 1), ...s.tasks.map((t) => t.id + 1));
  s.nextId = id + 1;
  return id;
}

// New recruits go to the internal recruiter with the fewest uncontacted new applicants.
export function pickRecruiter(s: CrmState): string {
  const recs = (s.team || []).filter((t) => t.roles?.includes('recruiter') && t.status !== 'inactive' && !t.outside).map((t) => t.name);
  if (!recs.length) return (s.team || [])[0]?.name || '';
  const load = (n: string) => s.cands.filter((c) => c.recruiter === n && c.stage === 'applied').length;
  return recs.reduce((a, b) => (load(b) < load(a) ? b : a));
}

// Miles to the office, from the CRM's city table; 999 shows as "Out of state".
export function milesFor(city: string, state: string): number {
  const hit = (CITIES as [string, number, string][]).find(([n]) => n.toLowerCase() === city.trim().toLowerCase());
  if (hit) return hit[1];
  return state && !/^(fl|florida)$/i.test(state.trim()) ? 999 : 0;
}

export interface NewCand { first: string; last: string; email?: string; phone?: string; city?: string; state?: string; zip?: string; office?: string; source: string; job: string; license?: string; extra?: Partial<Cand> }

// A candidate shaped exactly like the ones the CRM page creates, with the first-call task it adds.
export function addCand(s: CrmState, f: NewCand, by: string, how: string): Cand {
  const id = takeId(s); const now = new Date(); const recruiter = pickRecruiter(s);
  const office = f.office === 'Miami' ? 'Miami' : 'Orlando';
  const c: Cand = {
    id, first: f.first, last: f.last, email: f.email || 'unknown', phone: f.phone || '', city: f.city || '', miles: milesFor(f.city || '', f.state || ''),
    office, source: f.source, applied: dated(now), stage: 'applied', license: f.license || 'Unlicensed', dl: true, resume: false, recruiter,
    exp: '—', avail: '—', job: f.job, notes: [], stageEntered: dated(now), prescreen: null, interview: null, appt: {}, session: null, cls: null,
    checklist: null, contracting: null, closeReason: null, flags: [], lastReached: null, zip: f.zip || '', referredBy: '', licNotes: '', ...f.extra,
  };
  note(c, by, 'status', how, now);
  s.cands.push(c);
  s.tasks.push({ id: takeId(s), cand: id, who: recruiter, what: 'First call within 1 business day', due: dated(new Date(now.getTime() + 86_400_000)), done: false, kind: 'call' });
  return c;
}

export function moveTo(c: Cand, to: string, by: string, extra = ''): void {
  const from = c.stage; if (from === to) return;
  c.stage = to; c.stageEntered = dated();
  note(c, by, 'status', `Moved from ${STAGE_NAME[from] || from} to ${STAGE_NAME[to] || to}${extra}`);
}

export const fmtEastern = (d: Date): string =>
  d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
