const choice = (value, label) => ({ value, label });
const blank = choice('', 'Not recorded');
const owner = { property: 'hubspot_owner_id', label: 'Owner', type: 'select', maxLength: 20, owner: true, options: [choice('', 'Unassigned')] };
export const TOOL_EDIT_FIELDS = Object.freeze({
  contacts: [
    { property: 'firstname', label: 'First name', type: 'text', maxLength: 100 },
    { property: 'lastname', label: 'Last name', type: 'text', maxLength: 100 },
    { property: 'phone', label: 'Phone number', type: 'tel', maxLength: 80 },
    { property: 'email', label: 'Email', type: 'email', maxLength: 254 },
    { property: 'company', label: 'Company', type: 'text', maxLength: 250 },
  ],
  tickets: [
    { property: 'subject', label: 'Ticket title', type: 'text', required: true, maxLength: 250 },
    { property: 'hs_ticket_priority', label: 'Priority', type: 'select', maxLength: 20, options: [blank, ...['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(value => choice(value, value[0] + value.slice(1).toLowerCase()))] }, owner,
  ],
  tasks: [
    { property: 'hs_task_subject', label: 'Task title', type: 'text', required: true, maxLength: 250 },
    { property: 'hs_task_status', label: 'Status', type: 'select', maxLength: 20, options: [blank, choice('NOT_STARTED', 'Not started'), choice('COMPLETED', 'Completed')] },
    { property: 'hs_task_priority', label: 'Priority', type: 'select', maxLength: 20, options: [blank, choice('LOW', 'Low'), choice('MEDIUM', 'Medium'), choice('HIGH', 'High')] },
    { property: 'hs_timestamp', label: 'Due date', type: 'datetime', maxLength: 24 }, owner,
  ],
  'customer-success': [
    { property: 'name', label: 'Company name', type: 'text', required: true, maxLength: 250 },
    { property: 'domain', label: 'Domain', type: 'text', maxLength: 253 },
    { property: 'phone', label: 'Phone number', type: 'tel', maxLength: 80 },
    { property: 'city', label: 'City', type: 'text', maxLength: 100 },
    { property: 'hs_csm_sentiment', label: 'CSM sentiment', type: 'select', maxLength: 20, options: [blank, choice('at_risk', 'At-Risk'), choice('neutral', 'Neutral'), choice('healthy', 'Healthy')] },
    { property: 'hs_next_renewal_date', label: 'Next renewal date', type: 'date', maxLength: 10, readOnly: true },
  ],
  meetings: [
    { property: 'hs_meeting_title', label: 'Meeting title', type: 'text', maxLength: 250 },
    { property: 'hs_meeting_start_time', label: 'Start', type: 'datetime', maxLength: 24 },
    { property: 'hs_meeting_end_time', label: 'End', type: 'datetime', maxLength: 24 },
    { property: 'hs_meeting_location', label: 'Location', type: 'text', maxLength: 500 },
    { property: 'hs_meeting_outcome', label: 'Outcome', type: 'select', maxLength: 20, options: [blank, ...['SCHEDULED', 'COMPLETED', 'RESCHEDULED', 'NO_SHOW', 'CANCELED'].map(value => choice(value, value.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())))] }, owner,
  ],
});

export function editableFields(tool) { return Object.hasOwn(TOOL_EDIT_FIELDS, tool) ? TOOL_EDIT_FIELDS[tool].filter(field => !field.readOnly) : []; }
export function canonicalToolValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  const raw = String(value);
  if (field.type === 'date' || field.type === 'datetime') {
    const millis = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return raw;
    const iso = new Date(millis).toISOString(); return field.type === 'date' ? iso.slice(0, 10) : iso;
  }
  if (field.type === 'email' || field.property === 'domain') return raw.trim().toLowerCase();
  return raw;
}
export function toolEditValues(tool, properties) { return Object.fromEntries(editableFields(tool).map(field => [field.property, canonicalToolValue(field, properties[field.property])])); }
