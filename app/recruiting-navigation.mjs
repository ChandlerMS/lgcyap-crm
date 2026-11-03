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
  Object.freeze({ id: 'today', label: 'Recruiting Dashboard', icon: 'home' }),
  Object.freeze({ id: 'add-recruits', label: 'Add Recruits', icon: 'add-person' }),
  ...WORKSPACE_NAV_GROUPS.flatMap(group => group.items),
]);

// Recruiting pages with their own sidebar links. The stage queues open from the pipeline page instead.
export const SIDEBAR_RECRUITING_PAGES = Object.freeze(WORKSPACE_NAV.slice(0, 2));

// Destinations read from this portal's native HubSpot navigation.
export const HUBSPOT_TOOLS = Object.freeze([
  { id: 'inbox', label: 'Inbox', icon: 'inbox', path: '/live-messages/50894788' },
  { id: 'calls', label: 'Calls', icon: 'phone', path: '/contacts/50894788/objects/0-48' },
  { id: 'recruits', label: 'Recruits', icon: 'people', path: '/contacts/50894788/objects/0-5' },
  { id: 'contract-agents', label: 'Contract Agents', icon: 'people', path: '/contacts/50894788/objects/2-64481801' },
  { id: 'help-desk', label: 'Help Desk', icon: 'inbox', path: '/contacts/50894788/objects/0-5' },
  { id: 'tickets', label: 'Tickets', icon: 'file', path: '/contacts/50894788/objects/0-5' },
].map(tool => Object.freeze({ ...tool, href: `https://app.hubspot.com${tool.path}` })));
// Calls and Recruits keep their pages but open from their panel titles on the Recruits page, not the sidebar.
export const SIDEBAR_HUBSPOT_TOOLS = Object.freeze(HUBSPOT_TOOLS.filter(tool => tool.id !== 'calls' && tool.id !== 'recruits'));
// HubSpot views shown as panels on the Recruits page. Those without a page of their own (Meetings, Calendar) send their old links to Recruits.
export const RECRUITS_PAGE_TOOLS = Object.freeze([
  { id: 'meetings', label: 'Meetings' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'calls', label: 'Calls' },
].map(tool => Object.freeze(tool)));
export const WORKSPACE_EXTRA_PAGES = Object.freeze([Object.freeze({ id: 'leaderboard', label: 'Leaderboard', icon: 'chart' })]);

export function resolveWorkspaceRoute(hash) {
  const value = String(hash ?? '').replace(/^#/, '');
  if (value === 'queue' || value === 'ringcx') return { view: value };
  if (value === 'contacts') return { view: 'contract-agents' };
  // Tasks and the full Follow Up list left the Recruits page; saved links still open it.
  if (value === 'follow-up' || value === 'tasks') return { view: 'today' };
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
  const page = stagePageForView(view);
  return page ? records.filter(record => record.stageId === page.stageId
    && (!page.recruitingPath || record.recruitingPath === page.recruitingPath)
    && (!page.licenseRoute || record.licenseRoute === page.licenseRoute)) : [];
}

export function unmappedStageRecords(records) {
  return records.filter(record => !stagePageForRecord(record));
}
