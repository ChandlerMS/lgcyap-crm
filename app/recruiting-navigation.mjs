import { STAGE_PAGES } from '../lib/recruiting-config.mjs';

const page = (id, stageKey, filter = {}) => {
  const stage = STAGE_PAGES.find(candidate => candidate.id === stageKey);
  if (!stage) throw new Error(`Unknown recruiting stage: ${stageKey}`);
  return Object.freeze({ ...stage, id, stageKey, ...filter });
};
export const WORKSPACE_NAV_GROUPS = Object.freeze([
  { id: 'genpop', label: 'GenPop', branch: true, items: [
    page('genpop-hiring-event', 'hiring-event', { recruitingPath: 'genpop' }),
    page('genpop-application', 'application', { recruitingPath: 'genpop' }),
    page('genpop-phone-interview', 'phone-interview', { recruitingPath: 'genpop' }),
  ] },
  { id: 'mass-recruiting', label: 'Mass Recruiting', branch: true, items: [
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
  { id: 'outcomes', label: 'Outcomes', branch: false, items: [page('completed', 'completed'), page('withdrawn', 'withdrawn')] },
].map(group => Object.freeze({ ...group, items: Object.freeze(group.items) })));
export const WORKSPACE_NAV = Object.freeze([
  Object.freeze({ id: 'today', label: 'Today', icon: 'home' }),
  Object.freeze({ id: 'add-recruits', label: 'Add Recruits', icon: 'add-person' }),
  ...WORKSPACE_NAV_GROUPS.flatMap(group => group.items),
]);

export function resolveWorkspaceRoute(hash) {
  const value = String(hash ?? '').replace(/^#/, '');
  if (value === 'follow-up') return { view: 'today' };
  if (value === 'add-recruit') return { view: 'add-recruits' };
  if (['recruits', 'orientation', 'licensing', 'transfers'].includes(value)) return { view: 'today' };
  if (value.startsWith('recruit/')) return { view: 'today', id: value.slice(8) };
  return { view: WORKSPACE_NAV.some(item => item.id === value) || STAGE_PAGES.some(item => item.id === value) ? value : 'today' };
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
