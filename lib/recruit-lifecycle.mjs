import { STAGE_PAGES } from './recruiting-config.mjs';

export const CONTACT_RECRUITING_STAGE = 'recruiting_lifecycle_stage';
export const LIFECYCLE_STAGES = Object.freeze(STAGE_PAGES.filter(stage => stage.id !== 'withdrawn')
  .map(stage => Object.freeze({ ...stage, value: stage.id.replaceAll('-', '_') })));
export const contactStageForTicket = id => LIFECYCLE_STAGES.find(stage => stage.stageId === id)?.value ?? null;
export const ticketStageForContact = value => LIFECYCLE_STAGES.find(stage => stage.value === value)?.stageId ?? null;

// Compare against the last verified pair, never unrelated record modification dates.
export function lifecycleDecision(pair, state) {
  const mapped = contactStageForTicket(pair.ticketStage);
  if (!mapped || (pair.contactStage && !ticketStageForContact(pair.contactStage))) return { status: 'unmapped' };
  if (state?.contactId && state.contactId !== pair.contactId) return { status: 'association_changed' };
  if (pair.contactStage === mapped) return { status: 'synced' };
  // A possibly accepted write must only be verified, never blindly retried or reversed.
  if (state?.pending) return { status: 'uncertain' };
  if (['conflict', 'association_changed', 'branch_conflict', 'uncertain'].includes(state?.status)) return { status: state.status };
  if (!state?.ticketStage) return pair.contactStage ? { status: 'conflict' } : { status: 'write', target: 'contact', value: mapped };
  const ticketChanged = pair.ticketStage !== state.ticketStage;
  const contactChanged = pair.contactStage !== state.contactStage;
  if (ticketChanged === contactChanged || !pair.contactStage) return { status: 'conflict' };
  if (ticketChanged) return { status: 'write', target: 'contact', value: mapped };
  if (pair.licenseRoute === 'licensed' && ['licensing_reminders', 'licensed_npn'].includes(pair.contactStage)) return { status: 'branch_conflict' };
  return { status: 'write', target: 'ticket', value: ticketStageForContact(pair.contactStage) };
}

export function lifecycleStatusLabel(status) {
  return ({ synced: 'Contact and pipeline matched at the last check', pending: 'Contact stage sync pending',
    conflict: 'Conflicting stage edits — review both records in HubSpot', uncertain: 'Sync outcome needs review — no automatic retry',
    ambiguous: 'Multiple linked records — review the Contact/ticket links', unlinked: 'Link one Contact to this recruit to enable sync',
    association_changed: 'Contact link changed — review before syncing', branch_conflict: 'Contact stage conflicts with the licensed branch',
    unmapped: 'Stage is outside the nine-stage recruiting sync', unavailable: 'Sync check unavailable', disabled: 'Contact stage sync is disabled',
  })[status] ?? 'Awaiting the next Contact stage sync check';
}
