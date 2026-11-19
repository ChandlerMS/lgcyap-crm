import { recruitingCalendarDate } from '../app/recruiting-period.mjs';
export function filterApplications(applications, { query = '', office = 'all', status = 'all', startDate = '', endDate = '', sort = 'newest' } = {}) {
  const search = query.trim().toLowerCase();
  return applications.filter(item => (!startDate && !endDate || (() => { const date = recruitingCalendarDate(item.at); return date && (!startDate || date >= startDate) && (!endDate || date <= endDate); })())
    && (!search || [item.name, item.preferredName, item.email, item.phone, item.city].some(value => String(value ?? '').toLowerCase().includes(search)))
    && (office === 'all' || (item.officeKey ?? 'other') === office)
    && (status === 'all' || (status === 'not-met' && item.requirementsMet === false) || (status === 'flagged' && item.flags.length > 0) || (status === 'waiting' && item.waitingAtHiringEvent))).sort((a, b) => {
      const first = Date.parse(a.at), second = Date.parse(b.at);
      if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
      if (!Number.isFinite(second)) return -1;
      return sort === 'oldest' ? first - second : second - first;
    });
}
