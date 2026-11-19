import { safeHubspotViewLink } from './hubspot-workspace-view.mjs';

export const SEARCH_AREAS = Object.freeze([
  { id: 'recruits', label: 'Recruits' }, { id: 'contract-agents', label: 'Contract Agents' },
  { id: 'calls', label: 'Calls' }, { id: 'meetings', label: 'Meetings' },
  { id: 'inbox', label: 'Inbox' }, { id: 'help-desk', label: 'Help Desk' }, { id: 'tickets', label: 'Tickets' },
]);

export function safeSearchHref(value) {
  if (typeof value !== 'string') return null;
  if (/^#(?:recruit\/|inbox\/thread\/)[1-9]\d{0,19}$/.test(value)) return value;
  return safeHubspotViewLink(value);
}

export function normalizeSearchGroups(groups) {
  if (!Array.isArray(groups)) throw new Error('Search returned an invalid response.');
  return SEARCH_AREAS.flatMap(area => {
    const group = groups.find(group => group?.id === area.id);
    if (!group) return [];
    if (!['available', 'unavailable'].includes(group.status) || !Array.isArray(group.records)) throw new Error('Search returned an invalid area.');
    const records = group.records.flatMap(record => {
      const href = safeSearchHref(record?.href);
      if (!href || !record.id || typeof record.title !== 'string') return [];
      return [{ id: String(record.id), title: record.title.slice(0, 240), subtitle: typeof record.subtitle === 'string' ? record.subtitle.slice(0, 600) : null, href }];
    });
    return [{ ...area, status: group.status, records, partial: group.partial === true, continuation: typeof group.continuation === 'string' ? group.continuation : null, notice: typeof group.notice === 'string' ? group.notice.slice(0, 1200) : null }];
  });
}

export function mergeSearchGroups(previous, incoming) {
  const byId = new Map(previous.map(group => [group.id, group]));
  for (const group of incoming) {
    const before = byId.get(group.id);
    const rows = new Map((before?.records ?? []).map(record => [record.id, record]));
    for (const record of group.records) rows.set(record.id, record);
    byId.set(group.id, { ...group, records: [...rows.values()] });
  }
  return SEARCH_AREAS.flatMap(area => byId.has(area.id) ? [byId.get(area.id)] : []);
}

export function demoSearchGroups(recruits, query) {
  const value = String(query).trim().toLocaleLowerCase();
  return SEARCH_AREAS.map(area => ({ ...area, status: 'available', partial: false, continuation: null,
    notice: area.id === 'recruits' ? 'Fictional demo recruits only.' : 'This HubSpot area is not connected in demo mode.',
    records: area.id === 'recruits' ? recruits.filter(record => [record.name, record.email, record.phone, record.office].some(field => String(field ?? '').toLocaleLowerCase().includes(value)))
      .flatMap(record => safeSearchHref(`#recruit/${record.id}`) ? [{ id: String(record.id), title: record.name, subtitle: [record.email, record.phone, 'Demo recruit'].filter(Boolean).join(' · '), href: `#recruit/${record.id}` }] : []) : [],
  }));
}

/** @param {{demo?: boolean, pending?: boolean, busy?: boolean, error?: string, groups?: Array<{status: string, partial: boolean, records: unknown[]}>}} input */
export function workspaceSearchStatus({ demo = false, pending = false, busy = false, error = '', groups = [] }) {
  if (demo) return 'Demo · fictional local data';
  if (error && pending) return 'Search unavailable';
  if (pending || busy) return 'Searching HubSpot…';
  const count = groups.reduce((total, group) => total + group.records.length, 0);
  const incomplete = Boolean(error) || groups.some(group => group.status === 'unavailable');
  if (incomplete) return `${count ? `${count} matches · ` : ''}Search incomplete`;
  return `${count} matching ${count === 1 ? 'record' : 'records'}${groups.some(group => group.partial) ? ' · Partial results' : ''}`;
}
