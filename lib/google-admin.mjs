export const GOOGLE_ADMIN_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.rolemanagement',
]);
const BASE = 'https://admin.googleapis.com/admin/directory/v1/';
export class GoogleAdminError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function directoryClient(token, fetcher = fetch) {
  return async (path, method = 'GET', body) => {
    let response;
    try { response = await fetcher(`${BASE}${path}`, { method, redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) }); }
    catch { throw new GoogleAdminError(method === 'GET' ? 'Google could not be reached. Try refreshing.' : 'Google did not confirm the change. Refresh permissions before trying again.'); }
    if (!response.ok) {
      const message = response.status === 401 ? 'Reconnect Google Workspace to refresh your authorization.' : response.status === 403 ? 'Google denied this request. Connect Google Workspace and use an account with Directory user and administrator role management privileges.' : response.status === 409 ? 'That Google role assignment already exists. Refresh the list.' : response.status === 404 ? 'Google could not find this user or role assignment. Refresh the list.' : 'Google could not complete this request. Refresh before trying again.';
      throw new GoogleAdminError(message, response.status === 401 || response.status === 403 ? 403 : 502);
    }
    if (response.status === 204) return {};
    return response.json();
  };
}
async function pages(read, path, key) {
  const values = []; let pageToken;
  for (let page = 0; page < 50; page++) {
    const data = await read(`${path}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new GoogleAdminError('Google returned an incomplete directory response.');
    values.push(...(data[key] ?? [])); pageToken = data.nextPageToken;
    if (!pageToken) return { values, partial: false };
  }
  return { values, partial: true };
}
export async function readGoogleDirectory(read) {
  const [users, roles, assignments] = await Promise.all([
    pages(read, 'users?customer=my_customer&maxResults=200&orderBy=email', 'users'),
    pages(read, 'customer/my_customer/roles?maxResults=100', 'items'),
    pages(read, 'customer/my_customer/roleassignments?maxResults=200', 'items'),
  ]);
  return { partial: users.partial || roles.partial || assignments.partial,
    users: users.values.map(user => ({ id: user.id, email: user.primaryEmail, name: user.name?.fullName || user.primaryEmail, suspended: Boolean(user.suspended), isAdmin: Boolean(user.isAdmin), lastLogin: user.lastLoginTime || null })),
    roles: roles.values.map(role => ({ id: role.roleId, name: role.roleName, description: role.roleDescription || '', system: Boolean(role.isSystemRole) })),
    assignments: assignments.values.map(item => ({ id: item.roleAssignmentId, roleId: item.roleId, userId: item.assignedTo, scope: item.scopeType, orgUnitId: item.orgUnitId || null })) };
}
export async function changeGoogleRole(read, input) {
  if (!input || !['grant', 'revoke'].includes(input.action)) throw new GoogleAdminError('Choose grant or revoke.', 400);
  const id = value => typeof value === 'string' && /^\d{1,30}$/.test(value);
  if (input.action === 'grant') {
    if (!id(input.userId) || !id(input.roleId)) throw new GoogleAdminError('Choose a Google user and administrator role.', 400);
    await read(`users/${encodeURIComponent(input.userId)}?projection=basic`);
    await read(`customer/my_customer/roles/${encodeURIComponent(input.roleId)}`);
    const assigned = await read('customer/my_customer/roleassignments', 'POST', { assignedTo: input.userId, roleId: input.roleId, scopeType: 'CUSTOMER' });
    return { target: `${input.userId}:${input.roleId}`, assignmentId: assigned.roleAssignmentId };
  }
  if (!id(input.assignmentId)) throw new GoogleAdminError('Choose a Google role assignment.', 400);
  // Read before deleting: no arbitrary URL or resource path is accepted from the browser.
  const assignment = await read(`customer/my_customer/roleassignments/${input.assignmentId}`);
  await read(`customer/my_customer/roleassignments/${input.assignmentId}`, 'DELETE');
  return { target: `${assignment.assignedTo}:${assignment.roleId}`, assignmentId: input.assignmentId };
}
