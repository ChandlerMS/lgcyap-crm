// Fixed destinations only: hash routes never supply an arbitrary iframe URL.
export const RECRUIT_PORTAL_PAGES = Object.freeze([
  Object.freeze({ id: 'contracting-portal', label: 'Contracting', url: 'https://contracting.lgcyagent.com/', detail: 'contracting.lgcyagent.com', group: 'recruits' }),
]);
export const ADMIN_PAGES = Object.freeze([
  { id: 'policytek-admin', label: 'PolicyTek', url: 'https://app.policytek.com/admin', detail: 'app.policytek.com', group: 'admin' },
  { id: 'ringcentral-admin', label: 'RingEX', url: 'https://service.ringcentral.com/application/adminHome', detail: 'service.ringcentral.com', group: 'admin' },
  { id: 'ringcx-admin', label: 'RingCX', url: 'https://ringcx.ringcentral.com/voice/admin/home', detail: 'ringcx.ringcentral.com', group: 'admin' },
  { id: 'hubspot-admin', label: 'HubSpot', url: 'https://app.hubspot.com/settings/50894788/users/active_users', detail: 'HubSpot users', group: 'admin' },
  { id: 'google-admin', label: 'Google Admin', url: 'https://admin.google.com/u/1/ac/home', detail: 'Google Admin Console', group: 'admin' },
].map(page => Object.freeze(page)));
export const AGENT_PORTAL_PAGES = Object.freeze([
  { id: 'lead-payments', label: 'Lead Payments', url: 'https://trainerleadpayment.lgcyagent.com/', detail: 'trainerleadpayment.lgcyagent.com', group: 'agents' },
  { id: 'policytek-agents', label: 'PolicyTek Agents', url: 'https://app.policytek.com/agents', detail: 'app.policytek.com', group: 'agents' },
  { id: 'policytek-agent-call-plans', label: 'PolicyTek Agent Call Plans', url: 'https://app.policytek.com/lead-distribution/member/agent-plans', detail: 'Agent call plans', group: 'agents' },
].map(page => Object.freeze(page)));
export const GOOGLE_WORKSPACE_PAGES = Object.freeze([
  { id: 'google-sheets', label: 'Google Sheets', url: 'https://docs.google.com/spreadsheets/u/0/', detail: 'Spreadsheets', group: 'google-workspace' },
  { id: 'google-drive', label: 'Google Drive', url: 'https://drive.google.com/drive/u/0/', detail: 'Files and shared drives', group: 'google-workspace' },
  { id: 'google-docs', label: 'Google Docs', url: 'https://docs.google.com/document/u/0/', detail: 'Documents', group: 'google-workspace' },
  { id: 'google-chat', label: 'Google Chat', url: 'https://chat.google.com/', detail: 'Messages and spaces', group: 'google-workspace' },
  { id: 'google-meet', label: 'Google Meet', url: 'https://meet.google.com/', detail: 'Video meetings', group: 'google-workspace' },
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com/mail/u/0/', detail: 'Email', group: 'google-workspace' },
  { id: 'google-keep', label: 'Google Keep', url: 'https://keep.google.com/', detail: 'Notes and lists', group: 'google-workspace' },
].map(page => Object.freeze(page)));
export function externalWorkspacePage(id) {
  return [...ADMIN_PAGES, ...AGENT_PORTAL_PAGES, ...GOOGLE_WORKSPACE_PAGES, ...RECRUIT_PORTAL_PAGES].find(page => page.id === id);
}
