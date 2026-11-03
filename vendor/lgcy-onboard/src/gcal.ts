import type { Who } from './auth';
import { fmtEastern } from './cands';
import { GoogleError, calendarToken, connectedRows, gapi, teamReady } from './google';
import { isEmail, json, list, log, nowIso, readJson } from './http';
import { fromDated, mutate, nameOf, note, readState, type Cand } from './record';

// The team's Google Calendars (TEAM_CALENDARS, through the team approval) and each connected person's own calendar
// are read every 10 minutes into gcal_events. Events whose guests include a candidate are linked to that candidate;
// when a linked pre-screen moves in Google, the CRM follows. Invites and moves made in the CRM go to Google.
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/';
const DAY = 86_400_000;

interface GAttendee { email: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean }
interface GEvent {
  id: string; status?: string; summary?: string; location?: string; htmlLink?: string; hangoutLink?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  organizer?: { email?: string }; attendees?: GAttendee[];
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
}
interface EventRow {
  id: string; calendar: string; summary: string | null; start: string; end_at: string | null; all_day: number; meet: string | null;
  location: string | null; organizer: string | null; attendees: string; html_link: string | null; cand_id: number | null;
}

const teamCalendars = (env: Env): string[] => list(env.TEAM_CALENDARS);
const meetOf = (e: GEvent): string | null => e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
const okMail = (c: Cand): boolean => isEmail(c.email) && c.email !== 'unknown';
const why = (e: unknown): string => (e instanceof GoogleError ? e.why : String(e));

async function calendars(env: Env): Promise<string[]> {
  const own = (await connectedRows(env)).map((r) => r.google_email.toLowerCase());
  return [...new Set([...(teamReady(env) ? teamCalendars(env) : []), ...own])];
}

const toRow = (calendar: string, e: GEvent): EventRow => ({
  id: e.id, calendar, summary: e.summary ?? null, start: e.start?.dateTime || e.start?.date || '', end_at: e.end?.dateTime || e.end?.date || null,
  all_day: e.start?.date && !e.start?.dateTime ? 1 : 0, meet: meetOf(e), location: e.location ?? null, organizer: e.organizer?.email ?? null,
  attendees: JSON.stringify((e.attendees || []).map((a) => ({ email: a.email, status: a.responseStatus || 'needsAction', organizer: !!a.organizer }))),
  html_link: e.htmlLink ?? null, cand_id: null,
});

const upsert = (env: Env, r: EventRow) => env.DB.prepare('INSERT INTO onboard.gcal_events (id, calendar, summary, start, end_at, all_day, meet, location, organizer, attendees, html_link, cand_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (calendar, id) DO UPDATE SET summary = EXCLUDED.summary, start = EXCLUDED.start, end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day, meet = EXCLUDED.meet, location = EXCLUDED.location, organizer = EXCLUDED.organizer, attendees = EXCLUDED.attendees, html_link = EXCLUDED.html_link, cand_id = EXCLUDED.cand_id')
  .bind(r.id, r.calendar, r.summary, r.start, r.end_at, r.all_day, r.meet, r.location, r.organizer, r.attendees, r.html_link, r.cand_id);

// GET /api/gcal/events
export async function events(env: Env): Promise<Response> {
  const since = Date.now() - 7 * DAY;
  const rows = (await env.DB.prepare('SELECT * FROM onboard.gcal_events').all<EventRow>()).results
    .filter((r) => +new Date(r.start) >= since).sort((a, b) => +new Date(a.start) - +new Date(b.start));
  const last = await env.DB.prepare("SELECT value FROM onboard.kv WHERE key = 'gcal:lastPull'").first<{ value: string }>();
  return json({ configured: teamReady(env), calendars: await calendars(env), lastPull: last ? JSON.parse(last.value) : null, events: rows.map((r) => ({ ...r, attendees: JSON.parse(r.attendees || '[]') })) });
}

// Read every calendar, replace the stored events, link candidates. Used by POST /api/gcal/pull and the cron.
export async function pull(env: Env): Promise<{ ok: true; events: number; removed: number } | { ok: false; why: string }> {
  const cals = await calendars(env);
  if (!cals.length) return { ok: false, why: 'not_configured' };
  const timeMin = new Date(Date.now() - 14 * DAY).toISOString(); const timeMax = new Date(Date.now() + 60 * DAY).toISOString();
  const per: Record<string, number> = {}; const failed: string[] = []; const rows: EventRow[] = []; let reauth = false;
  for (const cal of cals) {
    try {
      const token = await calendarToken(env, cal); let page = ''; let n = 0;
      for (let i = 0; i < 4; i++) {
        const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(page ? { pageToken: page } : {}) });
        const d = await gapi<{ items?: GEvent[]; nextPageToken?: string }>(token, 'GET', `${CAL}${encodeURIComponent(cal)}/events?${q}`);
        for (const e of d.items || []) if (e.status !== 'cancelled') { rows.push(toRow(cal, e)); n++; }
        if (!(page = d.nextPageToken || '')) break;
      }
      per[cal] = n;
    } catch (e) { failed.push(cal); if (why(e) === 'reauthorize') reauth = true; log('gcal_read_failed', { cal, why: why(e) }); }
  }
  const read = cals.filter((c) => !failed.includes(c));
  if (!read.length) return { ok: false, why: reauth ? 'reauthorize' : 'could not read any calendar' };

  const before = (await env.DB.prepare('SELECT id, calendar FROM onboard.gcal_events').all<{ id: string; calendar: string }>()).results;
  const kept = new Set(rows.map((r) => r.calendar + '|' + r.id));
  const removed = before.filter((r) => read.includes(r.calendar) && !kept.has(r.calendar + '|' + r.id)).length;
  await link(env, rows);
  await env.DB.batch([...read.map((c) => env.DB.prepare('DELETE FROM onboard.gcal_events WHERE calendar = ?').bind(c)), ...rows.map((r) => upsert(env, r))]);
  await env.DB.prepare("INSERT INTO onboard.kv (key, value) VALUES ('gcal:lastPull', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(JSON.stringify({ at: nowIso(), per, failed, removed })).run();
  return { ok: true, events: rows.length, removed };
}

// Link events to candidates (their email is a guest, or the CRM sent it) and follow pre-screens moved in Google.
async function link(env: Env, rows: EventRow[]): Promise<void> {
  const s = await readState(env); if (!s) return;
  const byEvent = new Map(s.cands.filter((c) => c.gcal?.eventId).map((c) => [c.gcal!.eventId, c]));
  const byEmail = new Map(s.cands.filter(okMail).map((c) => [c.email.toLowerCase(), c]));
  const sessionEvents = new Set((s.sessions || []).map((x) => x.gcal?.eventId).filter(Boolean));
  const changes: { cand: number; row: EventRow; kind: 'link' | 'move' }[] = [];
  for (const r of rows) {
    if (sessionEvents.has(r.id)) continue;
    let c = byEvent.get(r.id);
    if (!c) {
      const guests = (JSON.parse(r.attendees) as { email: string }[]).map((a) => a.email.toLowerCase());
      c = guests.map((g) => byEmail.get(g)).find((x) => x && !x.gcal);
      if (c && +new Date(r.start) > Date.now() - DAY) changes.push({ cand: c.id, row: r, kind: 'link' });
    } else if (r.start && c.gcal && +new Date(r.start) !== +new Date(c.gcal.start)) changes.push({ cand: c.id, row: r, kind: 'move' });
    if (c) r.cand_id = c.id;
  }
  if (!changes.length) return;
  await mutate(env, 'system', (st) => {
    let any = false;
    for (const ch of changes) {
      const c = st.cands.find((x) => x.id === ch.cand); if (!c) continue;
      const when = new Date(ch.row.start);
      if (ch.kind === 'link' && !c.gcal) {
        c.gcal = { eventId: ch.row.id, calendar: ch.row.calendar, meet: ch.row.meet, link: ch.row.html_link || '', start: ch.row.start, by: 'System', linkedAt: nowIso() };
        note(c, 'System', 'auto', `Linked to the Google event "${ch.row.summary || 'Untitled'}" (${ch.row.calendar}). Rescheduling here now moves it too.`);
        any = true;
      } else if (ch.kind === 'move' && c.gcal && c.gcal.eventId === ch.row.id) {
        c.gcal.start = ch.row.start;
        if (c.prescreen && fromDated(c.prescreen.when)) c.prescreen.when = { $d: when.toISOString() };
        note(c, 'System', 'auto', `Pre-screen moved in Google to ${fmtEastern(when)}; the CRM follows.`);
        any = true;
      }
    }
    return any;
  });
}

export async function pullNow(env: Env): Promise<Response> {
  if (!teamReady(env) && !(await connectedRows(env)).length) return json({ ok: false, why: 'not_configured' });
  return json(await pull(env));
}

// The calendar a recruiter's invites go out from: their own connected one, else theirs through the team approval
// when it is a team calendar, else the first team calendar (same choice the CRM page shows).
async function senderCalendar(env: Env, recruiterEmail: string): Promise<string> {
  const own = await env.DB.prepare('SELECT google_email FROM onboard.google_tokens WHERE email = ?').bind(recruiterEmail).first<{ google_email: string }>();
  if (own) return own.google_email;
  const team = teamCalendars(env);
  return team.includes(recruiterEmail) ? recruiterEmail : team[0];
}

// POST /api/gcal/invite {id, summary, description, minutes, meet, start}: the pre-screen invite, sent or moved.
export async function invite(env: Env, req: Request, who: Who): Promise<Response> {
  if (!teamReady(env)) return json({ ok: false, why: 'not_configured' });
  const b = await readJson<{ id?: number; summary?: string; description?: string; minutes?: number; meet?: boolean; start?: string }>(req);
  const s = await readState(env); const c = s?.cands.find((x) => x.id === Number(b?.id));
  const start = new Date(String(b?.start || ''));
  if (!s || !c) return json({ ok: false, why: 'candidate not found' });
  if (isNaN(+start)) return json({ ok: false, why: 'no time set' });
  const end = new Date(+start + (Number(b?.minutes) || 30) * 60_000);
  const recEmail = String((s.team || []).find((t) => t.name === c.recruiter)?.email || '').toLowerCase();
  try {
    let ev: GEvent | null = null; let cal = c.gcal?.calendar || ''; let moved = false;
    if (c.gcal?.eventId) {
      try {
        ev = await gapi<GEvent>(await calendarToken(env, cal), 'PATCH', `${CAL}${encodeURIComponent(cal)}/events/${encodeURIComponent(c.gcal.eventId)}?sendUpdates=all&conferenceDataVersion=1`,
          { start: { dateTime: start.toISOString(), timeZone: 'America/New_York' }, end: { dateTime: end.toISOString(), timeZone: 'America/New_York' } });
        moved = true;
      } catch (e) { if (why(e) !== 'not_found') throw e; }
    }
    const guests = [...(okMail(c) ? [c.email] : [])];
    if (!ev) {
      cal = await senderCalendar(env, recEmail);
      guests.push(...teamCalendars(env).filter((e) => e !== cal));
      ev = await gapi<GEvent>(await calendarToken(env, cal), 'POST', `${CAL}${encodeURIComponent(cal)}/events?sendUpdates=all&conferenceDataVersion=1`, {
        summary: b?.summary || `${nameOf(c)} · Preliminary Interview`, description: b?.description || '',
        start: { dateTime: start.toISOString(), timeZone: 'America/New_York' }, end: { dateTime: end.toISOString(), timeZone: 'America/New_York' },
        attendees: guests.map((email) => ({ email })),
        ...(b?.meet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      });
    }
    const invited = (ev.attendees || []).filter((a) => !a.organizer && !a.self).map((a) => a.email);
    const evStart = ev.start?.dateTime || start.toISOString();
    await mutate(env, who.name, (st) => {
      const x = st.cands.find((y) => y.id === c.id); if (!x) return false;
      x.gcal = { eventId: ev!.id, calendar: cal, meet: meetOf(ev!), link: ev!.htmlLink || '', start: evStart, sentAt: nowIso(), by: who.name };
      note(x, who.name, 'auto', moved ? `Pre-screen invite moved to ${fmtEastern(start)} on ${cal}'s Google Calendar; Google told the guests.` : `Pre-screen invite sent from ${cal}'s Google Calendar to ${invited.join(', ') || 'the team'}${meetOf(ev!) ? ', with Google Meet' : ''}.`);
      return true;
    });
    const row = toRow(cal, ev); row.cand_id = c.id; await upsert(env, row).run();
    return json({ ok: true, moved, calendar: cal, invited, start: evStart, link: ev.htmlLink || null, meet: meetOf(ev) });
  } catch (e) { log('gcal_invite_failed', { cand: c.id, why: why(e) }); return json({ ok: false, why: why(e) }); }
}

// POST /api/gcal/move {id, start}: a pre-screen rescheduled in the CRM moves its Google event too.
export async function move(env: Env, req: Request, who: Who): Promise<Response> {
  if (!teamReady(env)) return json({ ok: false, why: 'not_configured' });
  const b = await readJson<{ id?: number; start?: string }>(req);
  const s = await readState(env); const c = s?.cands.find((x) => x.id === Number(b?.id));
  const start = new Date(String(b?.start || ''));
  if (!c || isNaN(+start)) return json({ ok: false, why: 'candidate or time not found' });
  let ref = c.gcal ? { id: c.gcal.eventId, calendar: c.gcal.calendar } : null;
  ref ||= await env.DB.prepare('SELECT id, calendar FROM onboard.gcal_events WHERE cand_id = ? ORDER BY start DESC LIMIT 1').bind(c.id).first<{ id: string; calendar: string }>();
  if (!ref) return json({ ok: true, none: true });
  try {
    const token = await calendarToken(env, ref.calendar); const url = `${CAL}${encodeURIComponent(ref.calendar)}/events/${encodeURIComponent(ref.id)}`;
    const cur = await gapi<GEvent>(token, 'GET', url);
    const mins = cur.start?.dateTime && cur.end?.dateTime ? (+new Date(cur.end.dateTime) - +new Date(cur.start.dateTime)) / 60_000 : 30;
    const ev = await gapi<GEvent>(token, 'PATCH', url + '?sendUpdates=all', { start: { dateTime: start.toISOString(), timeZone: 'America/New_York' }, end: { dateTime: new Date(+start + mins * 60_000).toISOString(), timeZone: 'America/New_York' } });
    await mutate(env, who.name, (st) => {
      const x = st.cands.find((y) => y.id === c.id); if (!x) return false;
      x.gcal = { ...(x.gcal || { eventId: ev.id, calendar: ref!.calendar, meet: meetOf(ev), link: ev.htmlLink || '', by: who.name, linkedAt: nowIso() }), start: ev.start?.dateTime || start.toISOString() };
      note(x, who.name, 'auto', `Google Calendar event moved to ${fmtEastern(start)} on ${ref!.calendar}; Google told the guests.`);
      return true;
    });
    const row = toRow(ref.calendar, ev); row.cand_id = c.id; await upsert(env, row).run();
    return json({ ok: true, calendar: ref.calendar });
  } catch (e) {
    if (why(e) === 'not_found') return json({ ok: true, none: true });
    log('gcal_move_failed', { cand: c.id, why: why(e) }); return json({ ok: false, why: why(e) });
  }
}

// POST /api/gcal/group-review {id, sessionId, when, office, team, add, summary, description, location}: one Google
// event per Group Review session on the first team calendar; candidates are guests hidden from each other.
export async function groupReview(env: Env, req: Request, who: Who): Promise<Response> {
  if (!teamReady(env)) return json({ ok: false, why: 'not_configured' });
  const b = await readJson<{ id?: number; sessionId?: number; when?: string; team?: string[]; add?: boolean; summary?: string; description?: string; location?: string }>(req);
  const s = await readState(env); const c = s?.cands.find((x) => x.id === Number(b?.id)); const sess = s?.sessions?.find((x) => x.id === Number(b?.sessionId));
  if (!c || !sess) return json({ ok: false, why: 'candidate or session not found' });
  const add = !!b?.add; const cal = sess.gcal?.calendar || teamCalendars(env)[0];
  const team = new Set([cal, ...(b?.team || []).map((e) => String(e).toLowerCase())]);
  try {
    const token = await calendarToken(env, cal); const base = `${CAL}${encodeURIComponent(cal)}/events`;
    let ev: GEvent | null = null;
    if (sess.gcal?.eventId) { try { ev = await gapi<GEvent>(token, 'GET', `${base}/${encodeURIComponent(sess.gcal.eventId)}`); } catch (e) { if (why(e) !== 'not_found') throw e; } }
    if (!ev && !add) return json({ ok: true, emailed: false, already: false, guests: 0, link: null });
    if (!ev) {
      const start = new Date(String(b?.when || fromDated(sess.when)?.toISOString()));
      ev = await gapi<GEvent>(token, 'POST', `${base}?sendUpdates=all`, {
        summary: b?.summary, description: b?.description, location: b?.location,
        start: { dateTime: start.toISOString(), timeZone: 'America/New_York' }, end: { dateTime: new Date(+start + 90 * 60_000).toISOString(), timeZone: 'America/New_York' },
        attendees: [...team].filter((e) => e !== cal).map((email) => ({ email })), guestsCanSeeOtherGuests: false, guestsCanInviteOthers: false,
      });
    }
    let attendees = ev.attendees || []; let emailed = false; let already = false;
    const has = okMail(c) && attendees.some((a) => a.email.toLowerCase() === c.email.toLowerCase());
    if (add && okMail(c) && !has) { attendees = [...attendees, { email: c.email }]; emailed = true; }
    else if (add && has) already = true;
    else if (!add && has) { attendees = attendees.filter((a) => a.email.toLowerCase() !== c.email.toLowerCase()); emailed = true; }
    if (emailed) ev = await gapi<GEvent>(token, 'PATCH', `${base}/${encodeURIComponent(ev.id)}?sendUpdates=all`, { attendees });
    const guests = (ev.attendees || []).filter((a) => !team.has(a.email.toLowerCase()) && !a.organizer && !a.resource).length;
    const link = ev.htmlLink || null; const eventId = ev.id;
    await mutate(env, who.name, (st) => {
      const x = st.cands.find((y) => y.id === c.id); const ss = st.sessions?.find((y) => y.id === sess.id); if (!x || !ss) return false;
      ss.gcal = { eventId, calendar: cal, link: link || '' };
      if (add) x.grInvite = { sessionId: ss.id, eventId, link: link || '', sentAt: nowIso(), by: who.name };
      else if (x.grInvite?.sessionId === ss.id) x.grInvite = null;
      note(x, who.name, 'auto', add ? (emailed ? `Added as a guest on the ${ss.office} Group Review Google event; Google emailed the invitation.` : 'Linked to the Group Review Google event.') : (emailed ? `Taken off the ${ss.office} Group Review Google event; Google emailed a cancellation.` : 'Was not on the Group Review Google event.'));
      return true;
    });
    return json({ ok: true, emailed, already, guests, link });
  } catch (e) { log('gcal_group_review_failed', { cand: c.id, why: why(e) }); return json({ ok: false, why: why(e) }); }
}
