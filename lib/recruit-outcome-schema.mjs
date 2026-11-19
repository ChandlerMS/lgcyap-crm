// Additive, idempotent setup for the two explicitly requested recruiting outcomes.
// No CRM records are moved and unrelated pipeline stages/options are preserved.
export async function ensureRecruitOutcomeSchema({ accessToken, fetchImpl = fetch }) {
  if (!accessToken) throw new Error('HubSpot integration is not configured');
  const api = async (path, method = 'GET', body) => {
    const response = await fetchImpl(`https://api.hubapi.com${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Recruiting outcome setup failed (${method} ${response.status}); no automatic write retry`);
    return response.json();
  };
  const identity = await api('/oauth/v2/private-apps/get/access-token-info', 'POST', { tokenKey: accessToken });
  if (Number(identity.hubId) !== 50894788 || Number(identity.appId) !== 59264745) throw new Error('Recruiting outcome setup refused a different HubSpot integration');
  const path = '/crm/v3/pipelines/tickets/924992938';
  const pipeline = await api(path);
  if (pipeline.id !== '924992938' || pipeline.label !== 'Recruiting' || !Array.isArray(pipeline.stages)) throw new Error('Recruiting pipeline could not be verified');
  const propertyPath = '/crm/v3/properties/contacts/recruiting_lifecycle_stage';
  const property = await api(propertyPath);
  if (property.name !== 'recruiting_lifecycle_stage' || property.type !== 'enumeration' || !Array.isArray(property.options)) throw new Error('Recruiting lifecycle property could not be verified');
  const withdrawn = pipeline.stages.find(stage => stage.id === '1473318773');
  if (!withdrawn || withdrawn.label !== 'Withdrawn' || withdrawn.metadata?.ticketState !== 'CLOSED') throw new Error('The existing Withdrawn stage must retain its verified ID and closed state');
  const outcomes = {};
  for (const [value, label] of [['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']]) {
    const matches = pipeline.stages.filter(stage => stage.label.toLowerCase() === label.toLowerCase());
    if (matches.length > 1 || matches.some(stage => stage.label !== label || stage.metadata?.ticketState !== 'CLOSED' || !/^[1-9]\d{0,19}$/.test(stage.id))) throw new Error(`Review conflicting ${label} pipeline stages`);
    const options = property.options.filter(option => option.value === value || option.label.toLowerCase() === label.toLowerCase());
    if (options.length > 1 || options.some(option => option.value !== value || option.label !== label || option.hidden)) throw new Error(`Review conflicting ${label} lifecycle options`);
    outcomes[value] = matches[0]?.id ?? null;
  }
  // All preconditions are checked before the first write.
  for (const [value, label] of [['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']]) {
    if (outcomes[value]) continue;
    const stage = await api(`${path}/stages`, 'POST', { label, displayOrder: Math.max(-1, ...pipeline.stages.map(stage => stage.displayOrder)) + 1, metadata: { ticketState: 'CLOSED' } });
    if (stage.label !== label || stage.metadata?.ticketState !== 'CLOSED' || !/^[1-9]\d{0,19}$/.test(stage.id)) throw new Error(`Verify the ${label} stage before another setup attempt`);
    pipeline.stages.push(stage); outcomes[value] = stage.id;
  }
  const missing = [['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']].filter(([value]) => !property.options.some(option => option.value === value));
  if (missing.length) {
    const fresh = await api(propertyPath);
    if (fresh.name !== property.name || fresh.type !== 'enumeration' || !Array.isArray(fresh.options)) throw new Error('Lifecycle property changed during setup');
    const options = [...fresh.options];
    for (const [value, label] of missing.filter(([value]) => !options.some(option => option.value === value))) options.push({ value, label, hidden: false, displayOrder: Math.max(-1, ...options.map(option => option.displayOrder ?? -1)) + 1 });
    const updated = await api(propertyPath, 'PATCH', { options });
    if (!fresh.options.every(option => updated.options?.some(saved => ['value','label','hidden','displayOrder','description'].every(key => (saved[key] ?? null) === (option[key] ?? null))))) throw new Error('Existing lifecycle options did not retain their definitions');
    if (!missing.every(([value,label]) => updated.options?.some(option => option.value === value && option.label === label && !option.hidden))) throw new Error('Verify lifecycle options before another setup attempt');
  }
  return outcomes;
}
