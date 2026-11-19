import { normalizeRecruit } from './hubspot.mjs';
import { PIPELINE_ID, RECRUIT_PROPERTIES } from './recruiting-config.mjs';
import { enrichRecruitContacts } from './recruit-contact-read.mjs';
import { FOLLOW_UP_QUEUE_ID } from './no-contact-tasks.mjs';
const id = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
export function noContactProvider({ accessToken, fetchImpl = fetch, deadline, clock = Date.now }) {
  async function request(path, body, method = body ? 'POST' : 'GET') {
    const left = deadline - clock();
    if (left < 1000) throw Object.assign(new Error('Follow-up check deadline reached'), { definite: true, retryAfterMs: 60000 });
    const response = await fetchImpl(`https://api.hubapi.com${path}`, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(Math.min(left, 10000)), headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Object.assign(new Error('HubSpot follow-up request could not be confirmed'), { status: response.status, definite: response.status >= 400 && response.status < 500 && response.status !== 408, retryAfterMs: Math.min(86400000, Math.max(60000, (Number(response.headers.get('retry-after')) || 300) * 1000)) });
    return response.status === 204 ? {} : response.json();
  }
  return {
    async verifyQueue() {
      const property = await request('/crm/v3/properties/tasks/hs_queue_membership_ids');
      if (!property.options?.some(option => option.value === FOLLOW_UP_QUEUE_ID && option.label.toLowerCase() === 'follow up')) throw new Error('Shared Follow up queue unavailable');
    },
    async list(cursor) {
      if (!/^\d{1,20}$/.test(cursor)) throw new Error('Invalid follow-up cursor');
      const data = await request('/crm/v3/objects/tickets/search', { filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }, { propertyName: 'hs_object_id', operator: 'GT', value: cursor }] }], properties: RECRUIT_PROPERTIES, sorts: ['hs_object_id'], limit: 100 });
      if (!Array.isArray(data.results) || data.results.length > 100) throw new Error('Incomplete recruiting response');
      let previous = BigInt(cursor);
      for (const row of data.results) { if (!id(row.id) || BigInt(row.id) <= previous || row.properties?.hs_pipeline !== PIPELINE_ID) throw new Error('Invalid recruiting page'); previous = BigInt(row.id); }
      return { recruits: await enrichRecruitContacts(data.results.map(normalizeRecruit), { accessToken, fetchImpl, timeoutMs: 4000 }), more: Boolean(data.paging?.next) };
    },
    async fresh(ticketId) {
      if (!id(ticketId)) throw new Error('Invalid recruiting ticket');
      const raw = await request(`/crm/v3/objects/tickets/${ticketId}?properties=${RECRUIT_PROPERTIES.join(',')}`);
      if (raw.id !== ticketId) throw new Error('Recruiting ticket response mismatch');
      if (raw.archived || raw.properties?.hs_pipeline !== PIPELINE_ID) return null;
      const [recruit] = await enrichRecruitContacts([normalizeRecruit(raw)], { accessToken, fetchImpl, timeoutMs: Math.min(4000, Math.max(1000, deadline - clock())) });
      return recruit;
    },
    async find(marker) {
      const data = await request('/crm/v3/objects/tasks/search', { filterGroups: [{ filters: [{ propertyName: 'hs_task_body', operator: 'CONTAINS_TOKEN', value: marker }] }], properties: ['hs_task_body'], limit: 100 });
      if (!Array.isArray(data.results) || data.paging?.next) throw new Error('Incomplete task reconciliation');
      return data.results.filter(row => id(row.id) && row.properties?.hs_task_body?.includes(marker));
    },
    create: body => request('/crm/v3/objects/tasks', body),
    async complete(taskId, marker) {
      if (!id(taskId)) throw new Error('Invalid follow-up task');
      let task;
      try { task = await request(`/crm/v3/objects/tasks/${taskId}?properties=hs_task_body,hs_task_status`); } catch (error) { if (error.status === 404) return; throw error; }
      if (task.archived) return;
      if (!task.properties?.hs_task_body?.includes(marker)) throw new Error('Automatic task identity changed');
      if (task.properties.hs_task_status !== 'COMPLETED') await request(`/crm/v3/objects/tasks/${taskId}`, { properties: { hs_task_status: 'COMPLETED' } }, 'PATCH');
    },
  };
}
