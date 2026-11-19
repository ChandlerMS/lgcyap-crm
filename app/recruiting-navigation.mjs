import { externalWorkspacePage } from './external-workspace-pages.mjs';
import { STAGE_PAGES } from '../lib/recruiting-config.mjs';

const page = (id, stageKey, filter = {}) => {
  const stage = STAGE_PAGES.find(candidate => candidate.id === stageKey);
  if (!stage) throw new Error(`Unknown recruiting stage: ${stageKey}`);
  return Object.freeze({ ...stage, id, stageKey, ...filter });
};
export const WORKSPACE_NAV_GROUPS = Object.freeze([
  { id: 'genpop', label: 'Referrals', branch: true, items: [
    page('genpop-hiring-event', 'hiring-event', { recruitingPath: 'genpop' }),
    page('genpop-application', 'application', { recruitingPath: 'genpop' }),
    page('genpop-phone-interview', 'phone-interview', { recruitingPath: 'genpop' }),
  ] },
  { id: 'mass-recruiting', label: 'Recruiters', branch: true, items: [
    page('mass-application', 'application', { recruitingPath: 'mass_recruiting' }),
    page('mass-phone-interview', 'phone-interview', { recruitingPath: 'mass_recruiting' }),
    page('mass-hiring-event', 'hiring-event', { recruitingPath: 'mass_recruiting' }),
  ] },
  { id: 'offer', label: 'Both paths meet', branch: false, items: [page('offer', 'offer')] },
  { id: 'licensed', label: 'Licensed', branch: true, items: [
    page('licensed-contracting', 'contracting', { licenseRoute: 'licensed' }),
  ] },
  { id: 'not-licensed', label: 'Not Licensed', branch: true, items: [
    page('licensing-reminders', 'licensing-reminders'), page('licensed-npn', 'licensed-npn'),
    page('unlicensed-contracting', 'contracting', { licenseRoute: 'not_licensed' }),
  ] },
  { id: 'training', label: 'Both branches meet', branch: false, items: [page('training', 'training')] },
  { id: 'outcomes', label: 'Outcomes', branch: false, items: [page('completed', 'completed')] },
].map(group => Object.freeze({ ...group, items: Object.freeze(group.items) })));
export const WORKSPACE_NAV = Object.freeze([
  Object.freeze({ id: 'today', label: 'Dashboard', icon: 'funnel' }),
  Object.freeze({ id: 'add-recruits', label: 'Add Recruits', icon: 'add-person' }),
  ...WORKSPACE_NAV_GROUPS.flatMap(group => group.items),
]);

// Dashboard heads the sidebar on its own. Add Recruits opens from a button on the dashboard,
// and the stage queues open from the pipeline.
export const SIDEBAR_RECRUITING_PAGES = Object.freeze(WORKSPACE_NAV.slice(0, 1));

// Destinations read from this portal's native HubSpot navigation.
export const HUBSPOT_TOOLS = Object.freeze([
  { id: 'sales', label: 'Sales', icon: 'chart', path: '/contacts/50894788/objects/0-3' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', path: '/live-messages/50894788' },
  { id: 'calls', label: 'Calls', icon: 'phone', path: '/contacts/50894788/objects/0-48' },
  { id: 'recruits', label: 'Recruits', icon: 'people', path: '/contacts/50894788/objects/0-5' },
  { id: 'contract-agents', label: 'Contract Agents', icon: 'people', path: '/contacts/50894788/objects/2-64481801' },
  { id: 'carrier-appointments', label: 'Carrier Appointments', icon: 'file', path: '/contacts/50894788/objects/2-64481803' },
  { id: 'carriers', label: 'Carriers', icon: 'file', path: '/contacts/50894788/objects/2-64481805' },
  { id: 'help-desk', label: 'Help Desk', icon: 'inbox', path: '/contacts/50894788/objects/0-5' },
  { id: 'tickets', label: 'Tickets', icon: 'file', path: '/contacts/50894788/objects/0-5' },
].map(tool => Object.freeze({ ...tool, href: `https://app.hubspot.com${tool.path}` })));
// Calls and Recruits keep their pages but open from their panel titles on the Recruits page, not the sidebar.
export const SIDEBAR_HUBSPOT_TOOLS = Object.freeze(HUBSPOT_TOOLS.filter(tool => ['recruits', 'contract-agents'].includes(tool.id)));
// HubSpot views shown as panels on the dashboard. Meetings and Calendar open their full pages from there (see DASHBOARD_PAGES).
export const RECRUITS_PAGE_TOOLS = Object.freeze([
  { id: 'meetings', label: 'Meetings' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'calls', label: 'Calls' },
].map(tool => Object.freeze(tool)));
// Full recruiting paths include every stage, including completed and withdrawn records.
export const RECRUIT_PATH_PAGES = Object.freeze([
  Object.freeze({ id: 'referrals', label: 'Referrals', recruitingPath: 'genpop' }),
  Object.freeze({ id: 'recruiters', label: 'Recruiters', recruitingPath: 'mass_recruiting' }),
]);
export const RECRUITS_CHILD_PAGES = Object.freeze([
  ...RECRUIT_PATH_PAGES,
  Object.freeze({ id: 'event-attendance', label: 'Event Attendance' }),
  // Online agent applications from apply.lgcyap.com, organized for the admin team.
  Object.freeze({ id: 'applications', label: 'Applications' }),
  Object.freeze({ id: 'training-classes', label: 'Training Classes' }),
]);
// The hiring-event sites, after the Recruits pages. They refuse to be framed (they take personal details and a photo ID),
// so each opens in its own tab, which also suits putting the QR screen on a TV.
export const RECRUITS_SITE_LINKS = Object.freeze([
  Object.freeze({ id: 'sign-in', label: 'Sign-In', href: 'https://signin.lgcyap.com/' }),
  Object.freeze({ id: 'sign-in-qr', label: 'QR Code Sign-in', href: 'https://signinqr.lgcyap.com/' }),
]);
// Leaderboard and Call Analytics share one sidebar link (the first) and switch with a toggle on the page.
export const WORKSPACE_EXTRA_PAGES = Object.freeze([Object.freeze({ id: 'leaderboard', label: 'Leaderboard', icon: 'chart' }), Object.freeze({ id: 'call-analytics', label: 'Call Analytics', icon: 'chart' })]);
// Preserve saved source routes; the Queues sidebar link embeds the combined Queue site.
export const QUEUE_PAGES = Object.freeze([
  { id: 'queue', label: 'Shopper', icon: 'phone', source: 'shopper' },
  { id: 'ringcx', label: 'Standard vs Preferred', icon: 'phone', source: 'svp' },
].map(page => Object.freeze(page)));
// Pages opened from the dashboard's summaries and panel titles rather than the sidebar.
export const DASHBOARD_PAGES = Object.freeze(['tasks', 'follow-up', 'meetings', 'calendar']);
// The sidebar link that stands for a page reached from another page: Add Recruits, the dashboard pages and the full
// Event Attendance page (a section of the dashboard, kept for saved links) from the dashboard, Call Analytics from Leaderboard.
export function sidebarViewFor(view) {
  const external = externalWorkspacePage(view);
  if (external) return external.group === 'agents' ? 'contract-agents' : external.group;
  if (['add-recruits', ...DASHBOARD_PAGES].includes(view)) return 'today';
  if (RECRUITS_CHILD_PAGES.some(page => page.id === view)) return 'recruits';
  if (['carrier-appointments', 'carriers'].includes(view)) return 'contract-agents';
  if (view === 'call-analytics') return 'leaderboard';
  return view;
}

export function resolveWorkspaceRoute(hash) {
  const value = String(hash ?? '').replace(/^#/, '');
  if (externalWorkspacePage(value)) return { view: value };
  if (value === 'calls/shopper' || value === 'calls/standard') return { view: 'calls', source: value.slice('calls/'.length) };
  if (/^inbox\/thread\/[1-9]\d{0,19}$/.test(value)) return { view: 'inbox', id: value.slice('inbox/thread/'.length) };
  if (RECRUIT_PATH_PAGES.some(page => page.id === value)) return { view: value };
  if (['queue', 'ringcx', 'event-attendance', 'applications', 'training-classes', 'loa', 'admin'].includes(value)) return { view: value };
  // Call Analytics was named Lead Data; saved links still open it.
  if (value === 'lead-data') return { view: 'call-analytics' };
  if (value === 'contacts') return { view: 'contract-agents' };
  // Tasks, Follow up, Meetings and Calendar open their own pages from the dashboard's summaries and panel titles.
  if (DASHBOARD_PAGES.includes(value)) return { view: value };
  if (value === 'add-recruit') return { view: 'add-recruits' };
  if (['orientation', 'licensing', 'transfers'].includes(value)) return { view: 'today' };
  if (RECRUITS_PAGE_TOOLS.some(tool => tool.id === value) && !HUBSPOT_TOOLS.some(tool => tool.id === value)) return { view: 'today' };
  if (value.startsWith('recruit/')) return { view: 'today', id: value.slice(8) };
  return { view: WORKSPACE_NAV.some(item => item.id === value) || STAGE_PAGES.some(item => item.id === value) || HUBSPOT_TOOLS.some(item => item.id === value) || WORKSPACE_EXTRA_PAGES.some(item => item.id === value) ? value : 'today' };
}

export function stagePageForView(view) {
  return WORKSPACE_NAV.find(page => page.id === view && page.stageId) ?? STAGE_PAGES.find(page => page.id === view);
}

export function stagePageForRecord(record) {
  return WORKSPACE_NAV.find(page => page.stageId === record?.stageId
    && (!page.recruitingPath || page.recruitingPath === record?.recruitingPath)
    && (!page.licenseRoute || page.licenseRoute === record?.licenseRoute))
    ?? STAGE_PAGES.find(page => page.stageId === record?.stageId);
}

export function recordsForStagePage(records, view) {
  const pathPage = RECRUIT_PATH_PAGES.find(page => page.id === view);
  if (pathPage) return records.filter(record => record.recruitingPath === pathPage.recruitingPath);
  const page = stagePageForView(view);
  return page ? records.filter(record => record.stageId === page.stageId
    && (!page.recruitingPath || record.recruitingPath === page.recruitingPath)
    && (!page.licenseRoute || record.licenseRoute === page.licenseRoute)) : [];
}

export function unmappedStageRecords(records) {
  return records.filter(record => !stagePageForRecord(record));
}
