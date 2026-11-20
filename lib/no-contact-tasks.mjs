import { followUpRecruits } from '../app/recruit-follow-up.mjs';
export const FOLLOW_UP_QUEUE_ID = '12956231';
export function inactivityPeriod(recruit, now) {
  // An unavailable/ambiguous contact lookup is not evidence of no contact.
  if (!['available', 'unlinked'].includes(recruit?.contactStatus)) return null;
  const row = followUpRecruits([recruit], now)[0];
  if (!row) return null;
  return { since: new Date(row.followUpSince).toISOString(), days: row.daysWaiting };
}
export const taskMarker = (id, since) => `lgcyfollowup${id}x${Date.parse(since)}`;
const escape = text => String(text).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
export function followUpTask(recruit, period, now) {
  const name = recruit.name || [recruit.firstName, recruit.lastName].filter(Boolean).join(' ') || `Recruit ${recruit.id}`;
  return { properties: { hs_task_subject: `Follow up: ${name}`.slice(0, 200), hs_task_body: `<p>No contact for more than 15 days. Last contact (or creation when never contacted): ${escape(period.since)}. Recruiting stage: ${escape(recruit.stage || 'Not recorded')}.</p><p>Shared recruiting follow-up. ${taskMarker(recruit.id, period.since)}</p>`, hs_task_status: 'NOT_STARTED', hs_task_type: 'TODO', hs_task_priority: 'HIGH', hs_timestamp: new Date(now).toISOString(), hs_queue_membership_ids: FOLLOW_UP_QUEUE_ID },
    associations: [{ to: { id: recruit.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 230 }] }, ...(recruit.contactId ? [{ to: { id: recruit.contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }] }] : [])] };
}

// A durable claim precedes creation. An unknown POST outcome is reconciled, never blindly retried.
export async function reconcileNoContact(recruit, { now, store, provider }) {
  if (!['available', 'unlinked'].includes(recruit.contactStatus)) return { status: 'contact_unavailable' };
  const currentSince = recruit.lastContactedAt || recruit.createdAt;
  if (!Number.isFinite(Date.parse(currentSince))) return { status: 'invalid_date' };
  const prior = await store.periods(recruit.id);
  for (const row of prior) {
    if (row.status === 'pending' || row.status === 'uncertain') {
      const matches = await provider.find(taskMarker(recruit.id, row.since));
      if (matches.length === 1) { await store.created(recruit.id, row.since, matches[0].id); row.taskId = matches[0].id; row.status = 'created'; }
      else return { status: 'uncertain' };
    }
    if (row.status === 'created' && Date.parse(currentSince) > Date.parse(row.since)) {
      await provider.complete(row.taskId, taskMarker(recruit.id, row.since));
      await store.completed(recruit.id, row.since);
    }
  }
  const period = inactivityPeriod(recruit, now);
  if (!period) return { status: 'current' };
  if (prior.some(row => row.since === period.since && row.status !== 'retryable')) return { status: 'already_recorded' };
  if (!await store.claim(recruit.id, period.since, now)) return { status: 'already_recorded' };
  try {
    const task = await provider.create(followUpTask(recruit, period, now));
    if (!/^[1-9]\d{0,19}$/.test(task?.id || '')) throw new Error('Unconfirmed task creation');
    await store.created(recruit.id, period.since, task.id);
    return { status: 'created' };
  } catch (error) {
    if (error.definite === true) { await store.retryable(recruit.id, period.since, now + Math.max(60000, error.retryAfterMs || 300000)); return { status: 'retryable' }; }
    await store.uncertain(recruit.id, period.since); return { status: 'uncertain' };
  }
}
