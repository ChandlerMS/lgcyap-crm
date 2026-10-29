export const PORTAL_ID = '50894788';
export const PIPELINE_ID = '924992938';

export const STAGES = Object.freeze({
  '1416243212': 'Orientation',
  '1416243213': 'Licensing',
  '1416243214': 'Transfer Approval',
  '1416243215': 'Pre-Contracting Requirements',
  '1416243216': 'Contracting',
  '1416243217': 'Training',
  '1416243218': 'Complete - Active',
  '1416243219': 'Withdrawn / Did Not Complete',
});

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
