// Fixed destinations only: hash routes never supply an arbitrary iframe URL.
export const ADMIN_PAGES = Object.freeze([
  { id: 'policytek-admin', label: 'PolicyTek', url: 'https://app.policytek.com/admin', detail: 'app.policytek.com', group: 'admin' },
  { id: 'ringcentral-admin', label: 'RingEX', url: 'https://service.ringcentral.com/application/adminHome', detail: 'service.ringcentral.com', group: 'admin' },
  { id: 'ringcx-admin', label: 'RingCX', url: 'https://ringcx.ringcentral.com/voice/admin/home', detail: 'ringcx.ringcentral.com', group: 'admin' },
  { id: 'hubspot-admin', label: 'HubSpot', url: 'https://app.hubspot.com/settings/50894788/users/active_users', detail: 'HubSpot users', group: 'admin' },
  { id: 'google-admin', label: 'Google Admin', url: 'https://admin.google.com/u/1/ac/home', detail: 'Google Admin Console', group: 'admin' },
].map(page => Object.freeze(page)));
export const AGENT_PORTAL_PAGES = Object.freeze([
  { id: 'policytek-agents', label: 'PolicyTek Agents', url: 'https://app.policytek.com/agents', detail: 'app.policytek.com', group: 'agents' },
  { id: 'policytek-agent-call-plans', label: 'PolicyTek Agent Call Plans', url: 'https://app.policytek.com/lead-distribution/member/agent-plans', detail: 'Agent call plans', group: 'agents' },
].map(page => Object.freeze(page)));
export function externalWorkspacePage(id) {
  return [...ADMIN_PAGES, ...AGENT_PORTAL_PAGES].find(page => page.id === id);
}
