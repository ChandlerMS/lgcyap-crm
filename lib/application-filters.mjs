export function filterApplications(applications, { query = '', office = 'all', status = 'all' } = {}) {
  const search = query.trim().toLowerCase();
  return applications.filter(item => (!search || [item.name, item.preferredName, item.email, item.phone, item.city].some(value => String(value ?? '').toLowerCase().includes(search)))
    && (office === 'all' || (item.officeKey ?? 'other') === office)
    && (status === 'all' || (status === 'not-met' && item.requirementsMet === false) || (status === 'flagged' && item.flags.length > 0) || (status === 'waiting' && item.waitingAtHiringEvent)));
}
