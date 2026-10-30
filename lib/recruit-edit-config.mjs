import { STAGE_PAGES, OFFICES, INTAKES, RECRUIT_TYPES } from './recruiting-config.mjs';
import { RECRUITING_PATHS, LICENSE_ROUTES } from './recruiting-flow.mjs';

const options = labels => Object.entries(labels).map(([value, label]) => ({ value, label }));
const optional = labels => [{ value: '', label: 'Not recorded' }, ...options(labels)];
const flags = [{ value: '', label: 'Not recorded' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];

/** Shared presentation schema only. Authority and validation remain server-side. */
export const EDIT_FIELDS = Object.freeze([
  { property: 'recruit_name', label: 'Recruit name', type: 'text', required: true, maxLength: 180 },
  { property: 'subject', label: 'Ticket name', type: 'text', required: true, maxLength: 180 },
  { property: 'orientation_office', label: 'Office', type: 'select', options: optional(OFFICES) },
  { property: 'hs_pipeline_stage', label: 'Stage', type: 'select', required: true, options: STAGE_PAGES.map(page => ({ value: page.stageId, label: page.label })) },
  { property: 'recruiting_path', label: 'Recruiting path', type: 'select', options: [{ value: '', label: 'Not classified' }, ...options(RECRUITING_PATHS)] },
  { property: 'licensing_branch', label: 'Licensing branch', type: 'select', options: [{ value: '', label: 'Not chosen' }, ...options(LICENSE_ROUTES)] },
  { property: 'intake_license_status', label: 'License status at intake', type: 'select', options: optional(INTAKES) },
  { property: 'recruit_type', label: 'Recruit type', type: 'select', options: optional(RECRUIT_TYPES) },
  { property: 'orientation_date', label: 'Orientation date', type: 'date' },
  { property: 'orientation_registered', label: 'Registered for orientation', type: 'select', options: flags },
  { property: 'orientation_checked_in', label: 'Checked in at orientation', type: 'select', options: flags },
  { property: 'licensing_started', label: 'Licensing started', type: 'select', options: flags },
  { property: 'contracting_registered', label: 'Registered for contracting', type: 'select', options: flags },
  { property: 'appointments_created', label: 'Carrier appointments created', type: 'select', options: flags },
]);

export const EDITABLE_PROPERTIES = Object.freeze(EDIT_FIELDS.map(field => field.property));
