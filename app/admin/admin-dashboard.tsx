'use client';
import DismissibleNotice from '../dismissible-notice';
import { useCallback, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { GOOGLE_ADMIN_SCOPES } from '@/lib/google-admin.mjs';
import styles from './admin.module.css';

type CrmUser = { email: string; allowed: boolean; administrator: boolean; user: { name?: string; id: string } | null };
type Audit = { id: string; actor: string; action: string; target: string; created_at: string };
type Access = { viewer: string; users: CrmUser[]; audit: Audit[] };
type GoogleUser = { id: string; email: string; name: string; suspended: boolean; isAdmin: boolean };
type GoogleRole = { id: string; name: string; description: string };
type Assignment = { id: string; roleId: string; userId: string; scope: string; orgUnitId: string | null };
type Directory = { users: GoogleUser[]; roles: GoogleRole[]; assignments: Assignment[]; partial: boolean };
async function readJson(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'The request could not be completed. Refresh to try again.');
  return result;
}
export default function AdminDashboard({ embedded = false }: { embedded?: boolean }) {
  const Root = embedded ? 'section' : 'main';
  const [access, setAccess] = useState<Access | null>(null);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [crmError, setCrmError] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setReading(true);
    const results = await Promise.allSettled([
      fetch('/api/admin/access', { cache: 'no-store', credentials: 'same-origin', signal }).then(readJson),
      fetch('/api/admin/google', { cache: 'no-store', credentials: 'same-origin', signal }).then(readJson),
    ]);
    if (signal?.aborted) return;
    if (results[0].status === 'fulfilled') { setAccess(results[0].value); setCrmError(''); } else { setAccess(null); setCrmError(results[0].reason.message); }
    if (results[1].status === 'fulfilled') { setDirectory(results[1].value); setGoogleError(''); } else { setDirectory(null); setGoogleError(results[1].reason.message); }
    setReading(false);
  }, []);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void refresh(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [refresh]);
  async function save(path: string, input: object, google = false) {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(readJson);
      setNotice('Permission change saved.'); setEmail('');
      await refresh();
    } catch (error) { (google ? setGoogleError : setCrmError)(error instanceof Error ? error.message : 'The change could not be confirmed. Refresh before trying again.'); }
    finally { setBusy(false); }
  }
  async function connectGoogle() {
    setConnecting(true); setGoogleError('');
    try {
      const result = await authClient.linkSocial({ provider: 'google', callbackURL: '/#admin', errorCallbackURL: '/#admin', scopes: ['openid', 'email', 'profile', ...GOOGLE_ADMIN_SCOPES] });
      if (result.error) throw new Error('Google authorization could not start. Try again.');
    } catch (error) { setGoogleError(error instanceof Error ? error.message : 'Google authorization could not start.'); setConnecting(false); }
  }
  const needle = search.trim().toLowerCase();
  const crmUsers = access?.users.filter(user => !needle || `${user.email} ${user.user?.name || ''}`.toLowerCase().includes(needle)) ?? [];
  const googleUsers = directory?.users.filter(user => !needle || `${user.email} ${user.name}`.toLowerCase().includes(needle)) ?? [];
  const roleNames = new Map(directory?.roles.map(role => [role.id, role.name]));
  const selected = directory?.users.find(user => user.id === selectedUser);
  const assignments = directory?.assignments.filter(item => item.userId === selectedUser) ?? [];
  if (!access) return <Root className={styles.page}><h1 id="page-title" className="page-title" tabIndex={-1}>Admin dashboard</h1>{reading ? <p role="status">Checking administrator access…</p> : <><p role="alert" className={styles.error}>{crmError || 'Administrator access could not be verified.'}</p><button className="btn btn-secondary" onClick={() => void refresh()}>Retry</button><a className="text-link" href="/sign-in?return_to=%2F%23admin" target="_top">Sign in</a></>}</Root>;
  return <Root className={styles.page}>
    <header className="page-head"><div><h1 className="page-title" id="page-title" tabIndex={-1}>Admin dashboard</h1><p className="subheading">CRM access and Google Workspace permissions</p></div><button className="btn btn-secondary" disabled={busy || reading} onClick={() => void refresh()}>{reading ? 'Refreshing…' : 'Refresh'}</button></header>
    <p className="helper">Managed by Chandler and Sarah. Google Workspace changes use your Google administrator privileges.</p>
    {notice && <DismissibleNotice className={styles.notice} role="status">{notice}</DismissibleNotice>}
    <div className={styles.stats}><div><strong>{access ? access.users.filter(user => user.allowed).length : '—'}</strong><span>Authorized CRM emails</span></div><div><strong>{access ? access.users.filter(user => user.user).length : '—'}</strong><span>Registered CRM users</span></div><div><strong>{directory ? directory.users.length : '—'}</strong><span>Google Workspace users</span></div></div>
    <label className={styles.search}>Find a user<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or email" /></label>
    <section className={styles.panel} aria-labelledby="crm-access-title"><h2 id="crm-access-title">CRM access</h2>
      <p className="helper">Grant access to recruiting records and editing tools. Revoking access blocks the next request, including existing sessions. The two CRM administrators retain access.</p>
      {crmError && <p role="alert" className={styles.error}>{crmError}</p>}
      {access && <><form className={styles.form} onSubmit={event => { event.preventDefault(); void save('/api/admin/access', { email, allowed: true }); }}><label>Email address<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label><button className="btn btn-primary" disabled={busy || reading}>Grant CRM access</button></form>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Permissions</th></tr></thead><tbody>{crmUsers.map(user => <tr key={user.email}><td>{user.user?.name || 'Has not signed in'}</td><td>{user.email}</td><td>{user.administrator ? 'Administrator' : user.allowed ? 'Recruiting editor' : 'Revoked'}</td><td><button className="btn btn-quiet" disabled={busy || reading || user.administrator} onClick={() => { if (!user.allowed || window.confirm(`Revoke CRM access for ${user.email}?`)) void save('/api/admin/access', { email: user.email, allowed: !user.allowed }); }}>{user.allowed ? 'Revoke access' : 'Grant access'}</button></td></tr>)}</tbody></table></div>{!crmUsers.length && <p>No matching users.</p>}</>}
    </section>
    <section className={styles.panel} aria-labelledby="google-users-title"><div className={styles.heading}><h2 id="google-users-title">Google Workspace</h2><button className="btn btn-primary" disabled={connecting || busy} onClick={() => void connectGoogle()}>{connecting ? 'Opening Google…' : 'Connect Google Workspace'}</button><a className="text-link" href="https://admin.google.com/u/1/ac/home" target="_blank" rel="noopener noreferrer">Google Admin Console ↗</a></div>
      <p className="helper">Authorize directory access to view users and manage their Google administrator roles. Grants below apply across the whole organization. Other Google permissions remain available in Google Admin Console.</p>
      {googleError && <p role="alert" className={styles.error}>{googleError}</p>}
      {directory?.partial && <p className={styles.error} role="status">Google returned a partial directory. Some users or assignments may be missing. Use Google Admin Console for the complete list.</p>}
      {directory && <><div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Administrator roles</th></tr></thead><tbody>{googleUsers.map(user => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.suspended ? 'Suspended' : 'Active'}{user.isAdmin ? ' · Super administrator' : ''}</td><td><button className="btn btn-quiet" onClick={() => { setSelectedUser(user.id); setSelectedRole(''); }}>{directory.assignments.filter(item => item.userId === user.id).map(item => roleNames.get(item.roleId) || item.roleId).join(', ') || 'No direct administrator role'} · Manage</button></td></tr>)}</tbody></table></div>{!googleUsers.length && <p>No matching Google users.</p>}
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (selected && roleNames.has(selectedRole) && window.confirm(`Grant ${roleNames.get(selectedRole)} to ${selected?.email} across the whole organization?`)) void save('/api/admin/google', { action: 'grant', userId: selectedUser, roleId: selectedRole }, true); }}>
        <label>Google user<select required value={selectedUser} onChange={event => setSelectedUser(event.target.value)}><option value="">Choose a user</option>{directory.users.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
        <label>Administrator role<select required value={selectedRole} onChange={event => setSelectedRole(event.target.value)}><option value="">Choose a role</option>{directory.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><button className="btn btn-primary" disabled={busy || reading || !selected || !roleNames.has(selectedRole)}>Grant Google role</button>
      </form>
      {selected && <div><h3>Roles for {selected.email}</h3>{assignments.length ? <ul className={styles.roles}>{assignments.map(item => <li key={item.id}><span>{roleNames.get(item.roleId) || item.roleId} · {item.scope === 'CUSTOMER' ? 'Whole organization' : `Organizational unit ${item.orgUnitId || ''}`}</span><button className="btn btn-quiet" disabled={busy || reading} onClick={() => { if (window.confirm(`Remove ${roleNames.get(item.roleId) || 'this role'} from ${selected.email}?`)) void save('/api/admin/google', { action: 'revoke', assignmentId: item.id }, true); }}>Remove role</button></li>)}</ul> : <p>No direct administrator roles assigned.</p>}</div>}</>}
    </section>
    {access && <section className={styles.panel} aria-labelledby="admin-audit-title"><h2 id="admin-audit-title">Recent permission changes</h2><p className="helper">Latest 100 dashboard actions. Google requests remain recorded even when their outcome is unconfirmed.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th></tr></thead><tbody>{access.audit.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.actor}</td><td>{item.action}</td><td>{item.target}</td></tr>)}</tbody></table></div>{!access.audit.length && <p>No permission changes yet.</p>}</section>}
  </Root>;
}
