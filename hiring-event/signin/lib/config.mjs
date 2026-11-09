// Fixed HubSpot targets for hiring-event sign-ins. These match lib/recruiting-config.mjs
// in the CRM so a sign-in appears in the CRM's Recruiting pipeline at "Hiring Event".
export const PORTAL_ID = '50894788';
export const RECRUITING_PIPELINE_ID = '924992938';
export const HIRING_EVENT_STAGE_ID = '1473318768';
// The CRM's stage graph (lib/recruiting-flow.mjs) only moves a Hiring Event ticket forward
// when it has a path, and `genpop` (labeled Referrals) is the path that starts at Hiring
// Event. The CRM's own Add Recruits sets the same value for Hiring Event tickets.
export const RECRUITING_PATH = 'genpop';
// Completed and Withdrawn. A contact with a recruiting ticket outside these stages
// already has an open recruit record, so a sign-in adds a note instead of a second ticket.
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
  'files',
]);

// Private File Manager folder for license photos. PRIVATE files open only for signed-in
// HubSpot users through short-lived links.
export const LICENSE_FOLDER = '/Hiring Event Sign-Ins/Driver Licenses';

// Values are the ticket property `orientation_office` options.
export const OFFICES = Object.freeze({ orlando: 'Orlando', miami: 'Miami', tampa: 'Tampa' });

// "How did you hear about us?" The value is stored in the ticket description and note,
// and also in the optional ticket property named by HUBSPOT_HEARD_ABOUT_PROPERTY.
export const HEARD_ABOUT = Object.freeze({
  referral: 'Referred by someone I know',
  indeed: 'Indeed',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  google: 'Google search',
  ziprecruiter: 'ZipRecruiter',
  job_fair: 'Job fair or event',
  other: 'Other',
});

export const LICENSE_STATUS = Object.freeze({ licensed: 'Licensed', unlicensed: 'Unlicensed' });
export const CONTRACTED_BEFORE = Object.freeze({ yes: 'Yes', no: 'No, never contracted with any carrier or agency' });

// Where the person scanned from. The QR codes add ?s=room (conference room TV) or
// ?s=lobby (first-floor security desk). Anything else is recorded as a direct visit.
export const SIGN_IN_SOURCES = Object.freeze({ room: 'Conference room screen (QR)', lobby: 'Lobby security desk (QR)', direct: 'Direct link' });

export const LIMITS = Object.freeze({
  maxRequestBytes: 4_200_000, // Vercel Functions reject request bodies over 4.5 MB.
  maxFileBytes: 2_500_000,
  minFileBytes: 2_000,
  minFillMs: 3_000,
});
