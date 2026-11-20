import { PIPELINE_ID, STAGE_PAGES, stageIdForKey, stageKeyForStageId } from './recruiting-config.mjs';

export const CUSTOM_RECRUIT_OBJECT = '2-72246945';
export const CUSTOM_RECRUIT_PIPELINES = Object.freeze({
  referrals: Object.freeze({ id: '955864424', stages: Object.freeze({ 'hiring-event': '1476961140', application: '1476961141', 'phone-interview': '1476961142' }) }),
  recruiters: Object.freeze({ id: '955871370', stages: Object.freeze({ application: '1476919927', 'phone-interview': '1476919928', 'hiring-event': '1476919929' }) }),
  onboarding: Object.freeze({ id: '955915022', stages: Object.freeze({ offer: '1476960857', licensed: '1476960858', 'licensing-reminders': '1476979561', 'licensed-npn': '1476979562', contracting: '1476979563', training: '1476979564', completed: '1476979565', 'closed-not-completed': '1476979566' }) }),
});
const shared = ['subject', 'recruit_name', 'hubspot_owner_id', 'orientation_office', 'intake_license_status', 'recruit_type', 'orientation_date', 'orientation_registered', 'orientation_checked_in', 'licensing_started', 'contracting_registered', 'appointments_created'];
export const SYNC_FIELDS = Object.freeze(['hs_pipeline_stage', 'recruiting_path', 'licensing_branch', ...shared]);
export const SOURCE_TIMESTAMP_FIELDS = Object.freeze(['source_ticket_created_at', 'source_ticket_updated_at', 'source_ticket_stage_entered_at', 'source_last_contacted_at']);
const paths = { genpop: 'referrals', mass_recruiting: 'recruiters' };
const licenses = { licensed: 'already_licensed', not_licensed: 'needs_licensing' };
const str = value => value == null ? '' : String(value);
export class CustomRecruitMappingError extends Error {
  constructor(code) { super(`Custom recruit mapping blocked: ${code}`); this.name = 'CustomRecruitMappingError'; this.code = code; }
}
const fail = code => { throw new CustomRecruitMappingError(code); };
function canonicalDate(value) {
  if (!value) return '';
  let day = value;
  if (/^-?\d{1,16}$/.test(value)) {
    const timestamp = Number(value);
    if (!Number.isSafeInteger(timestamp) || timestamp % 86400000 !== 0) fail('invalid_orientation_date');
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) fail('invalid_orientation_date');
    day = date.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('invalid_orientation_date');
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) fail('invalid_orientation_date');
  return day;
}
function validate(canonical) {
  if (!STAGE_PAGES.some(s => s.stageId === canonical.hs_pipeline_stage)) fail('unknown_ticket_stage');
  if (canonical.recruiting_path && !Object.hasOwn(paths, canonical.recruiting_path)) fail('unknown_path');
  if (canonical.licensing_branch && !Object.hasOwn(licenses, canonical.licensing_branch)) fail('unknown_license');
  if (canonical.licensing_branch === 'licensed' && ['licensing-reminders', 'licensed-npn'].includes(stageKeyForStageId(canonical.hs_pipeline_stage))) fail('license_stage_conflict');
  const enums = {
    orientation_office: ['orlando', 'miami', 'tampa'],
    intake_license_status: ['unlicensed', 'in_progress', 'already_licensed'],
    recruit_type: ['in-house_recruit', 'referral_transfer'],
  };
  for (const [key, values] of Object.entries(enums)) if (canonical[key] && !values.includes(canonical[key])) fail(`invalid_${key}`);
  for (const key of ['orientation_registered', 'orientation_checked_in', 'licensing_started', 'contracting_registered', 'appointments_created']) {
    if (!['', 'true', 'false'].includes(canonical[key])) fail(`invalid_${key}`);
  }
  if (canonical.hubspot_owner_id && !/^[1-9]\d{0,19}$/.test(canonical.hubspot_owner_id)) fail('invalid_owner');
  if (canonical.recruit_name.length > 180 || /[\u0000-\u001f\u007f-\u009f]/u.test(canonical.recruit_name)) fail('invalid_name');
  if (canonical.subject.length > 180 || /[\u0000-\u001f\u007f-\u009f]/u.test(canonical.subject)) fail('invalid_subject');
  canonical.orientation_date = canonicalDate(canonical.orientation_date);
  return canonical;
}
function fields(properties) { return Object.fromEntries(SYNC_FIELDS.map(key => [key, str(properties[key])])); }
export function ticketCanonical(properties) {
  if (str(properties.hs_pipeline) !== PIPELINE_ID) fail('unknown_ticket_pipeline');
  return validate(fields(properties));
}
export function recruitCanonical(properties) {
  const entry = Object.entries(CUSTOM_RECRUIT_PIPELINES).find(([, p]) => p.id === str(properties.hs_pipeline));
  if (!entry) fail('unknown_recruit_pipeline');
  const [family, pipeline] = entry;
  const stage = Object.entries(pipeline.stages).find(([, id]) => id === str(properties.hs_pipeline_stage))?.[0];
  if (!stage) fail('unknown_recruit_stage');
  const canonical = fields(properties);
  const path = str(properties.recruiting_path);
  if (path && !Object.values(paths).includes(path)) fail('unknown_path');
  if (family !== 'onboarding' && path && path !== family) fail('path_pipeline_conflict');
  if (family === 'onboarding' && !path) fail('missing_onboarding_path');
  canonical.recruiting_path = Object.keys(paths).find(key => paths[key] === (path || family)) || '';
  const license = str(properties.licensing_branch);
  if (license && !Object.values(licenses).includes(license)) fail('unknown_license');
  canonical.licensing_branch = Object.keys(licenses).find(key => licenses[key] === license) || '';
  let key = stage;
  if (stage === 'licensed') {
    if (canonical.licensing_branch && canonical.licensing_branch !== 'licensed') fail('licensed_stage_conflict');
    canonical.licensing_branch = 'licensed'; key = 'offer';
  }
  if (stage === 'closed-not-completed') {
    const reason = str(properties.closed_reason);
    if (!['withdrawn', 'not_selected', 'offer_declined', 'unresponsive', 'other'].includes(reason)) fail('unknown_closed_reason');
    key = reason === 'not_selected' ? 'rejected' : 'withdrawn';
  }
  canonical.hs_pipeline_stage = stageIdForKey(key);
  if (!canonical.orientation_office && ['Orlando', 'Miami'].includes(properties.lgcy_office)) canonical.orientation_office = properties.lgcy_office.toLowerCase();
  return validate(canonical);
}
function changesOnly(changes) { return Object.fromEntries(SYNC_FIELDS.filter(key => Object.hasOwn(changes, key)).map(key => [key, key === 'orientation_date' ? canonicalDate(str(changes[key])) : str(changes[key])])); }
export function ticketPatch(canonicalChanges, currentTicketProps) {
  const changes = changesOnly(canonicalChanges);
  if (Object.hasOwn(changes, 'subject') && !changes.subject.trim()) fail('invalid_subject');
  validate({ ...ticketCanonical(currentTicketProps), ...changes });
  return Object.fromEntries(Object.entries(changes).filter(([key, value]) => str(currentTicketProps[key]) !== value));
}
function mappedRecruit(canonical) {
  validate(canonical);
  const path = paths[canonical.recruiting_path];
  if (!path) fail('missing_path');
  let stage = stageKeyForStageId(canonical.hs_pipeline_stage);
  const pipeline = ['hiring-event', 'application', 'phone-interview'].includes(stage) ? CUSTOM_RECRUIT_PIPELINES[path] : CUSTOM_RECRUIT_PIPELINES.onboarding;
  const result = { recruiting_path: path, licensing_branch: licenses[canonical.licensing_branch] || '' };
  if (['withdrawn', 'rejected'].includes(stage)) { result.closed_reason = stage === 'rejected' ? 'not_selected' : 'withdrawn'; stage = 'closed-not-completed'; }
  if (stage === 'offer' && canonical.licensing_branch === 'licensed') stage = 'licensed';
  return { ...result, hs_pipeline: pipeline.id, hs_pipeline_stage: pipeline.stages[stage] };
}
export function recruitPatch(canonicalChanges, currentRecruitProps) {
  const changes = changesOnly(canonicalChanges);
  const current = recruitCanonical(currentRecruitProps);
  const next = validate({ ...current, ...changes });
  const patch = Object.fromEntries(shared.filter(key => Object.hasOwn(changes, key) && str(currentRecruitProps[key]) !== changes[key]).map(key => [key, changes[key]]));
  const routingChanged = ['hs_pipeline_stage', 'recruiting_path', 'licensing_branch'].some(key => Object.hasOwn(changes, key) && changes[key] !== current[key]);
  if (routingChanged) {
    const mapped = mappedRecruit(next);
    // Preserve specific closed reasons when the terminal meaning is unchanged.
    if (next.hs_pipeline_stage === current.hs_pipeline_stage && mapped.closed_reason) delete mapped.closed_reason;
    for (const [key, value] of Object.entries(mapped)) if (str(currentRecruitProps[key]) !== value) patch[key] = value;
  }
  return patch;
}
export function createRecruitProperties(ticketProps, ticketId) {
  const canonical = ticketCanonical(ticketProps);
  if (!str(ticketId)) fail('missing_ticket_id');
  return Object.fromEntries(Object.entries({ ...Object.fromEntries(shared.map(key => [key, canonical[key]])), ...mappedRecruit(canonical), crm_ticket_id: str(ticketId) }).filter(([, value]) => value !== ''));
}
const options = values => values.map(([value, label], displayOrder) => ({ label, value, displayOrder }));
const property = (name, label, type, fieldType, values = []) => ({ name, label, type, fieldType, options: options(values) });
export const APPROVED_RECRUIT_PROPERTIES = Object.freeze([
  property('orientation_office', 'Recruiting office', 'enumeration', 'select', [['orlando', 'Orlando'], ['miami', 'Miami'], ['tampa', 'Tampa']]),
  property('intake_license_status', 'Intake license status', 'enumeration', 'select', [['unlicensed', 'Unlicensed'], ['in_progress', 'In progress'], ['already_licensed', 'Already licensed']]),
  property('recruit_type', 'Recruit type', 'enumeration', 'select', [['in-house_recruit', 'In-house recruit'], ['referral_transfer', 'Referral transfer']]),
  property('orientation_date', 'Orientation date', 'date', 'date'),
  ...[['orientation_registered', 'Orientation registered'], ['orientation_checked_in', 'Orientation checked in'], ['licensing_started', 'Licensing started'], ['contracting_registered', 'Contracting registered'], ['appointments_created', 'Carrier appointments created']].map(([name, label]) => property(name, label, 'bool', 'booleancheckbox', [['true', 'Yes'], ['false', 'No']])),
  property('subject', 'Recruiting ticket name', 'string', 'text'),
  ...SOURCE_TIMESTAMP_FIELDS.map(name => property(name, ({ source_ticket_created_at: 'Source ticket created at', source_ticket_updated_at: 'Source ticket updated at', source_ticket_stage_entered_at: 'Source ticket stage entered at', source_last_contacted_at: 'Source last contacted at' })[name], 'datetime', 'date')),
  { ...property('crm_ticket_id', 'CRM ticket ID', 'string', 'text'), hasUniqueValue: true },
]);
