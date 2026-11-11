// Fixed HubSpot targets. These match lib/recruiting-config.mjs in the CRM, so an application
// appears in the CRM's Recruiting pipeline at "Application".
export const PORTAL_ID = '50894788';
export const RECRUITING_PIPELINE_ID = '924992938';
export const STAGE = Object.freeze({
  hiringEvent: '1473318768',
  application: '1473318769',
});
// Completed and Withdrawn. A contact with a recruiting ticket outside these stages already has an
// open recruit record, so an application is added to it instead of creating a second ticket.
export const TERMINAL_STAGE_IDS = Object.freeze(['1416243218', '1473318773']);

// HubSpot-defined association type IDs (documented constants, the same in every portal).
export const ASSOCIATION = Object.freeze({
  ticketToContact: 16,
  noteToContact: 202,
  noteToTicket: 228,
});

export const REQUIRED_SCOPES = Object.freeze([
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.tickets.read',
  'crm.objects.tickets.write',
]);
// Uploading the license needs one of these: `files.write` on a HubSpot service key, or the legacy
// `files` scope on an older private app.
export const FILE_SCOPES = Object.freeze(['files.write', 'files']);

// Private File Manager folder. PRIVATE files open only for signed-in HubSpot users.
export const LICENSE_FOLDER = '/Agent Applications/Driver Licenses';

// Ticket `orientation_office` option values.
export const OFFICE_VALUES = Object.freeze({ Orlando: 'orlando', Miami: 'miami', Tampa: 'tampa' });

// Ticket `intake_license_status` from "Which best describes you today?". Licensed in another
// state is left blank: that person still needs a Florida license, so staff decide.
export const INTAKE_LICENSE_STATUS = Object.freeze({
  'Not licensed': 'unlicensed',
  'Florida 2-14': 'already_licensed',
  'Florida 2-15': 'already_licensed',
});
export const ALREADY_LICENSED = Object.freeze({
  'Not licensed': 'false',
  'Florida 2-14': 'true',
  'Florida 2-15': 'true',
});

export const LIMITS = Object.freeze({
  maxRequestBytes: 4_300_000, // Vercel Functions reject request bodies over 4.5 MB.
  maxAnswersBytes: 96_000,
  maxFileBytes: 3_500_000,
  minFileBytes: 1_000,
  minFillMs: 10_000,
  text: 200,
  long: 3_000,
});

export const CONTACT_EMAIL = 'contracting@lgcyap.com';
