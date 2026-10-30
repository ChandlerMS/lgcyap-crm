import { STAGE_PAGES } from '../lib/recruiting-config.mjs';

export const WORKSPACE_NAV = Object.freeze([
  Object.freeze({ id: 'today', label: 'Today', icon: 'home' }),
  ...STAGE_PAGES,
]);

export function resolveWorkspaceRoute(hash) {
  const value = String(hash ?? '').replace(/^#/, '');
  if (value === 'follow-up') return { view: 'today' };
  if (value === 'add-recruit') return { view: 'recruits' };
  if (value.startsWith('recruit/')) return { view: 'recruits', id: value.slice(8) };
  return { view: WORKSPACE_NAV.some(item => item.id === value) ? value : 'today' };
}

export function stagePageForView(view) {
  return STAGE_PAGES.find(page => page.id === view);
}

export function stagePageForRecord(record) {
  return STAGE_PAGES.find(page => page.stageId === record?.stageId);
}

export function recordsForStagePage(records, view) {
  const page = stagePageForView(view);
  return page ? records.filter(record => record.stageId === page.stageId) : [];
}

export function unmappedStageRecords(records) {
  return records.filter(record => !stagePageForRecord(record));
}
