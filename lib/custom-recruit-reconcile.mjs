import { createHmac } from 'node:crypto';
import { SYNC_FIELDS, ticketCanonical, recruitCanonical, ticketPatch, recruitPatch, createRecruitProperties } from './custom-recruit-model.mjs';

/** Persist only keyed fingerprints: low-entropy personal values must not be plain hashes. */
export function fingerprints(canonical, secret) {
  if (!secret) throw new Error('Custom recruit reconciliation secret required');
  return Object.fromEntries(SYNC_FIELDS.map(field => [field, createHmac('sha256', secret).update(JSON.stringify([field, canonical[field] || ''])).digest('hex')]));
}
const equal = (a, b) => SYNC_FIELDS.every(field => a?.[field] === b?.[field]);
function snapshot(pair, secret) {
  return { ticket: fingerprints(ticketCanonical(pair.ticket.properties), secret), recruit: pair.recruit ? fingerprints(recruitCanonical(pair.recruit.properties), secret) : null };
}
function associationChanged(state, pair) {
  return Boolean((state.contactId && state.contactId !== pair.contactId) || (state.recruitId && state.recruitId !== pair.recruit?.id));
}

export async function reconcileCustomRecruit(ticketId, { provider, store, secret }) {
  // Validate before even a read: a missing secret must never lead to a remote mutation.
  fingerprints({}, secret);
  let state = await store.get(ticketId) || {};
  let pair = await provider.pair(ticketId, state.recruitId);
  const save = async (status, extra = {}) => {
    state = { ...state, ...extra, status };
    await store.put(ticketId, state);
    return { status, ...(state.recruitId ? { recruitId: state.recruitId } : {}) };
  };
  const ack = async (current) => save('synced', { contactId: current.contactId, recruitId: current.recruit.id, baseline: snapshot(current, secret), pending: null });
  if (associationChanged(state, pair)) return save('association_changed');
  let before;
  try { before = snapshot(pair, secret); }
  catch (error) { if (error.name === 'CustomRecruitMappingError') return save('unmapped'); throw error; }
  if (state.pending) {
    if (!pair.recruit) return save('uncertain');
    const recordedFields = SYNC_FIELDS.filter(field => Object.hasOwn(state.pending.desired.ticket, field) && Object.hasOwn(state.pending.desired.recruit, field));
    if (!recordedFields.every(field => before.ticket[field] === state.pending.desired.ticket[field] && before.recruit[field] === state.pending.desired.recruit[field])) return save(state.pending.kind === 'create' ? 'conflict' : 'uncertain');
    if (recordedFields.length === SYNC_FIELDS.length) return ack(pair);
    // Confirm the old intent first, then reconcile newly introduced fields using first-link rules.
    state = { ...state, pending: null, baseline: state.pending.desired };
  }
  const ticket = ticketCanonical(pair.ticket.properties);
  let desired = { ...ticket };
  const ticketChanges = {}, recruitChanges = {};
  let createProps, ticketProps = {}, recruitProps = {};
  try {
    if (!pair.recruit) {
      createProps = createRecruitProperties(pair.ticket.properties, ticketId);
    } else {
      const recruit = recruitCanonical(pair.recruit.properties);
      for (const field of SYNC_FIELDS) {
        const t = ticket[field], r = recruit[field];
        if (t === r) continue;
        if (!state.baseline || !Object.hasOwn(state.baseline.ticket, field) && !Object.hasOwn(state.baseline.recruit, field)) {
          if (t && r) return save('conflict');
          desired[field] = t || r;
        } else {
          const tc = before.ticket[field] !== state.baseline.ticket[field];
          const rc = before.recruit[field] !== state.baseline.recruit[field];
          if (tc === rc) return save('conflict');
          desired[field] = tc ? t : r;
        }
        if (t !== desired[field]) ticketChanges[field] = desired[field];
        if (r !== desired[field]) recruitChanges[field] = desired[field];
      }
      ticketProps = ticketPatch(ticketChanges, pair.ticket.properties);
      recruitProps = recruitPatch(recruitChanges, pair.recruit.properties);
      if (!Object.keys(ticketProps).length && !Object.keys(recruitProps).length) return ack(pair);
    }
  } catch (error) { if (error.name === 'CustomRecruitMappingError') return save('unmapped'); throw error; }
  // The second read closes the planning window. Changes on either side stop all writes.
  const fresh = await provider.pair(ticketId, state.recruitId || pair.recruit?.id);
  if (fresh.contactId !== pair.contactId || fresh.recruit?.id !== pair.recruit?.id) return save('association_changed');
  let freshHashes;
  try { freshHashes = snapshot(fresh, secret); }
  catch (error) { if (error.name === 'CustomRecruitMappingError') return save('conflict'); throw error; }
  if (!equal(before.ticket, freshHashes.ticket) || (before.recruit && !equal(before.recruit, freshHashes.recruit))) return save('conflict');
  const expected = fingerprints(desired, secret);
  const pending = { kind: createProps ? 'create' : 'update', before, desired: { ticket: expected, recruit: expected } };
  await save('uncertain', { contactId: pair.contactId, ...(pair.recruit ? { recruitId: pair.recruit.id } : {}), pending });
  try {
    if (createProps) {
      const created = await provider.createRecruit(ticketId, pair.contactId, createProps);
      await save('uncertain', { recruitId: created.id });
    } else {
      if (Object.keys(ticketProps).length) await provider.patchTicket(ticketId, ticketProps);
      if (Object.keys(recruitProps).length) await provider.patchRecruit(pair.recruit.id, recruitProps);
    }
  } catch { /* A timeout can mean success. Confirm by reading, never blindly replay. */ }
  try {
    pair = await provider.pair(ticketId, state.recruitId);
    if (associationChanged(state, pair)) return save('association_changed');
    const after = snapshot(pair, secret);
    if (pair.recruit && equal(after.ticket, expected) && equal(after.recruit, expected)) return ack(pair);
  } catch { /* Preserve the durable intent until a later read can resolve it. */ }
  return save('uncertain');
}
