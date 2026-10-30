export const PORTAL_ID = '50894788';
export const PIPELINE_ID = '924992938';

// Exact live Recruiting ticket pipeline IDs, verified after the approved migration.
export const STAGE_PAGES = Object.freeze([
  { id: 'hiring-event', label: 'Hiring Event', stageId: '1473318768', icon: 'calendar' },
  { id: 'application', label: 'Application', stageId: '1473318769', icon: 'file' },
  { id: 'phone-interview', label: 'Phone Interview', stageId: '1473225368', icon: 'phone' },
  { id: 'offer', label: 'Offer', stageId: '1473318770', icon: 'file' },
  { id: 'licensing-reminders', label: 'Licensing Reminders', stageId: '1473318771', icon: 'file' },
  { id: 'licensed-npn', label: 'Licensed w/ NPN', stageId: '1473318772', icon: 'check' },
  { id: 'contracting', label: 'Contracting', stageId: '1416243216', icon: 'file' },
  { id: 'training', label: 'Training', stageId: '1416243217', icon: 'training' },
  { id: 'completed', label: 'Completed', stageId: '1416243218', icon: 'check' },
  { id: 'withdrawn', label: 'Withdrawn', stageId: '1473318773', icon: 'back' },
].map(page => Object.freeze(page)));
// Read-only compatibility for old snapshots/records until the approved retirement is verified.
export const LEGACY_STAGES = Object.freeze({
  '1473225367': 'Recruits (legacy)', '1416243212': 'Orientation (legacy)',
  '1416243213': 'Licensing (legacy)', '1416243214': 'Transfers (legacy)',
});
export const STAGES = Object.freeze({ ...LEGACY_STAGES, ...Object.fromEntries(STAGE_PAGES.map(page => [page.stageId, page.label])) });
export const TERMINAL_STAGE_IDS = Object.freeze(['1416243218', '1473318773']);
export function stageIdForKey(key) { return STAGE_PAGES.find(page => page.id === key)?.stageId ?? null; }
export function stageKeyForStageId(stageId) { return STAGE_PAGES.find(page => page.stageId === stageId)?.id ?? null; }

export const RECRUIT_PROPERTIES = Object.freeze([
  'recruit_name', 'subject', 'orientation_office', 'intake_license_status',
  'recruit_type', 'recruiting_path', 'licensing_branch', 'orientation_registered', 'orientation_checked_in',
  'orientation_date', 'licensing_started', 'contracting_registered',
  'appointments_created', 'hs_pipeline', 'hs_pipeline_stage',
  'hs_v2_date_entered_current_stage', 'hs_lastmodifieddate', 'createdate',
]);

export const OFFICES = Object.freeze({ orlando: 'Orlando', tampa: 'Tampa', miami: 'Miami' });
export const INTAKES = Object.freeze({
  unlicensed: 'Unlicensed', in_progress: 'In Progress', already_licensed: 'Already Licensed',
});
export const RECRUIT_TYPES = Object.freeze({
  'in-house_recruit': 'In-House Recruit', referral_transfer: 'Referral Transfer',
});
