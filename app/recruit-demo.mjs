import { STAGE_PAGES, OFFICES, INTAKES, RECRUIT_TYPES, stageKeyForStageId } from '../lib/recruiting-config.mjs';
import { EDIT_FIELDS } from '../lib/recruit-edit-config.mjs';
import { LICENSE_ROUTES, RECRUITING_PATHS, validateFlowTransition } from '../lib/recruiting-flow.mjs';
import { normalizeContactPhone } from '../lib/contact-input.mjs';

const FIRST_ID = 900000000000001;
const NAMES = ['Avery', 'Jordan', 'Morgan', 'Riley', 'Cameron', 'Taylor', 'Casey', 'Jamie', 'Quinn', 'Parker', 'Drew', 'Reese', 'Skyler', 'Rowan', 'Emerson', 'Finley', 'Blake', 'Dana', 'Alex', 'Hayden', 'Logan', 'Harper', 'Sage', 'Marley', 'Dakota', 'Kendall', 'Micah', 'Remy', 'Charlie', 'Robin', 'Adrian', 'Bailey', 'Jesse', 'Sam', 'Elliot', 'Noel', 'Shiloh', 'Devon', 'Kieran', 'Frankie', 'Lennox', 'Aspen', 'River', 'Arden', 'Shawn', 'Ellis', 'Tatum', 'Oakley', 'Phoenix', 'Dallas', 'Milan', 'Justice', 'Winter', 'Shay', 'Kerry', 'Lane', 'Sutton', 'Bellamy', 'Wren', 'Ari'];
const DATE_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
function localDay(value) { const parts = Object.fromEntries(DATE_PARTS.formatToParts(value).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
function timestamp(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new DemoRecruitError('INVALID_DEMO_TIME', 'Choose a valid demo time.');
  return Math.trunc(time);
}
function dayStart(now) {
  const today = localDay(now); let low = now - 27 * 3600000, high = now;
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (localDay(middle) === today) high = middle; else low = middle; }
  return high;
}
export class DemoRecruitError extends Error {
  constructor(code, message, fieldErrors = {}) { super(message); this.name = 'DemoRecruitError'; this.code = code; this.fieldErrors = fieldErrors; }
}
export function isDemoRecruit(recruit) {
  if (!recruit || recruit.isDemo !== true || recruit.hubspotUrl !== '' || typeof recruit.id !== 'string' || !/^\d{15}$/.test(recruit.id)) return false;
  const id = Number(recruit.id);
  return Number.isSafeInteger(id) && id >= FIRST_ID && id < FIRST_ID + 60;
}
function demoClock(recruit, now) {
  const time = timestamp(now);
  if (!isDemoRecruit(recruit)) throw new DemoRecruitError('NOT_DEMO_RECRUIT', 'Demo editing is available only for isolated sample recruits.');
  const version = typeof recruit.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recruit.updatedAt) ? Date.parse(recruit.updatedAt) : NaN;
  if (stageKeyForStageId(recruit.stageId) !== recruit.stageKey || !STAGE_PAGES.some(stage => stage.id === recruit.stageKey)
    || typeof recruit.recruitingPath !== 'string' || recruit.recruitingPath !== '' && !Object.hasOwn(RECRUITING_PATHS, recruit.recruitingPath)
    || typeof recruit.licenseRoute !== 'string' || recruit.licenseRoute !== '' && !Object.hasOwn(LICENSE_ROUTES, recruit.licenseRoute)
    || !Number.isFinite(version) || new Date(version).toISOString() !== recruit.updatedAt
    || recruit.editValues?.hs_pipeline_stage !== recruit.stageId || recruit.editValues?.recruiting_path !== recruit.recruitingPath || recruit.editValues?.licensing_branch !== recruit.licenseRoute) throw new DemoRecruitError('INVALID_DEMO_SNAPSHOT', 'Reload the demo before changing this sample.');
  if (time < Date.parse(recruit.updatedAt)) throw new DemoRecruitError('INVALID_DEMO_TIME', 'The demo clock cannot move backward.');
  return time;
}

/** Sixty fictional in-memory records, never passed to a HubSpot request or contact action. */
export function createDemoRecruits(now) {
  const time = timestamp(now), start = dayStart(time), elapsed = time - start;
  const offices = Object.keys(OFFICES);
  return STAGE_PAGES.flatMap((stage, stageIndex) => Array.from({ length: 6 }, (_, offset) => {
    const index = stageIndex * 6 + offset;
    const firstName = NAMES[index * 17 % NAMES.length], lastName = 'Test', name = `${firstName} ${lastName}`;
    const recruitingPath = offset % 2 ? 'mass_recruiting' : 'genpop';
    const licenseRoute = ['licensing-reminders', 'licensed-npn'].includes(stage.id) ? 'not_licensed' : ['contracting', 'training', 'completed', 'withdrawn'].includes(stage.id) ? offset % 2 ? 'not_licensed' : 'licensed' : '';
    const created = start + Math.floor(elapsed * (index + 1) / 240);
    const entered = created + Math.floor((time - created) * (.2 + offset * .06));
    const contacted = entered + Math.floor((time - entered) * .5);
    const officeKey = offices[index % offices.length];
    const intakeKey = licenseRoute === 'licensed' ? 'already_licensed' : ['licensing-reminders', 'licensed-npn'].includes(stage.id) ? 'in_progress' : 'unlicensed';
    const flags = { orientationRegistered: stageIndex >= 2, orientationCheckedIn: stageIndex >= 3, licensingStarted: licenseRoute === 'not_licensed' && stageIndex >= 4, contractingRegistered: stageIndex >= 6, appointmentsCreated: stage.id === 'completed' };
    const raw = { recruit_name: name, subject: `Demo Recruiting - ${name}`, orientation_office: officeKey, hs_pipeline_stage: stage.stageId, recruiting_path: recruitingPath, licensing_branch: licenseRoute, intake_license_status: intakeKey, recruit_type: recruitingPath === 'genpop' ? 'referral_transfer' : 'in-house_recruit', orientation_date: '', orientation_registered: String(flags.orientationRegistered), orientation_checked_in: String(flags.orientationCheckedIn), licensing_started: String(flags.licensingStarted), contracting_registered: String(flags.contractingRegistered), appointments_created: String(flags.appointmentsCreated) };
    return { id: String(FIRST_ID + index), isDemo: true, name, fullName: name, firstName, lastName,
      phone: `+1202555${String(100 + (index * 37 + 13) % 100).padStart(4, '0')}`, email: `${firstName.toLowerCase()}.test.${String(index + 1).padStart(2, '0')}@example.invalid`,
      office: OFFICES[officeKey], intake: INTAKES[intakeKey], stage: stage.label, stageId: stage.stageId, stageKey: stage.id, recruitingPath, licenseRoute,
      createdAt: new Date(created).toISOString(), enteredStageAt: new Date(entered).toISOString(), updatedAt: new Date(time).toISOString(), lastContactedAt: offset % 2 === 0 ? new Date(contacted).toISOString() : null,
      orientationDate: null, recruitType: RECRUIT_TYPES[raw.recruit_type], recruiter: 'Demo Recruiter', ownerId: null, recruiterStatus: 'demo', flags, hubspotUrl: '',
      editValues: Object.fromEntries(EDIT_FIELDS.map(field => [field.property, raw[field.property]])),
    };
  }));
}

/** Mirrors the workflow checks locally. This function has no transport or persistence. */
export function applyDemoStage(recruit, targetStageId, flowChanges = {}, now) {
  const time = demoClock(recruit, now), stageKey = stageKeyForStageId(targetStageId);
  if (!stageKey || targetStageId === recruit.stageId || !flowChanges || typeof flowChanges !== 'object' || Array.isArray(flowChanges)
    || Object.keys(flowChanges).some(key => key !== 'licensing_branch') || Object.hasOwn(flowChanges, 'licensing_branch') && !['licensed', 'not_licensed'].includes(flowChanges.licensing_branch)) throw new DemoRecruitError('INVALID_DEMO_STAGE', 'Choose a different connected demo stage.');
  const licenseRoute = flowChanges.licensing_branch ?? recruit.licenseRoute;
  const after = { ...recruit, stageKey, licenseRoute };
  const result = validateFlowTransition(recruit, after);
  if (!result.ok) throw new DemoRecruitError(result.code, result.message);
  const stage = STAGE_PAGES.find(item => item.stageId === targetStageId);
  return { ...after, stage: stage.label, stageId: targetStageId, enteredStageAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString(), editValues: { ...recruit.editValues, hs_pipeline_stage: targetStageId, licensing_branch: licenseRoute } };
}

export function validateDemoDetails(input) {
  const errors = {}, result = {};
  for (const field of ['firstName', 'lastName', 'recruiter']) {
    const value = typeof input?.[field] === 'string' ? input[field].trim().normalize('NFC') : '';
    if (CONTROL.test(value) || [...value].length > 100 || field !== 'recruiter' && !value) errors[field] = `Enter ${field === 'firstName' ? 'a first name' : field === 'lastName' ? 'a last name' : 'a recruiter'} of ${field === 'recruiter' ? 'up to' : '1–'}100 characters.`;
    result[field] = value;
  }
  if (`${result.firstName} ${result.lastName}`.length > 180) errors.lastName = 'Keep the full name within 180 characters.';
  try { result.phone = normalizeContactPhone(input?.phone); } catch { errors.phone = 'Enter a valid phone number without an extension.'; }
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length > 254 || CONTROL.test(email) || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) errors.email = 'Enter a valid email address.';
  result.email = email;
  if (Object.keys(errors).length) throw new DemoRecruitError('INVALID_DEMO_DETAILS', 'Check the highlighted demo fields.', errors);
  return result;
}

export function applyDemoDetails(recruit, input, now) {
  const time = demoClock(recruit, now), details = validateDemoDetails(input), name = `${details.firstName} ${details.lastName}`;
  return { ...recruit, ...details, recruiter: details.recruiter || null, recruiterStatus: details.recruiter ? 'demo' : 'unassigned', name, fullName: name, updatedAt: new Date(time).toISOString(), editValues: { ...recruit.editValues, recruit_name: name, subject: `Demo Recruiting - ${name}` } };
}
