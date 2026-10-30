export const PORTAL_ID = '50894788';
export const PIPELINE_ID = '924992938';

// Exact live Recruiting ticket pipeline IDs, verified after the approved migration.
export const STAGE_PAGES = Object.freeze([
  { id: 'recruits', label: 'Recruits', stageId: '1473225367', icon: 'people' },
  { id: 'phone-interview', label: 'Phone Interview', stageId: '1473225368', icon: 'phone' },
  { id: 'orientation', label: 'Orientation', stageId: '1416243212', icon: 'calendar' },
  { id: 'licensing', label: 'Licensing', stageId: '1416243213', icon: 'file' },
  { id: 'contracting', label: 'Contracting', stageId: '1416243216', icon: 'file' },
  { id: 'transfers', label: 'Transfers', stageId: '1416243214', icon: 'transfer' },
  { id: 'training', label: 'Training', stageId: '1416243217', icon: 'training' },
  { id: 'completed', label: 'Completed', stageId: '1416243218', icon: 'check' },
].map(page => Object.freeze(page)));
export const STAGES = Object.freeze(Object.fromEntries(STAGE_PAGES.map(page => [page.stageId, page.label])));
export const TERMINAL_STAGE_IDS = Object.freeze(['1416243218']);

export const RECRUIT_PROPERTIES = Object.freeze([
  'recruit_name', 'subject', 'orientation_office', 'intake_license_status',
  'recruit_type', 'orientation_registered', 'orientation_checked_in',
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
