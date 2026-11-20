import { hubspotJson } from './event-attendance.mjs';
import { readRecruiterNames } from './hubspot.mjs';
import { EDIT_FIELDS } from './recruit-edit-config.mjs';

// The recruit's ticket as it is now, for the monthly Sheets. Every field the CRM can edit gets a column, so a
// change made in the CRM or in HubSpot rewrites the row on the next check. Stage already has its own column.
const FIELDS = EDIT_FIELDS.filter(field => field.property !== 'hs_pipeline_stage');
const EXTRA = ['recruit_email', 'recruit_phone_number', 'hubspot_owner_id', 'hs_v2_date_entered_current_stage', 'hs_lastmodifieddate'];
const PROPERTIES = [...new Set([...FIELDS.map(field => field.property), ...EXTRA])];
export const RECORD_HEADERS = Object.freeze([...FIELDS.map(field => `CRM: ${field.label}`), 'CRM: Email', 'CRM: Phone', 'CRM: Recruiter', 'CRM: Entered current stage', 'CRM: Last updated']);
const REVIEW = { approved: 'Approved', denied: 'Denied' };
export const REVIEW_HEADERS = Object.freeze(['Review decision', 'Reviewed (Eastern)']);
const WHEN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const validId = value => /^[1-9]\d{0,19}$/.test(value);
const when = value => { const time = /^\d+$/.test(String(value ?? '')) ? Number(value) : Date.parse(String(value ?? '')); return value && Number.isFinite(time) ? WHEN.format(time) : ''; };
const invalid = () => Object.assign(new Error('HubSpot returned an incomplete recruit record read.'), { code: 'HUBSPOT_RECORDS_INCOMPLETE' });

function fieldText(field, value) {
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'date') { const time = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value)); return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : String(value); }
  const option = field.options?.find(choice => choice.value === String(value));
  return option ? option.label : String(value);
}

/** Current record cells for one ticket. A missing ticket gives blanks, never another person's values. */
export function recordCells(record) {
  if (!record) return RECORD_HEADERS.map(() => '');
  const p = record.properties ?? {};
  const owner = validId(String(p.hubspot_owner_id ?? '')) ? record.ownerName || `Owner ${p.hubspot_owner_id}` : '';
  return [...FIELDS.map(field => fieldText(field, p[field.property])), String(p.recruit_email ?? ''), String(p.recruit_phone_number ?? ''), owner, when(p.hs_v2_date_entered_current_stage), when(p.hs_lastmodifieddate)];
}

export function reviewCells(review) {
  return review && REVIEW[review.status] ? [REVIEW[review.status], when(review.reviewedAt)] : ['Not reviewed', ''];
}

/** Every requested ticket must come back. Deleted tickets stay blank. Owner names are best effort. */
export async function readRecruitRecords(ticketIds, { accessToken, fetchImpl = fetch, timeoutMs = 12000, now = Date.now, readOwners = readRecruiterNames }) {
  const ids = [...new Set(ticketIds)].filter(Boolean);
  if (ids.some(id => !validId(id))) throw invalid();
  const records = {};
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const payload = await hubspotJson('/crm/v3/objects/tickets/batch/read', { method: 'POST', body: { properties: PROPERTIES, inputs: batch.map(id => ({ id })) } }, { accessToken, fetchImpl, timeoutMs, now });
    if (!payload || !Array.isArray(payload.results) || payload.status && payload.status !== 'COMPLETE' || payload.errors?.length || payload.numErrors > 0 || payload.results.length !== batch.length) throw invalid();
    for (const row of payload.results) {
      const id = String(row?.id ?? '');
      if (!batch.includes(id) || Object.hasOwn(records, id) || !row.properties || typeof row.properties !== 'object') throw invalid();
      records[id] = row.archived ? null : { properties: row.properties };
    }
  }
  const ownerIds = Object.values(records).map(record => String(record?.properties.hubspot_owner_id ?? '')).filter(validId);
  if (ownerIds.length) {
    const { names } = await readOwners({ accessToken, fetchImpl, now });
    for (const record of Object.values(records)) if (record) record.ownerName = names.get(String(record.properties.hubspot_owner_id ?? '')) ?? '';
  }
  return records;
}
