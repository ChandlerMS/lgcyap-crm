import { followUpRecruits } from './recruit-follow-up.mjs';
import { hubspotHref } from './recruit-task-chips.mjs';

const ZONE = 'America/New_York';
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric' });
const WEEKDAY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const FULL = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });

const nameOf = record => record.name || [record.firstName, record.lastName].filter(Boolean).join(' ') || 'Unnamed recruit';
const byName = (a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
const addDayKey = (key, days) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Live recruits to choose from in Add Task and Add Follow-Up, by name, each with its stage. Demo recruits are
 * left out because these save to HubSpot. With followUpFirst, recruits waiting 15+ days lead, longest waiting first.
 */
export function activityRecruits(records, { now = 0, followUpFirst = false } = {}) {
  const live = [...new Map(records.filter(record => record?.id && !record.isDemo).map(record => [String(record.id), record])).values()];
  const waiting = followUpFirst ? followUpRecruits(live, now) : [];
  const first = waiting.map(record => ({ id: String(record.id), name: nameOf(record), detail: `${record.daysWaiting} days waiting` }));
  const listed = new Set(first.map(item => item.id));
  const rest = live.filter(record => !listed.has(String(record.id))).map(record => ({ id: String(record.id), name: nameOf(record), detail: record.stage || undefined })).sort(byName);
  return [...first, ...rest];
}

function scheduled(records) {
  return records.flatMap(record => {
    const at = Date.parse(record?.scheduledAt ?? '');
    return record?.id && Number.isFinite(at) ? [{ record, at, day: DAY_KEY.format(at) }] : [];
  }).sort((a, b) => a.at - b.at || String(a.record.id).localeCompare(String(b.record.id)));
}
const chip = ({ record, at }, badge) => {
  const ends = Date.parse(record.endedAt ?? '');
  return {
    id: String(record.id), href: hubspotHref(record.hubspotUrl), external: true, name: record.title || 'Meeting', badge,
    detail: FULL.format(at), previewDetail: `${FULL.format(at)}${record.status ? ` · ${record.status}` : ''}`,
    // The hover list shows when it runs, its outcome, where, and whose it is.
    facts: [['When', `${FULL.format(at)}${Number.isFinite(ends) && ends > at ? ` – ${TIME.format(ends)}` : ''}`], ['Outcome', record.status || 'Not recorded'], ...(record.subtitle ? [['Location', record.subtitle]] : []), ...(record.owner ? [['Owner', record.owner]] : [])],
  };
};

/** Meetings summary: meetings from today on (Eastern calendar day), soonest first. */
export function upcomingMeetingChips(records, now) {
  if (!Number.isFinite(now) || now <= 0) return [];
  const today = DAY_KEY.format(now);
  return scheduled(records).filter(item => item.day >= today).map(item => chip(item, SHORT_DAY.format(item.at)));
}

/** Calendar summary: this week's schedule, today through the next six days (Eastern), in time order. */
export function weekMeetingChips(records, now) {
  if (!Number.isFinite(now) || now <= 0) return [];
  const today = DAY_KEY.format(now), last = addDayKey(today, 6);
  return scheduled(records).filter(item => item.day >= today && item.day <= last).map(item => chip(item, WEEKDAY_TIME.format(item.at)));
}
